# Handoff: Drop Watcher UI

## Overview
Screen designs for Drop Watcher, a small web app for 5–20 friends. It checks BookMyShow every few minutes and sends each person an ntfy push when a date they watch goes on sale, including premiere dates that aren't listed yet. Most visits start from a tapped notification on a phone.

The main design problem: when no alert arrives, it can mean "not on sale yet, all fine" or "BookMyShow is blocking us, we can't see anything". The UI has to make those two cases look completely different. Each watch state has its own surface treatment (fill, border style, icon, words), not just a status dot.

Target codebase: `drop-watcher/site` (Next.js App Router, TypeScript). The existing screens are `src/app/page.tsx`, `src/app/new/page.tsx` and `src/app/join/[token]/page.tsx`, with global CSS in `src/app/layout.tsx`. These designs replace that styling.

## About the design files
The files in `design/` are **design references built in HTML**. They show the intended look and behaviour; they are not production code to copy. Rebuild them in the target stack:

- React Server Components for Next.js App Router, TypeScript, **Tailwind CSS**
- Server-rendered by default. Only these need client state: date picker, cinema picker disclosure, copy-to-clipboard, the device pairing countdown, the delete confirmation, the invite reveal toggle, and the live URL check in Add step 1.
- Forms post to server actions (silence/unsilence, delete, add watch, join, create invite, confirm device).
- No third-party component libraries. Icons from `lucide-react` (every inline SVG in the mocks is a Lucide icon; names are listed below).
- One component file per screen, plus shared pieces (`WatchCard`, `CinemaPicker`, `HealthBanner`, `CopyField`, `AppHeader`, `StickyAction`).

