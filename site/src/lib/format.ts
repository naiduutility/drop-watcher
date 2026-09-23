/**
 * BookMyShow writes a screen format as "English • 2D | HDR By Barco".
 *
 * The language is already fixed per watch, so repeating it in every chip is
 * noise. Dropping only the language keeps "2D | HDR By Barco" — still unique
 * between a venue's 2D and 3D versions of the same screen, which matters when
 * the whole point is picking one particular auditorium.
 */
export function shortFormat(raw: string): string {
  const bullet = raw.indexOf("\u2022");
  return (bullet >= 0 ? raw.slice(bullet + 1) : raw).trim();
}

/** Distinct formats, shortened, in first-seen order. No filtering: a
 *  hardcoded allow-list of format words silently dropped HDR By Barco, which
 *  is precisely the kind of screen someone builds a watch around. */
export function formatChoices(screens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of screens) {
    const label = shortFormat(s);
    const key = label.toLowerCase();
    if (label && !seen.has(key)) { seen.add(key); out.push(label); }
  }
  return out;
}
