/**
 * Getting the bytes — the only impure part of reading BookMyShow.
 *
 * Measured on 2026-09-23, same IP, seconds apart:
 *
 *   curl            HTTP 200, 320 KB, 0.6s   <- payload is in the initial HTML
 *   Node fetch      HTTP 403, 5 KB,   0.2s   <- rejected outright
 *   Playwright      HTTP 200, ~25s           <- works, 40x the cost
 *
 * So JavaScript rendering was never the requirement: the venue and date data
 * ship in the server-rendered HTML. What BookMyShow's Cloudflare actually
 * scores is the CLIENT — undici's TLS/HTTP2 fingerprint is refused where
 * curl's is accepted. No header combination fixes that; it is below the header
 * layer.
 *
 * Hence curl first, browser only on escalation. curl is present on every
 * GitHub Actions runner and on Windows 10+, needs no download, and turns a
 * 25-second check into a sub-second one.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Outcome, readShowtimes, type Reading } from "../engine/index.js";
import { envNumber } from "../lib/env.js";

const execFileAsync = promisify(execFile);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Breathing room between two loads from one IP. */
export const PACING_MS = envNumber("PACING_MS", 6000);

export type Transport = "curl" | "browser";

export interface FetchResult {
  reading: Reading;
  durationMs: number;
  httpStatus: number;
  transport: Transport;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch via the curl binary.
 *
 * The body goes to a temp file rather than stdout so a 320 KB page never has
 * to fit in a pipe buffer; stdout carries only the status code.
 */
export async function fetchViaCurl(
  url: string, requestedDate: string | null,
): Promise<FetchResult> {
  const started = Date.now();
  const dir = await mkdtemp(join(tmpdir(), "dw-"));
  const bodyPath = join(dir, "body.html");
  const headPath = join(dir, "head.txt");
  let httpStatus = 0;
  let html = "";
  try {
    // Headers to a file rather than curl's -w format string: Node's execFile
    // on Windows strips the braces out of "%{http_code}", so the status came
    // back as the literal text "%http_code" and every check logged HTTP 0.
    // A status code missing from the forensic log defeats the whole point of
    // keeping one.
    await execFileAsync("curl", [
      "-sS", "--compressed", "--max-time", "30",
      "-o", bodyPath, "-D", headPath,
      "-H", `User-Agent: ${USER_AGENT}`,
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: en-IN,en;q=0.9",
      "-H", "Upgrade-Insecure-Requests: 1",
      url,
    ], { maxBuffer: 1 << 16 });
    const headers = await readFile(headPath, "utf8").catch(() => "");
    // Last status line wins, so a redirect chain reports where it ended up.
    const codes = [...headers.matchAll(/^HTTP\/[\d.]+\s+(\d{3})/gm)].map((m) => Number(m[1]));
    httpStatus = codes.at(-1) ?? 0;
    html = await readFile(bodyPath, "utf8").catch(() => "");
  } catch (e) {
    // curl missing, or the transfer failed. Reported as BLOCKED rather than as
    // an empty page: "we could not read it" must never look like "nothing on".
    return {
      reading: {
        outcome: Outcome.BLOCKED, requestedDate, servedDate: null,
        offeredDates: [], venues: [],
        detail: `curl failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
      },
      durationMs: Date.now() - started, httpStatus: 0, transport: "curl",
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  // No rendered body text to check, so the engine's block detection leans on
  // the status code. A challenge page is ~5 KB against a real page's ~320 KB,
  // and the engine's short-body rule catches that too.
  return {
    reading: readShowtimes(html, { bodyText: html.length < 8000 ? html : "", requestedDate, httpStatus }),
    durationMs: Date.now() - started,
    httpStatus,
    transport: "curl",
  };
}

/** A browser context, created only if curl gets refused. */
export type ContextProvider = () => Promise<{
  newPage: () => Promise<{
    goto: (u: string, o: unknown) => Promise<{ status: () => number } | null>;
    waitForLoadState: (s: string, o: unknown) => Promise<void>;
    waitForTimeout: (ms: number) => Promise<void>;
    content: () => Promise<string>;
    innerText: (sel: string) => Promise<string>;
    close: () => Promise<void>;
  }>;
}>;

export async function fetchViaBrowser(
  provider: ContextProvider, url: string, requestedDate: string | null,
): Promise<FetchResult> {
  const started = Date.now();
  const context = await provider();
  const page = await context.newPage();
  let httpStatus = 0;
  let html = "";
  let bodyText = "";
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    httpStatus = response?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    html = await page.content();
    // The RENDERED text, never the raw HTML: every healthy BMS page embeds
    // "cdn-loop: cloudflare" in its request headers, so block markers scanned
    // in the HTML condemn good pages.
    bodyText = await page.innerText("body").catch(() => "");
  } finally {
    await page.close().catch(() => {});
  }
  return {
    reading: readShowtimes(html, { bodyText, requestedDate, httpStatus }),
    durationMs: Date.now() - started, httpStatus, transport: "browser",
  };
}

/**
 * Read one showtimes page as cheaply as it will allow.
 *
 * curl first. If it comes back BLOCKED and a browser is available, escalate
 * once — a browser costs ~25s and a browser download, so it is the exception,
 * not the default.
 */
export async function fetchShowtimes(
  url: string, requestedDate: string | null, provider?: ContextProvider,
): Promise<FetchResult> {
  // Measured 2026-09-23: curl gets the full payload from a residential IP and
  // a flat 403 from GitHub's Azure runners. Where curl is known to be refused,
  // attempting it anyway is not merely a wasted 100ms — it is another request
  // to an IP BookMyShow is already unhappy with, spent to learn nothing.
  if (process.env.PREFER_BROWSER === "1" && provider) {
    try {
      return await fetchViaBrowser(provider, url, requestedDate);
    } catch (e) {
      console.error(`   browser unavailable: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      // Fall through and let curl have its go; being wrong about the
      // environment must not mean making no attempt at all.
    }
  }

  const cheap = await fetchViaCurl(url, requestedDate);
  if (cheap.reading.outcome !== Outcome.BLOCKED || !provider) return cheap;
  console.log("   curl was refused - escalating to a browser");
  try {
    return await fetchViaBrowser(provider, url, requestedDate);
  } catch (e) {
    // No browser installed, or it failed to start. That is an infrastructure
    // problem, not a finding about the cinema — so the pass records the
    // honest BLOCKED and carries on to the next target instead of dying.
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 120);
    console.error(`   escalation unavailable: ${why}`);
    return {
      ...cheap,
      reading: { ...cheap.reading, detail: `${cheap.reading.detail}; browser escalation unavailable` },
    };
  }
}

/** Lazily start Playwright, and only if it is actually installed. */
export async function browserProvider(): Promise<{
  provider: ContextProvider; close: () => Promise<void>;
}> {
  let browser: { newContext: (o: unknown) => Promise<unknown>; close: () => Promise<void> } | null = null;
  const provider = (async () => {
    if (!browser) {
      const { chromium } = await import("playwright");
      browser = (await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      })) as unknown as typeof browser;
    }
    return (await browser!.newContext({
      userAgent: USER_AGENT, locale: "en-IN", timezoneId: "Asia/Kolkata",
      viewport: { width: 1366, height: 900 },
    })) as unknown as Awaited<ReturnType<ContextProvider>>;
  }) as ContextProvider;
  return { provider, close: async () => { await browser?.close().catch(() => {}); } };
}