To view the mocks, open `design/Drop Watcher.dc.html` in a browser (serve the folder locally; don't open it via file://). It lays out every screen and state side by side. Each screen file takes a `variant` prop that picks the state.

## Fidelity
**High fidelity.** Colours, type, spacing, copy and interactions are final. Match them closely. All copy in the mocks is final wording.

## Design system: Modernist
Flat and architectural. Single typeface (Archivo). Near-monochrome ink on a light ground with one red accent. **No border radius anywhere**, strong 2px rules between sections, and labels flush left (inside buttons too: label on the left, icon on the right, `justify-content: space-between`).

### Tokens (light)
```
--color-bg        #f3f2f2   page ground
--color-surface   #eae9e9   filled panels (waiting card, health banner)
--color-text      #201e1d   ink
--color-accent    #ec3013   primary action, brand mark
--color-divider   rgba(32,30,29,.40)   2px section rules, 1px row rules

neutral 100 #f8f4f4  200 #eae7e7  300 #d7d3d3  400 #bab6b6  500 #9b9797
        600 #7d7979  700 #605d5d  800 #444141  900 #2d2b2b
accent  100 #fff2ef  200 #ffe0d9  300 #ffc4b8  400 #ff9783  500 #ff563c
        600 #dd2b0f  700 #ae1800  800 #7c1405  900 #4d170e
```
- The on-sale red field is `accent-600` (#dd2b0f) with white text.
- For paragraph-size red text on the ground use `accent-700` (#ae1800); the base accent is only 3:1.
- Secondary/muted text is `neutral-700` (#605d5d); body text on panels is `neutral-800`.
- Links: `accent-700`, hover `accent-800`.

### Tokens (dark, via `prefers-color-scheme: dark`)
```
bg #171514   surface #262322   text #f1efee   divider rgba(241,239,238,.32)
neutral 100/200 #2d2b2b  300 #444141  400 #605d5d  500 #7d7979  600 #9b9797
        700 #bab6b6  800 #d7d3d3  900 #eae7e7
accent  100 #4d170e  300 #7c1405  700 #ff9783  800 #ffc4b8  900 #ffe0d9
```
The "can't read" surfaces are always #201e1d with #f3f2f2 text, in both modes, so they look the same everywhere. The white Book button on the red field always uses **#9a1f0b** for its label and icon (a fixed value, not a theme variable, so dark mode can't wash it out).

### Type (Archivo 400/600/800, Google Fonts)
- Display: 44–64px / 800 / line-height .92–.98 / letter-spacing −0.04 to −0.05em
- Screen H1: 28–36px / 800 / −0.025 to −0.035em
- Section H2: 20–22px / 800 / −0.015em
- Card title: 17–20px / 800 / lh 1.1–1.15 / −0.015em
- Body: 15–17px / 400 / lh 1.45–1.5
- Kicker: 11–13px / 600 or 800 / uppercase / letter-spacing .1–.14em
- Big numerals (cinema count, minutes blind, countdown): 56px / 800 / lh .9 / −0.04em, `tabular-nums`
- Use `text-wrap: pretty` on headings and paragraphs.

### Layout rules
- Mobile first at 390px. Page padding 16px. Content `max-width`: Home 1120px, Detail 880px, Add/Admin 720px, Join/Silenced 640px, Devices 560px.
- Tap targets are at least 44px. Primary buttons are 54–64px tall.
- On long screens, keep a sticky bottom action bar: `bg` fill, 2px top rule, 12px 16px padding, a full-width primary button.
- Header: sticky, 2px bottom rule. The brand mark is a 26px accent square with a white `Ticket` icon, next to "Drop Watcher" at 17px/800. The avatar is a 32px ink square with the initial in `bg` colour.
- Home watch grid: `repeat(auto-fill, minmax(min(100%,330px),1fr))`, gap 12px. It reflows to 3 columns on desktop.
- Focus: `outline: 2px solid var(--color-accent); outline-offset: 2px`.
- Disabled controls: 45% opacity.

## State vocabulary (WatchCard)
All cards share a 2-column grid: a 68px date column (weekday 11px caps / day 30px 800 / month 11px caps, with a right rule) and a content column with 14px padding. The **whole card is the link** to `/w/[id]`, except the Book button, which goes straight to BookMyShow (no extra tap).

| State | Surface | Icon (lucide) | Line |
|---|---|---|---|
| `on_sale` | Solid `accent-600`, white text, white 45% date rule | `Ticket` | "On sale now" kicker; "{city} · {n} cinemas listed"; full-width white button "Book on BookMyShow" (48px, label #9a1f0b, `ArrowUpRight`) |
| `cant_read` | #201e1d. An **8px hazard-tape strip** on top: `repeating-linear-gradient(-45deg, accent 0 8px, #201e1d 8px 16px)` | `EyeOff` in `accent-400` | "Can't read · {m} min"; "No clean read for {m} minutes. We can't tell you whether tickets are out."; 44px outlined button "Check BookMyShow yourself" |
| `waiting` | `surface` fill; hover `neutral-300` | `Clock` | "Waiting · not on sale yet"; then `Check` "Reading fine · checked {lastRead}" in neutral-700 |
| `new` | 2px **dashed** divider border, no fill | spinning `LoaderCircle` (1s linear) | "First check pending · a few minutes" |
| `silenced` | 2px `neutral-300` solid outline, no fill, all text neutral-700 | `BellOff` | "Silenced · no alerts"; inline secondary button "Watch again" (44px) |

Status is never carried by colour alone: every state has its own icon, its own words, and a different fill/border treatment.

## Screens

### 1. Join — `/join/[token]` (`Join.dc.html`)
- **Valid:** a red `accent-600` hero with the brand mark (white square, red icon), a "You're invited" kicker, H "Know the minute tickets drop." (44px), and a sub line. Below it: a Name field ("Friends see it: "{name} is watching this too"." with a live preview, falling back to "Ravi"), an Email field ("Only used to tell accounts apart. No password, and we never email you."), and a 2px rule with a `Lock` line: "This invite works once. After you join, it's gone." Sticky button "Join Drop Watcher" is disabled until name is filled and email contains "@". While submitting it shows "Joining…" with a spinner.
- **Dead states** (claimed / expired / invalid): header, a 64px outlined square with a `Unlink` icon, kicker, H1 38px, body plus "Ask whoever sent it for a fresh one. It takes them ten seconds." Sticky primary button: "Ask for a new link on WhatsApp" → `wa.me/?text=…`. Copy per state:
  - claimed: "Already used" / "Someone's already joined with this invite." / "Invites work once, and this one has been claimed."
  - expired: "Expired" / "This invite ran out of time." / "Invites only stay open for a while, and this one closed."
  - invalid: "Not a real link" / "We don't recognise this invite." / "The link may have been cut short when it was copied."

### 2. My watches — `/` (`Home.dc.html`)
- The header has the brand, a `Smartphone` icon button (→ `/devices/new`), and the avatar.
- **The health banner comes first, above all cards.** It is computed from whether any watch is `cant_read`:
  - Healthy: `surface` panel with a 44px outlined square and an `Eye` icon. Kicker "BookMyShow · reading fine". 22px/800 "We can see clearly. If it's quiet, it's genuinely quiet." Then "Last clean read 2 min ago · next check in about 3 min".
  - Blind: `role="alert"`, #201e1d panel with a 12px hazard strip. `EyeOff` kicker "BookMyShow is blocking us" in accent-400. 32px "We're blind right now." Then "No clean read for {m} minutes. Silence from us means nothing until this clears. This is us failing, not a quiet box office." A 52px light button "Check BookMyShow yourself", and the footnote "We retry every few minutes. This goes away on the first clean read."
- "Your watches" H1 28px with a count line such as "1 on sale · 2 waiting", and a 2px bottom rule. Then the card grid. Sort order: on sale, can't read, waiting, new, silenced.
- **Topic row (returning user):** a slim strip between 2px rules. `Bell` icon, "Your alerts go to ntfy topic", the topic in 15px/600, and a secondary "Copy" button.
- **Empty state (new user):** kicker "You're in, {name}" in accent-700, then H1 36px "Two minutes of setup, then we watch so you don't have to." Below that, 3 numbered steps (40px accent numerals, 2px ink top rule, 2px divider between steps; 3 columns on desktop):
  1. "Turn on alerts". A large copy field (2px ink border) with the topic at 17px/800 and an attached accent "Copy" button, plus an outlined "Open ntfy and subscribe" link.
  2. "Paste a showtimes link".
  3. "Pick the dates you want".
- A sticky bottom "Add a watch" primary button (54px, `Plus`) on every Home variant.

### 3. Add a watch — `/new` (`AddWatch.dc.html`)
The header has back, "Add a watch", and a 2-segment progress bar (24×4px each, accent when done) with "Step n of 2".

**Step 1: paste a link**
- H1 32px "Paste a showtimes link" and a sub line.
- The URL field has a 2px border and an attached "Paste" button (`ClipboardPaste`) that reads the clipboard.
- The link is checked live on every keystroke:
  - contains `bookmyshow.com` and `/buytickets/` → **good**: ink border, `Check` "That's a showtimes link. Good to go.", Continue enabled.
  - `bookmyshow.com` plus `movies` without buytickets → **film page**: accent-700 border, plus an `accent-100` panel (text accent-900) with kicker "Nearly · one more step", 22px "That's the film's page. We need the page after it.", an explanation, and 4 numbered steps (open film → tap **Book tickets** → pick any date → copy address bar).
  - anything else → **rejected**: accent-700 border and an `X` line "That isn't a BookMyShow link. Copy it from the BookMyShow app or site, then paste it here."
- Below that, a permanent "Where the link comes from" illustration: 3 wireframe phone panels (3:4 aspect, 2px ink border) showing Film page → Pick date → Address bar, then a "This one works" example URL with `buytickets` highlighted in an accent mark, and a "This one doesn't (film page)" example in a dashed box.
- Sticky "Continue" is disabled unless the link is good.

**Step 2: confirm**
- Kicker "We found", the film at 34px/800, and neutral tags for city (`MapPin`) and language.
- **Friends banner** (when others watch this film): an ink-filled strip with overlapping 36px initial squares (-8px overlap), 17px/800 "Meera and Arjun are watching this. You'll join them." and "On Sat 26 and Wed 30. Your alerts stay your own."
- **Dates:** H2 "Which dates?" plus "Pick as many as you like. Dates with nothing on sale yet are the whole point: that's where a premiere appears." A legend (`Ticket` On sale, `Hourglass` Not yet, `Bell` Already yours). Then a 7-column grid of 14 day tiles (min-height 70px, 4px gap): weekday 10px caps, day 20px/800, icon at the bottom.
  - On sale, unselected: 2px solid divider border.
  - Not yet, unselected: 2px **dashed** divider border. It is still a normal, full-contrast choice, not a disabled one.
  - Selected (either kind): solid `accent-600` fill, white text. Press scales to .95.
  - Already yours: `neutral-200` fill, neutral-600 text. Tapping it shows a refusal box (2px ink): "You already watch **{date}** for this film. One watch per date." with an "Open it" button → the existing watch.
- Under the grid, a running list of picked dates, each with a note: "On sale now. We'll alert you on the first check." or "Not on sale yet. We'll wait for it." Shows "No dates picked yet." when empty.
- Field "Name in your alerts" with the hint: Your notification will read "{name} is on sale".
- `CinemaPicker` (below).
- Sticky footer: a hint line ("Pick at least one date" or "Any cinema in {city} unless you narrow it · alerts go to your ntfy") and a primary button "Start watching {n} date(s)" (`Bell`), disabled when n = 0, showing "Starting…" with a spinner while submitting.

### CinemaPicker (shared: Add step 2 and Watch detail) (`CinemaPicker.dc.html`)
- A disclosure between 2px rules. The header button (min 56px) has kicker "Cinemas and screens · optional", a 16px/800 summary ("Any cinema, any screen" / "Any cinema · IMAX" / "AMB Cinemas · any screen" / "2 cinemas · IMAX"), and a `ChevronDown` that rotates 180° over .2s.
- **Always visible, even when collapsed:** an armed line with an accent-700 `Check`: "Nothing picked means every cinema in {city}. This watch is fully armed as it is." It updates as the user picks, e.g. "Only AMB Cinemas, Prasads Multiplex, IMAX screens. Clear it to go back to every cinema."
- Open/close animates `grid-template-rows` 0fr↔1fr over .22s ease.
- Body: "Screen format" chips (Any screen / IMAX / Dolby Atmos / 4DX; 40px, 2px border; selected = accent-600 fill), then the note "Cinemas we've seen in {city}. Formats are what we've spotted there before, not a promise for your date." Then cinema rows (56px, 1px top rule): a 22px checkbox square (accent-600 fill with a white tick when on), the name at 15px/600, and neutral tags for seen screens. A ghost button "Back to any cinema" appears when anything is selected.
- **Unknown city:** "We haven't seen {city}'s cinemas yet, so there's nothing to pick from. That's fine: your watch covers every cinema, and once shows appear you can narrow it from the watch's page."
- Empty `cinemaFilter` = any cinema. `screenFilter` null = any screen.

### 4. Watch detail — `/w/[id]` (`WatchDetail.dc.html`)
The header has a back link "Your watches" (`ArrowLeft`) and the avatar. The hero section is full-bleed, with inner max-width 880px and padding 22px 16px 20px:
- **on_sale:** accent-600 field. `Ticket` kicker "On sale now", title 36px, "{Saturday 26 September} · {city}". A count row between white 50% rules: "14" at 56px plus "cinemas listed / found 18:42, 1 min ago". A **white 60px "Book on BookMyShow"** button (label #9a1f0b, 19px/800, press scale .98). A 48px white-outlined "Got it, stop alerting me" (`BellOff`).
- **waiting:** surface panel. Kicker date · city, title 30px. Status row: a 48px outlined square with `Clock`, "Waiting. All good." at 26px/800, "Not on sale yet". Body: "We read BookMyShow cleanly 2 minutes ago. Nothing is listed for {date} yet. The moment it is, your phone buzzes."
- **cant_read:** `role="alert"`, #201e1d with a 14px hazard strip. Kicker "{title} · {date}", `EyeOff` "Can't read BookMyShow" in accent-400, 36px "We're blind to this watch." A big "34" in accent-400 with "minutes without / a clean read". The health sentence: "No clean read for 34 minutes — we can't tell you whether tickets are out. This is us failing, not a quiet box office." A 56px light button "Check BookMyShow yourself".
- **silenced:** no fill, 2px bottom rule, title and status in neutral-700, `BellOff` "Silenced". Body: "You won't get alerts for this date. We still check it, and Meera and Arjun still get theirs." A primary "Watch again" button (56px, `Bell`).
- **new:** 2px dashed rules, spinner, "First check pending", "Your watch is armed. The first read usually lands within five minutes, and this page will say what we found."
- **Last-12-checks strip** (in the waiting and cant_read heroes): 12 equal cells, 22px tall, 3px gap, each with an icon (`Check` for a clean read, `X` for blocked/error) and a title tooltip. Waiting: ink cells. Shows found: accent-600. Can't-read hero: clean = #605d5d, blocked = accent. Caption: "Last 12 checks · every one clean" / "· 7 blocked in a row · last clean read 18:07" / "· shows appeared at 18:37".

Below the hero (`main`, max-width 880px):
- On sale only: "Listed for {date}", then cinema rows (name 15px/600 plus screen tags) and "and 10 more on BookMyShow".
- "Watching with you": 40px overlapping initial squares and "**Meera and Arjun** are waiting on this date too. Same check, separate alerts."
- `CinemaPicker`, filled from the cinemas actually seen.
- "Recent checks" table ("every ~5 min") with columns Time 56px / What we saw / Cinemas 64px right-aligned, `tabular-nums`, 11px caps header over a 2px rule, 1px row rules, 8 rows. Blocked rows use accent-700/800; shows-found rows use 800. Labels: "Clean read · nothing listed", "Clean read · shows listed", "Blocked by BookMyShow", "Error on our side".
- For waiting/cant_read/new: an "Alerts are on" row with "Only you are affected. Undo any time." and a secondary "Silence" button.
- Delete: a ghost "Delete this watch" (`Trash`, accent-700) swaps inline to a 2px ink confirm box: "Delete your watch for {date}?" / "Only yours goes. Meera and Arjun keep watching and still get their alerts. You can add it back any time." with buttons "Delete mine" (primary) and "Keep it" (secondary), 48px each, side by side.
- Silence and Watch again flip the hero immediately (optimistic update), then post to the server action.
- At 1280px the layout stays single-column at 880px, centred.

### 5. Silenced / Undo — `/s/[id]/ack` (`Silenced.dc.html`)
Header with the brand only. Top padding 48px. A 56px `BellOff`, then H1 **64px** "Silenced." (or "Already silenced."). A film box between a 2px ink rule and a 2px divider: title 20px/800, "Sat 26 Sep · Hyderabad". Body copy:
- just: "No more alerts for this date. Only yours: friends watching it still get theirs."
- already: "You'd already told us to stop for this date. Nothing changed."

Sticky 64px **ink-filled** button "Undo" (or "Watch again" when already silenced), with a `Undo2` icon, 20px/800, press scale .98. Below it, a ghost "See all your watches". After Undo: an accent `Bell`, "Alerts back on.", "You'll hear from us again for this date.", and a secondary "Silence it again".
- Signed out: `Smartphone` icon, 48px "This phone isn't signed in.", "So nothing was silenced, and your alerts for this date are still on. Pair this phone from one that's signed in, then tap the notification again.", and a primary "How to pair this phone".

### 6. Add a device — `/devices/new` and `/p/[code]` (`Devices.dc.html`)
- **Signed-in phone:** header with back and "Add a device". The line "Scan this with the camera on your other phone or laptop. It signs in as you." A **full-width QR** (white, 16px padding, 2px ink border). A countdown `m:ss` at 56px/800 tabular with "left before this code stops working", and an 8px bar (neutral-300 track, accent fill, 1s linear) that shrinks from 100% over 10 min. Under 60s the clock turns accent-700. At 0 the QR fades to 15% opacity and the note reads "expired. Go back and make a new one." Then a 2px rule, "Or send yourself the link", a copy field (the link at 16px/600 with an attached accent "Copy" button → "Copied" on ink), and an accent-700 `Lock` warning: "Anyone who opens this within 10 minutes signs in as you. Send it only to yourself."
- **New device:** a 72px ink avatar square, H1 52px "Sign in as Ravi?", "This link came from Ravi's signed-in phone. Continue only if you're Ravi. You'll see his watches and can silence his alerts." Sticky 58px primary "Yes, sign me in" (`LogIn`; "Signing in…" with spinner), plus a ghost "I'm not Ravi".
- **Dead (expired/used):** a 64px outlined `Clock` square, H1 44px "This link has expired." / "This link has already been used.", the reason, and "On a phone that's already signed in, open the menu and tap **Add a device** for a fresh one."

### 7. Admin: invites — `/admin/invites` (`AdminInvites.dc.html`)
Owner only. Return a 404 for everyone else and never link to it. The header has back, "Invites", and a neutral "Owner only" tag with `Lock`.
- A "New invite" surface panel: "The link doesn't carry a name. Whoever opens it first types their own name and email, and the link dies the moment they do." Then "Valid for" as a 3-cell segmented control (2px ink frame; 1 hour / 1 day / 7 days; selected = ink fill), and a primary "Create invite link" (`Plus`). A new invite appears at the top of Unclaimed with an accent-100 flash that fades over .6s.
- **Unclaimed** (H2 over a 2px ink rule, "{n} · each works once"): each row has a `Lock`, the link **masked** as `dropwatcher.in/join/••••••••{last4}`, an `Eye` toggle to reveal/hide it, "Made {when} · expires {when}", and two 48px buttons: outlined "Copy link" (`Copy`; turns ink-filled "Copied" for 1.8s) and accent "Share" (`Share2` → WhatsApp / Web Share API).
- **Claimed** ("link is dead"): a 36px ink initial square, name 15px/800, email neutral-700, and the date on the right.
- **Expired** ("never opened"): muted row with the masked link struck through and "expired Mon 21 Sep".

## Interactions and behaviour
- **Copy (all instances):** writes to the clipboard, the label swaps to "Copied" with a `Check`, and the fill flips (accent→ink or transparent→ink) with a .15s background transition, then reverts after 1800ms.
- **Pressed:** primary CTAs scale(.98), date tiles scale(.95), .08s.
- **Loading:** submit buttons swap their label to "…ing…" and their trailing icon to a spinning `LoaderCircle`, and are disabled.
- **Hover:** the waiting card goes to neutral-300; outlined buttons on dark/red fields get a 10–12% white tint. Other hover states come from the DS `.btn` classes (see `styles.css`).
- Nothing animates on page load. Nothing may delay the Book link.

## State and data
Use the data shapes from the brief (`WatchState`, `Watch`, `Cinema`, `Invite`, `DevicePairing`, `CheckRow`) as props. Derived values:
- `anyBlind = watches.some(w => w.state === "cant_read")` → Home banner variant; minutes = the max `minutesSinceCleanRead`.
- `isNewUser = watches.length === 0` → empty state and prominent topic; otherwise the slim topic row.
- Card date column from `showDate` (weekday/day/month, en-IN).
- Detail strip = the last 12 `CheckRow`s; the table = the last 8, newest first.
- URL classification (step 1) runs on the client for instant feedback. Validate again in the server action.

## Assets
No images, by design. The only raster-free "illustration" is the CSS wireframe in Add step 1. Icons are all from `lucide-react`: Ticket, EyeOff, Eye, Clock, Check, X, LoaderCircle, BellOff, Bell, ArrowUpRight, ArrowRight, ArrowLeft, Plus, Smartphone, MapPin, Hourglass, ClipboardPaste, ChevronDown, Trash, Lock, Copy, Share2, Unlink, Undo2, LogIn. Font: Archivo 400/600/800 via `next/font/google`.

## Files
- `design/Drop Watcher.dc.html`: overview canvas of every screen and state (open this first)
- `design/WatchCard.dc.html`: the 5 watch states
- `design/Home.dc.html`: `/` (returning, blind, new)
- `design/AddWatch.dc.html`: `/new` (paste, good, film, rejected, confirm, unknown_city, duplicate)
- `design/CinemaPicker.dc.html`: shared picker
- `design/WatchDetail.dc.html`: `/w/[id]` (waiting, on_sale, cant_read, silenced, new)
- `design/Silenced.dc.html`: `/s/[id]/ack` (just, already, signedout)
- `design/Devices.dc.html`: pairing (pair, confirm, expired, used)
- `design/AdminInvites.dc.html`: `/admin/invites`
- `design/Join.dc.html`: `/join/[token]` (valid, claimed, expired, invalid)
- `design/_ds/.../styles.css`: Modernist tokens and `.btn`/`.tag`/`.input` classes (map these to Tailwind theme values)
