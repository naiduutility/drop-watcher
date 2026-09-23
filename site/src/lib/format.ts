/**
 * Reading a BookMyShow screen format.
 *
 * BMS writes them as "{language} • {dimension} | {screen}", for example:
 *
 *   English • 2D  | HDR By Barco
 *   English • 3D  | HDR By Barco
 *   English • 2D  | INFINITY VISION DOLBY ATMOS
 *   Telugu  • 2D
 *
 * The part after the pipe is a PHYSICAL AUDITORIUM — AMB's HDR By Barco,
 * Prasads' PCX, Allu's Dolby Cinema. The part before it is what happens to be
 * playing there today.
 *
 * That distinction is the whole point of this module. Somebody who wants the
 * best screen in the city wants *that room*, and has no idea whether next
 * week's film will be on it in 2D, 3D or Infinity Vision. Offering
 * "2D | HDR By Barco" as the choice would quietly miss a 3D show in the very
 * same seat — which is the kind of near-miss this product exists to prevent.
 *
 * So the screen is what gets offered, and the dimension is deliberately
 * discarded.
 */

/**
 * The auditorium a format names.
 *
 * Falls back to the dimension when BMS gives no screen at all ("Telugu • 2D"),
 * because that is genuinely everything it told us — better an honest "2D" than
 * an invented room name.
 */
export function screenName(raw: string): string {
  const pipe = raw.lastIndexOf("|");
  if (pipe >= 0) return raw.slice(pipe + 1).trim();
  const bullet = raw.indexOf("•");
  return (bullet >= 0 ? raw.slice(bullet + 1) : raw).trim();
}

/** The dimension, when there is one: 2D, 3D, 4DX 3D, MS - Infinity Vision. */
export function dimension(raw: string): string | null {
  const bullet = raw.indexOf("•");
  if (bullet < 0) return null;
  const pipe = raw.lastIndexOf("|");
  const middle = pipe > bullet ? raw.slice(bullet + 1, pipe) : raw.slice(bullet + 1);
  return middle.trim() || null;
}

/**
 * The auditoriums seen at a venue, in first-seen order.
 *
 * Deduplicated by SCREEN, so a room that has shown both 2D and 3D appears once
 * and a watch on it catches either. No filtering and no cap: an earlier version
 * ran this through a regex of format words and kept six, which silently dropped
 * HDR By Barco — exactly the screen someone builds a watch around.
 */
export function formatChoices(screens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of screens) {
    const label = screenName(s);
    const key = label.toLowerCase();
    if (label && !seen.has(key)) { seen.add(key); out.push(label); }
  }
  return out;
}
