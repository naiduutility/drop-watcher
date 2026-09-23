/**
 * Sending one message to one person.
 *
 * A channel is a row, not a code branch, so Web Push arrives later as another
 * `kind` rather than a rewrite. Two rules are load-bearing, both bought at
 * full price on 2026-09-22:
 *
 *   Buttons are links into OUR app, never ntfy acks. ntfy keeps action buttons
 *   tappable in the client's history forever, and an ack published to a topic
 *   sits in its cache for ~12 hours being re-applied on every run. A stale tap
 *   must reach an endpoint that knows the current state, can say "already
 *   done, nothing changed", and can offer Undo.
 *
 *   Nothing destructive sits beside something routine. There is no
 *   "stop everything" button on a routine alert; ending a watch happens in the
 *   app, where it can be confirmed and reversed.
 */

export interface OutboundMessage {
  title: string;
  body: string;
  /** Tapping the notification itself goes here — straight to the booking page
   *  for the right date, not the movie page, whose CTA reopens a format picker
   *  and loses the day. */
  clickUrl?: string;
  actions?: { label: string; url: string }[];
  priority?: "normal" | "high";
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface ChannelRow {
  id: string;
  kind: "ntfy" | "webpush";
  config: Record<string, unknown>;
}

export interface Channel {
  send(message: OutboundMessage): Promise<SendResult>;
}

const NTFY_SERVER = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/+$/, "");

/**
 * ntfy.sh with a per-user random topic.
 *
 * The topic name is still the password, which is why it is generated long and
 * random and never shared between people — one member's topic cannot be used
 * to silence another's watch, because acknowledgement does not live here at
 * all any more.
 */
export class NtfyChannel implements Channel {
  constructor(private readonly topic: string) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.topic) return { ok: false, error: "no topic configured" };
    // Published as JSON rather than via headers: ntfy metadata headers must be
    // latin-1 safe, which mangles non-ASCII film titles.
    const payload: Record<string, unknown> = {
      topic: this.topic,
      title: message.title,
      message: message.body,
      priority: message.priority === "high" ? 5 : 3,
    };
    if (message.clickUrl) payload["click"] = message.clickUrl;
    if (message.actions?.length) {
      // ntfy allows a MAXIMUM of 3 actions and rejects the whole publish if
      // given a fourth — taking the notification with it.
      payload["actions"] = message.actions.slice(0, 3).map((a) => ({
        action: "view", label: a.label, url: a.url, clear: false,
      }));
    }
    try {
      const res = await fetch(`${NTFY_SERVER}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // ntfy puts the real reason in the body; the bare status tells you
        // nothing, and a swallowed failure here means nobody was told.
        return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export function channelFor(row: ChannelRow): Channel {
  switch (row.kind) {
    case "ntfy":
      return new NtfyChannel(String(row.config["topic"] ?? ""));
    case "webpush":
      // Phase 3. Deliberately explicit: an unimplemented channel must report a
      // failed send, not silently succeed and leave someone waiting.
      return { async send() { return { ok: false, error: "web push not implemented yet" }; } };
  }
}
