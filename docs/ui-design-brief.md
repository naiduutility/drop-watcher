# Drop Watcher — UI design brief

Design the screens for a small web app. Everything it needs to know is below;
assume no other context.

## What the product does

BookMyShow (India's cinema booking site) puts tickets on sale without warning.
For a big film the good seats go within minutes, and for a **premiere** — a
late-night show the day before general release — the date often doesn't exist
on the site at all until it suddenly does.

Drop Watcher checks BookMyShow every few minutes and pushes a phone
notification the moment a date you care about goes on sale. A group of friends
share one instance. Each person gets their own alerts and their own "stop
telling me about this" switch; nobody can silence anyone else.

## Who uses it, and how

Five to twenty friends in India, who know each other. **They open it on a
phone, usually by tapping a notification**, often standing up and in a hurry
because a premiere just dropped. Desktop is a secondary convenience.

Design **mobile-first**: primary actions within thumb reach, large tap targets,
sheets rather than modals, bottom-anchored primary buttons on long screens.
Then make it work on a wide screen — don't design for desktop and shrink it.

## The single most important design problem

**Silence is ambiguous, and that ambiguity has already cost someone tickets.**

When no notification arrives it can mean either:

- tickets genuinely aren't on sale yet — the system is working perfectly, or
- BookMyShow is blocking us and we cannot see anything at all.

Those look identical from outside and feel identical to someone waiting. The
UI's main job is to make them **unmistakably different at a glance**. A healthy
"nothing yet" should feel calm and reassuring. A blind watch should be visually
alarming and say so in plain words.

This matters more than any other screen decision. Please don't reduce it to a
green or red dot.

## Visual direction

Bright, playful, cinema-flavoured — closer in energy to a ticketing app than to
a dashboard. It should be pleasant to open.

**Hard constraint: there are no film posters or images available.** We never
fetch artwork and adding it isn't planned. Personality has to come from
typography, colour, gradient, shape and motion — not imagery. Please don't
design screens whose appeal depends on a poster, because they'll ship with a
grey rectangle.

Support light and dark. Status must never be carried by colour alone (icon and
text too); several of these states are the difference between "relax" and "act
now", so legibility beats decoration.

## Stack and deliverable

- **React components for Next.js App Router, TypeScript, Tailwind CSS.**
- Server-rendered by default. Keep client state to genuinely interactive bits
  (pickers, copy-to-clipboard, disclosure). Forms post to server actions.
- No third-party component libraries. Icons as inline SVG or `lucide-react`.
- Deliver one component file per screen plus shared pieces, with props typed to
  the data shapes below. Static sample data is fine — the real wiring exists.

"Interactive" means satisfying state transitions, clear pressed and loading
states, a copy affordance that confirms itself, smooth open/close on pickers.
Not heavy animation, and nothing that delays someone trying to book.

## Vocabulary the UI must express

A **watch** is one person's interest in one film, on one date, in one city.

| State | Meaning | Feel |
|---|---|---|
| Waiting | Not on sale yet. Working correctly. | Calm, patient, reassuring |
| On sale | Shows are listed; you've been told | Urgent, celebratory, "go now" |
| Silenced | You tapped "got it" — no more alerts | Muted, clearly reversible |
| Can't read | BookMyShow is blocking us; we're blind | Alarming, apologetic, honest |
| Not checked yet | Brand new, first check pending | Neutral, transient |

"Can't read" carries how long it's been failing, e.g. *"No clean read for 34
minutes — we can't tell you whether tickets are out. This is us failing, not a
quiet box office."*

## Screens

### 1. Join (`/join/[token]`)

Reached via a one-time invite link, sent over WhatsApp. Asks for:

- **Name** — shown to the rest of the group, e.g. "Ravi is watching this too".
- **Email** — how their account is identified. No password, no verification.

States: valid · already claimed · expired · not a real link. Failures should be
friendly and say to ask for a fresh link.

### 2. My watches (`/`) — home

A list of the person's watches. Most people arrive here from a notification, so
each watch's state must be readable in under a second while walking.

Each card: film title, city, the date watched, its state, and for "on sale" the
number of cinemas listed. Tapping opens its detail.

Also here:

- **Their personal notification topic**, with a copy button and a short note
  that they must subscribe to it in the *ntfy* app (a free notification app) to
  receive anything. Skipping this means no alerts at all, so it should be
  prominent for a new user and unobtrusive for an old one.
- A prominent **Add a watch** action.
- An **empty state** — the first thing a new member sees after joining, so it
  should teach rather than apologise.

### 3. Add a watch (`/new`) — two steps

**Step 1 — paste a link.** Three outcomes:

- A **showtimes URL** (contains `/buytickets/`) — good, continue.
- A **film page URL** — unusable, because it lacks the booking code the watcher
  needs, and guessing it produces a watch that silently never fires. Explain
  without jargon and say exactly what to do: *open the film, tap Book tickets,
  pick any date, copy the address bar.*
- Anything else — rejected.

This is the one step where people get stuck, so it needs a genuinely good
explanation. A small illustration of where the URL comes from would earn its
place.

**Step 2 — confirm.** Shows what we understood (film, city, language) and asks:

- **Dates.** The next fortnight, multi-select, each marked *on sale* or *not
  yet*. **The "not yet" dates are the point of the product** — a premiere has
  no shows listed, and that's precisely what people wait for. Picking an
  unavailable date must feel deliberate and correct, never like an error.
- **A name** for it, used in notifications.
- **Cinemas and screens — always optional.** If this city's cinemas are already
  known, show them for selection with the screen formats seen at each (*IMAX*,
  *Dolby Atmos*, *4DX*). If the city isn't known yet, say so and move on.
  **Selecting nothing means "any cinema", the watch is fully armed either way,
  and the UI must make that obvious** — nobody should think a cinema must be
  picked for this to work.
- **If friends already watch this film and date, say so by name**: *"Ravi and
  Meera are watching this — you'll join them."* They share one check behind the
  scenes; each person's alerts stay their own. Make this feel sociable, not
  like a warning.

Re-adding a film and date **you already watch** is refused, with a link to the
existing one.

### 4. Watch detail (`/w/[id]`)

- Current state, large and unambiguous, with the health sentence.
- If on sale: cinemas listed, and a prominent **Book on BookMyShow** link.
- **Who else is watching** — names of other members watching the same film and
  date. This is a group of friends; knowing you're not the only one waiting is
  part of the appeal.
- **Refine cinemas and screens** — the same picker as step 2, now populated from
  what we've actually seen. Optional at every stage.
- **Silence** / **Watch again** — one tap each, always reversible.
- **Delete this watch.** Removes only *theirs*; friends watching the same film
  are untouched, and the copy should say so. A light confirmation is enough —
  it's undone by adding it again.
- A short history of recent checks (time, outcome, cinemas found), so someone
  can answer "is this working?" themselves.

### 5. Silenced / Undo (`/s/[id]/ack`)

A full-page confirmation reached from a notification button. Very simple, very
large, one message and one **Undo**. Variants: just silenced · already silenced
· not signed in on this device.

### 6. Add a device (`/devices/new` and the link it produces)

There are no passwords, so a second device is paired from a signed-in one.

- **On the signed-in phone:** a QR code plus a short link, a visible countdown
  (valid ~10 minutes), and a copy button. Copy should say what it is: *"anyone
  who opens this within 10 minutes signs in as you"*.
- **On the new device:** opening the link shows *"Sign in as Ravi?"* with a
  single confirm. Expired or already-used links get a clear, friendly dead end.

Design the pairing screen for being held up in front of another screen — the QR
large, the countdown obvious.

### 7. Admin — invites (`/admin/invites`)

Only the owner sees this. Everyone else should never know it exists.

- Create an invite and choose how long it's valid. The link is anonymous —
  whoever opens it enters their own name and email.
- A list: unclaimed (with **copy link** and a **share** action, since they go
  out over WhatsApp), claimed (by whom, when), expired.
- Make it obvious a link works **once** and dies the moment it's used.
- Treat an unclaimed link as a secret — it should feel like something handled
  carefully, not a URL left lying around.

## Data shapes

```ts
type WatchState = "waiting" | "on_sale" | "silenced" | "cant_read" | "new";

type Member = { id: string; name: string };

type Watch = {
  id: string;
  title: string;                   // "Avengers: Endgame Encore"
  city: string;                    // "Hyderabad"
  showDate: string;                // "2026-09-26"
  state: WatchState;
  venuesListed?: number;           // when on sale
  lastCleanReadAt?: string | null; // ISO; null = never
  minutesSinceCleanRead?: number;
  cinemas?: Cinema[];              // listed for this date, when on sale
  cinemaFilter?: string[];         // codes; empty = any cinema
  screenFilter?: string | null;    // e.g. "IMAX"; null = any screen
  alsoWatching?: Member[];         // friends on the same film and date
};

// `screens` are formats SEEN at that cinema before, e.g.
// ["Telugu 2D | ATMOS", "IMAX"] — not a guarantee for any given date.
type Cinema = { code: string; name: string; screens: string[] };

type Invite = {
  token: string;
  url: string;
  expiresAt: string;
  claimedBy?: { name: string; email: string; at: string } | null;
};

type DevicePairing = { url: string; qrPayload: string; expiresAt: string };

type CheckRow = {
  at: string;
  outcome: "shows_found" | "not_on_sale" | "blocked" | "error";
  venueCount: number;
};
```

## Please avoid

- Designs that need film posters, backdrops or logos.
- A single status dot doing the work of the status vocabulary above.
- Making cinema selection feel compulsory.
- Burying "we can't read BookMyShow" in small grey text.
- Anything that adds a tap between a notification and booking a ticket.
