/**
 * Shared BookMyShow reading engine.
 *
 * Everything here is PURE: it takes page HTML and returns findings. Fetching
 * lives in the worker, because that is the part needing a browser, an IP and
 * a rate limiter.
 *
 * The design rule, learned the expensive way: a caller must never be able to
 * mistake "I could not tell" for "there is nothing there".
 */

export * from "./outcomes.js";
export * from "./parse.js";
export * from "./match.js";
export * from "./urls.js";
