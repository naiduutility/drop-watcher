import type { ReactNode } from "react";

export const metadata = {
  title: "Drop Watcher",
  description: "Tells you the moment a BookMyShow date goes on sale.",
};

const css = `
  :root { color-scheme: light dark; --fg:#111; --bg:#fbfbfa; --muted:#666;
          --line:#e2e2df; --accent:#1a5fb4; --warn:#a33; --ok:#1a7f37; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8e6; --bg:#16161a; --muted:#9a9a97; --line:#2e2e33;
            --accent:#7aa2f7; --warn:#f38ba8; --ok:#7ee787; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55
         ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 1.75rem 0 .5rem; }
  a { color: var(--accent); }
  .muted { color: var(--muted); }
  .card { border:1px solid var(--line); border-radius:10px; padding:.85rem 1rem;
          margin:.6rem 0; background:color-mix(in srgb, var(--bg) 92%, var(--fg) 8%); }
  .row { display:flex; gap:.6rem; align-items:baseline; flex-wrap:wrap; }
  .pill { font-size:.72rem; padding:.1rem .45rem; border-radius:99px;
          border:1px solid var(--line); }
  .warn { color: var(--warn); }
  .ok { color: var(--ok); }
  input[type=url], input[type=text], input[type=email] { width:100%; padding:.55rem .65rem;
    border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); }
  button { font:inherit; padding:.5rem .9rem; border-radius:8px; cursor:pointer;
           border:1px solid var(--line); background:var(--accent); color:#fff; }
  button.secondary { background:transparent; color:var(--fg); }
  label.date { display:inline-flex; gap:.4rem; align-items:center; margin:.2rem .6rem .2rem 0;
               border:1px solid var(--line); border-radius:8px; padding:.35rem .6rem; }
  code { background:color-mix(in srgb, var(--bg) 80%, var(--fg) 20%); padding:.05rem .3rem;
         border-radius:4px; font-size:.85em; word-break:break-all; }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <main>{children}</main>
      </body>
    </html>
  );
}
