# 🔔 Drop Watcher

Watches **any number of BookMyShow movie pages** for ticket **booking
opening**, then pushes a phone notification (via **ntfy**) — runs free on
**GitHub Actions**, so your laptop doesn't need to be on.

---

## Which movies it watches

Targets live in [`movies.json`](movies.json) — one object per movie:

```json
[
  {
    "id": "ET00514163",
    "name": "Avengers: Endgame Encore",
    "city": "Hyderabad",
    "url": "https://in.bookmyshow.com/movies/hyderabad/avengers-endgame-encore/ET00514163",
    "book_code": "ET00516728",
    "show_dates": ["2026-09-26", "2026-09-27"],
    "language": "english",
    "theatres": [
      "AMB",
      "Prasads",
      {"venue": "Allu Cinemas Kokapet", "screens": ["IMAX"]},
      {"venue": "AAA Cinemas", "screens": ["Dolby Atmos", "4DX"]}
    ],
    "enabled": true
  }
]
```

| Field       | Notes                                                          |
|-------------|----------------------------------------------------------------|
| `url`       | **Required.** The BMS movie page URL.                          |
| `id`        | Stable key for acknowledgements. Defaults to the `ET…` code parsed from the URL. |
| `name`      | Shown in the notification title. Defaults to the `ET…` code.   |
| `city`      | Shown in the notification title. Defaults to `Hyderabad`.       |
| `theatres`  | Preferred theatres to watch for — a venue string, or `{"venue": ..., "screens": [...]}` to watch particular screens there. Empty/omitted = don't check theatres at all. |
| `screens`   | Optional. Screens to watch at every plain-string theatre, for when you want one format everywhere. Per-theatre `screens` override it. |
| `language`  | Optional. Narrows the showtimes lookup for a multi-language release (e.g. `"telugu"`). Omitted = whatever language BMS serves. |
| `book_code` | Optional. The **booking** event code, when it differs from the movie page's — see below. Omitted = the code in `url`. |
| `show_date` | Optional `YYYY-MM-DD`. The date to read showtimes for, when booking opens ahead of release. |
| `show_dates` | Optional list of `YYYY-MM-DD`. **Watch several dates at once** — each is checked, alerted and acked on its own. Combines with `show_date`; dates already past are dropped. |
| `watch_shows` | Optional. `true` = alert the moment a watched date has **any** show listed, whatever the theatre — the premiere case, see below. |
| `ntfy_topic` | Optional. Send this movie's alerts to a topic of its own instead of `NTFY_TOPIC`. Write it as `"${SECRET_NAME}"` to read the topic from the environment rather than committing it. |
| `ntfy_ack_topic` | Optional. Ack topic for a movie with its own `ntfy_topic`. Defaults to `<ntfy_topic>-ack`, never the shared ack topic. |
| `showtimes_url` | Optional. A complete showtimes URL, used verbatim, when none of the above gets you the right page. Pins **one** date, so it needs editing once that date passes and cannot be used with `show_dates`. |
| `enabled`   | Set `false` to park a movie without deleting it. Defaults to `true`. |

**To add a movie:** copy the URL from BookMyShow, append a block, commit. All
movies are checked in a **single** Actions run that reuses one browser, so each
extra movie costs ~20s — not a whole new job.

### When the movie page's code is not the booking code

Usually the `ET…` code in the movie URL is also the one the showtimes path
uses, and nothing needs setting. But a **re-release or a per-language event
gets its own booking code**, and the two then differ:

```
page :  /movies/hyderabad/avengers-endgame-encore/ET00514163
shows:  /movies/hyderabad/avengers-endgame-encore/buytickets/ET00516728/20260925
```

Getting this wrong is the nastiest failure this watcher has, because it does
not look like a failure: BMS serves **HTTP 200 with zero venue records**, so
the theatre check reports "no venues" forever while booking is wide open. Set
`book_code` to the code in the *buytickets* URL — open the movie on BMS, click
through to showtimes, and read it out of the address bar.

`show_date` has the same shape of failure behind it. A movie whose booking has
opened for a future release has **no shows today**, so a lookup for today
returns an empty page. Set it to the date you actually want to watch on and
the check asks for that day.

### Watching more than one date

When any of a few days would do, list them:

```json
"show_dates": ["2026-09-26", "2026-09-27", "2026-09-28"]
```

Each date is a **separate watch**: its own showtimes lookup, its own alerts and
its own acks. `AMB (HDR By Barco)` going live on the 27th tells you so in the
title (`… now has shows on Sun 27 Sep!`), and tapping *Got it* there leaves the
26th — the day you actually wanted — still being watched. The booking-open
alert grows one block per date:

```
Sat 26 Sep:
  Your theatres with shows (1):
    - AMB Cinemas: Gachibowli - HDR By Barco

  Still waiting on:
    - PRHN (PCX): listed, running English • 2D

Sun 27 Sep:
  None of your theatres yet (71 other venue(s) listed). …
```

Two things to keep in mind. **A date that has passed is dropped**, not rolled
forward to today — a lookup for a past day returns an empty page, which is the
same silent zero-venue failure `show_date` exists to avoid. If every listed
date has passed, the check falls back to today and to the old, undated acks.
And **each date costs a page load** (plus the `SHOWTIMES_DELAY_MS` pause), only
while booking is open and something on that date is still unaccounted for — so
a handful of dates is fine, a fortnight of them makes each run minutes long.

### Waiting for one date to go on sale (premieres)

A film releasing on the 24th with a **premiere on the 23rd** breaks the usual
flow: booking is *already open*, so the booking-open alert fires at once and
tells you nothing you didn't know. The news you are waiting for is the 23rd
itself appearing on BookMyShow — a fact about the **date**, not about any
cinema, so no theatre watch can deliver it.

```json
{
  "show_dates": ["2026-09-23"],
  "watch_shows": true
}
```

Each run reads that date's showtimes page and stays silent while it is empty
(*"no shows on sale yet"* in the log — a normal state, not a failure). The
moment anything is listed you get:

```
The Paradise: shows are UP for Wed 23 Sep!

Shows just appeared for Wed 23 Sep in Kakinada. Book now:
https://in.bookmyshow.com/…/buytickets/ET00518514/20260923?etCodes=*&language=telugu

  - Vijaya Lakshmi Cinemas: Kakinada
  - Sri Gowri Cinemas: Kakinada
```

Its **Book now** button goes straight to that date's showtimes page rather
than the movie page, whose CTA would only reopen the format picker. Like every
other alert it repeats each run until acked, and its ack
(`<id>@shows@<date>`) covers that date alone.

This combines with `theatres`: `watch_shows` says *"the date went on sale"*,
a theatre watch says *"and it is at the cinema you wanted"*. With no
`theatres` listed, any venue in the city counts — which is usually what you
want for a premiere, where whichever screen opens first is the one you book.

> **BookMyShow never says "no shows on this date".** Asked for a date with
> none, it silently serves the next date that *has* them — HTTP 200, full
> venue list, no error. A request for the 23rd came back carrying the 24th's
> five Kakinada venues, which read as *"the premiere is on sale"* and fired a
> false alert. Every showtimes payload is therefore checked against the date
> that was actually requested, and a mismatch is reported as *no shows on
> sale yet*.
>
> Two signals do that, because the obvious one is not enough on its own. The
> date strip (`"dateCode"`) lists a 23rd chip whenever the premiere exists
> *somewhere in the country*, even where your city has nothing — so the
> authority is `"showDate"`, the single date the payload was built for. A
> payload carrying neither key is passed through with a loud warning rather
> than treated as empty: an unrecognised shape must not silence the watcher.

> **`book_code` matters even more here.** With the wrong code the showtimes
> page is empty *for every date*, so a watch that says nothing looks exactly
> like a premiere that hasn't dropped. Confirm it once by opening the date
> that **is** already bookable in a browser and reading the code out of the
> URL.

> The run log tells these apart. A zero-venue payload is reported as either
> *"no shows listed for this date/language"* (wrong code, wrong date, or
> genuinely nothing on) or *"payload shape changed, VENUE_RE is stale"* (the
> venue list is there but the parser no longer recognises it) — counted from
> the raw `venueCode` keys rather than guessed.

---

## How it detects a release

It loads each movie page in a **real headless Chromium** (BookMyShow blocks
plain HTTP requests with anti-bot), waits for the movie's CTA
(`#page-cta-container`) to render, then decides "booking is open" using:

1. **Primary** — the CTA button's **`data-phase="postRelease"`** attribute.
   This is structural, so it survives wording/localisation changes. Pre-release
   pages don't render this container at all.
2. **Backup** — the CTA / page text reads **"Book tickets"** (or "Book now").

Both signals were verified against a live *bookable* BMS page and confirmed
absent on the pre-release page. (An earlier `/buytickets/` href check was
dropped — that link never appears even when bookable, because the button
navigates via JavaScript, not an `<a href>`.)

If a page looks blocked/unrendered (tiny body or an anti-bot marker), **that
movie** is reported as failed and the run exits non-zero (visible in the
Actions tab) — but the other movies are still checked first. One blocked page
never hides another movie's release.

The marker list includes Cloudflare's interstitial wording (`you have been
blocked`, `attention required`, …). That matters: a captured real 403 page had
a 691-char body and matched none of the original markers, so it would have
passed the sanity check and been read as a harmless "not open yet" — silencing
the watcher indefinitely.

---

## Alerts and acknowledgement

**An ack silences one alert, not one movie.** A movie's booking-open alert and
each watched theatre or screen are separate notifications with separate acks,
because they answer different questions: "tickets exist" is not "the screen I
would actually book is open". Acking the first used to silence the second,
which is precisely the alert you were waiting for.

| Alert                              | Behaviour                                   |
|------------------------------------|---------------------------------------------|
| Not open yet                       | silent                                      |
| Booking open, un-acked             | alerts on **every run** (~5 min)            |
| A watched date goes on sale (`watch_shows`) | its own alert, repeating every run |
| A watched screen goes live, un-acked | its own alert, repeating every run        |
| The same screen on another watched date | a separate alert, with a separate ack  |
| Acked                              | that alert alone stops; the rest keep going |
| *Booked - stop all* tapped         | the whole movie goes quiet, permanently     |

Each alert carries three buttons — ntfy's hard maximum, and a fourth would be
rejected outright, taking the whole notification with it:

- **Book now** — opens the BMS page.
- **Got it - …** — the narrow ack. On the booking-open alert it reads *open
  alert*; on a theatre or screen alert it silences that one item only, leaving
  the same venue's other screens alone.
- **Booked - stop all** — "I have booked, I am done with this film". The only
  way to silence a screen you have not been told about yet.

A movie is skipped entirely only once every one of its alerts is acked, or
*stop all* has been tapped.

### Sending one movie to its own topic

By default every movie publishes to `NTFY_TOPIC`. A movie can have a topic of
its own — a film you are watching with friends who shouldn't get your whole
list, or one you want on a separate phone:

```json
{
  "name": "The Paradise",
  "ntfy_topic": "${NTFY_TOPIC_PARADISE}"
}
```

A topic name **is** the password in ntfy, so committing one to a public repo
hands it to everyone. Written as `"${NAME}"` the value is read from the
environment instead — a GitHub secret, exactly like `NTFY_TOPIC` — and only
the *name* of the secret lives in `movies.json`. Add the matching line to the
workflow's `env:` block:

```yaml
NTFY_TOPIC_PARADISE: ${{ secrets.NTFY_TOPIC_PARADISE }}
```

A literal topic (`"ntfy_topic": "paradise-9f3k2x"`) also works, for a private
repo or a local run.

The **ack topic follows the alert topic**: a movie on its own topic acks to
`<its topic>-ack` unless it sets `ntfy_ack_topic`, and never to the shared
one — otherwise a tap from whoever you shared the topic with could silence it
for you. Each run polls every ack topic in play, plus `NTFY_ACK_TOPIC`, so an
ack sent before a movie was moved still lands.

> If the referenced secret is missing, the run says so loudly and falls back
> to `NTFY_TOPIC`. An alert on the wrong topic is noisy; an alert published
> nowhere is the one failure this watcher exists to prevent.

---

## Preferred theatres and screens

List theatres per movie and each alert tells you which of them already have
shows — and, when you asked for a particular screen, whether *that screen* is
running yet:

```
Avengers: Endgame Encore tickets are LIVE in Hyderabad!

Booking just opened on BookMyShow. Tap to book now:
https://in.bookmyshow.com/movies/hyderabad/avengers-endgame-encore/ET00514163

Your theatres with shows (1):
  - AAA Cinemas: Ameerpet - Dolby Atmos

Still waiting on:
  - AMB (IMAX): listed, running English • 2D | LED SCREEN DOLBY ATMOS
  - Prasads (PCX): not listed yet
```

(With `show_date`/`show_dates` set, each of those blocks is headed by the date
it describes — see [Watching more than one date](#watching-more-than-one-date).)

Those last two lines are the point of the screen filter. *Listed, running …*
means the theatre is onboarded but not on the screen you want; *not listed
yet* means the theatre itself hasn't appeared. Without it, a theatre going
live reads as "done" even when the only screen you'd actually book is still
missing.

An entry matches a venue by **exact venue code**, or when **every word in the
entry appears as a whole word in the venue name** (order and punctuation
ignored). So `"PVFS"`, `"pvr nexus"` and `"PVR: Nexus"` all find
*PVR: Nexus Mall Kukatpally, Hyderabad*. Codes are the trailing segment of a
venue's BMS URL (`/cinemas/hyderabad/pvr-nexus-mall-kukatpally-hyderabad/PVFS`)
— use them when a name is ambiguous.

### Watching a specific screen

A theatre entry may be an object naming the screens that matter there:

```json
"theatres": [
  "Prasads",
  {"venue": "AMB", "screens": ["IMAX", "4DX"]},
  {"venue": "AAA Cinemas", "screens": ["Dolby Atmos"]}
]
```

To want one format across every theatre, set `screens` at the movie level
instead — it applies to each plain-string entry, and a theatre's own `screens`
overrides it:

```json
"theatres": ["AMB", "Prasads", "AAA Cinemas"],
"screens": ["IMAX"]
```

Screens are matched by the **same word rule as venues**, against the format
BMS records per showtime (`English • 2D | LED SCREEN DOLBY ATMOS`). So
`"IMAX"` matches an IMAX 2D and an IMAX 3D show, `"dolby atmos"` matches
*LED SCREEN DOLBY ATMOS*, `"IMAX 3D"` narrows to the 3D one, and `"PCX"`
matches nothing but PCX.

**Each venue+screen pair is watched separately, on each watched date.**
`AMB (IMAX)` and `AMB (4DX)` each get their own first-seen alert and their own
state marker, so AMB opening 4DX never marks its IMAX as done — and with
`show_dates` set, `AMB (IMAX)` on the 26th and on the 27th are two watches
again.

> A screen whose format BMS cannot tell us is reported as
> `screens unreadable`, never as absent. "We couldn't read the screens" and
> "that screen isn't running" must not look alike — conflating them is exactly
> how a watch goes quiet forever.

Word matching rather than substring matching is deliberate, for two reasons.
BMS writes venues as `Name: Location`, so the natural phrasing
`"allu cinemas kokapet"` is *not* a substring of `"Allu Cinemas: Kokapet"` and
would silently never match. And whole words keep a short entry like `"AMB"`
from matching *Ambica Theatre*.

### Finding venue names

[`venues-hyderabad.md`](venues-hyderabad.md) lists every Hyderabad venue with
its code — 72 of them — so adding a theatre is copy-paste rather than
guesswork. It also lists the **screens** each venue is running, which is how
you get a screen string exactly right. Regenerate it any time (venue names and
codes are the *city's*, so any currently-bookable movie works — but the screen
column is only ever that movie's):

```powershell
python check.py --venues "https://in.bookmyshow.com/movies/hyderabad/<some-now-showing-movie>/ET00000000"
```

Add `--language telugu` to narrow a multi-language release, or
`--date 20260925` for another day. It writes `venues-<city>.md`, so the same
command builds a reference for any city.

> **Screen formats are not part of the venue name.** Prasads' *PCX*, IMAX,
> 4DX and similar are formats offered *inside* a venue, so `"prasads pcx"` as
> a theatre entry matches nothing. Put the venue and the screen in their own
> fields instead: `{"venue": "Prasads", "screens": ["PCX"]}`.

**Theatres never gate the alert.** Booking-open always pushes immediately, even
if none of your theatres are listed yet — theatres get onboarded
progressively, and waiting for yours could cost you the opening rush. Each
watched theatre or screen then gets **its own** push the first time it appears
(`AMB Cinemas: Gachibowli - HDR By Barco now has shows on Sat 26 Sep!`),
repeating until you ack that one.

So a run can legitimately send several notifications: one per thing you asked
about that is live and un-acked. That is the deliberate trade for being able
to ack them separately — the alternative was one combined alert whose single
ack silenced screens you had not heard about yet.

Once a theatre or screen has been seen live, its repeat alert is served from
the stored marker, so the showtimes page is only reloaded while something you
asked about has **never** been seen.

### How the venue list is read

From the showtimes page's **embedded state payload**, not the rendered DOM.
This matters: the venue list is *virtualised*, so only a handful of rows exist
in the DOM at any moment and scrolling past the list unmounts all of them.
An earlier DOM-scraping version silently returned a page-wide cinema
widget instead — the same 10 venues for every movie, which looks plausible
until you notice two unrelated films share a venue list. Parsing the payload
returns the real list (72 venues for a live Hyderabad release) and needs no
scrolling at all.

The URL is derived from the movie page URL, with `etCodes=*` to ask for every
screen format rather than the one BMS would auto-select:

```
.../movies/hyderabad/irumudi/ET00513087
  -> .../movies/hyderabad/irumudi/buytickets/ET00513087/20260909?etCodes=*
```

### Two caveats worth knowing

1. **It covers one language, and only the dates you list.** The dates are
   `show_date` / `show_dates`, or today when neither is set — a day you did
   not list is never looked at. `etCodes=*` gets all screen
   formats, but for a multi-language release BMS serves one language unless
   you set `language` — and the screen strings carry that language, so a
   venue can look screen-less simply because you are reading the wrong
   slice. A theatre's absence is not hard proof it isn't showing the movie;
   treat the list as a positive signal.
2. **It costs a second page load, per watched date.** Only while booking is
   open and some of your theatres are still missing on that date, with a
   `SHOWTIMES_DELAY_MS` (default 6s)
   pause first — loading the movie page and showtimes page back-to-back earned
   a real Cloudflare 403 during development. If the showtimes page is blocked,
   or yields no venues at all, the alert still fires and simply says it
   couldn't read the theatre list.

### How the acknowledgement works

ntfy has **no read receipts** — a publisher can't tell whether a notification
was delivered or read. So the ack is *explicit*: the button is an ntfy `http`
action that POSTs the movie's `id` to a second topic (`NTFY_ACK_TOPIC`), which
`check.py` polls at the start of every run.

Because **ntfy.sh only caches messages for ~12 hours**, an ack that lived only
in ntfy would expire and the alerts would come back. So the moment a run sees
an ack it writes a marker file into `.state/`, which the workflow carries
between runs via the Actions cache. ntfy supplies the *signal*; the Actions
cache supplies the *memory*.

> Keep `NTFY_ACK_TOPIC` separate and unguessable rather than letting it default
> to `<your-topic>-ack`. Anyone who knows the ack topic can silence your
> alerts.

---

## Schedule

One workflow, [`movies.yml`](.github/workflows/movies.yml), watches
`movies.json` every **5 min**. It installs Chromium, because BMS needs a real
browser.

> GitHub's cron floor is 5 minutes and its scheduler is best-effort, so a run
> can land a few minutes late. Show dates are therefore enforced in the script
> (in IST) rather than in cron, which is UTC.

To change the cadence, edit the workflow's `cron`. To stop the watcher:
Actions tab → **Movie Ticket Watcher** → **⋯ → Disable workflow**.

---

## Setup (≈10 minutes)

### 1. Pick an ntfy topic + install the app
- Install the **ntfy** app ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347)).
- Choose **two hard-to-guess topic names** — one for alerts, one for acks
  (anyone who knows the alert topic can read your alerts), e.g.
  `bms-hyd-9f3k2x` and `bms-ack-7t1q8w`.
- In the app: **Subscribe to topic** → enter the **alert** topic exactly.
  (No need to subscribe to the ack topic — only the script reads it.)

> ntfy needs no account. The topic name *is* the secret.

### 2. Create a GitHub repo and push this folder
```powershell
cd D:\Projects\bms-ticket-watcher
git init
git add .
git commit -m "BMS ticket watcher"
git branch -M main
git remote add origin https://github.com/<you>/drop-watcher.git
git push -u origin main
```
> **Make the repo PUBLIC** → GitHub Actions minutes are then unlimited and free.
> (No secrets live in the code — they go in GitHub Secrets, below.)

### 3. Add your secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name             | Value                                     | Required |
|------------------|-------------------------------------------|----------|
| `NTFY_TOPIC`     | alert topic, e.g. `bms-hyd-9f3k2x`        | ✅ yes   |
| `NTFY_ACK_TOPIC` | ack topic, e.g. `bms-ack-7t1q8w`          | recommended (defaults to `<NTFY_TOPIC>-ack`) |
| `ALERT_EMAIL`    | ⚠️ **leave this unset** — see below      | not usable on ntfy.sh |
| `NTFY_TOPIC_…`   | a per-movie topic referenced from `movies.json` — see [Sending one movie to its own topic](#sending-one-movie-to-its-own-topic) | only if a movie uses one |

> **Do not set `ALERT_EMAIL` on ntfy.sh.** The public server refuses e-mail
> for anonymous publishers (`{"code":40053,"error":"anonymous email sending is
> not allowed"}`) and rejects the **whole** publish — so an optional backup
> silently killed the actual push. The code now retries without the email so
> the notification always lands, but the cleanest fix is to delete the secret.
> E-mail needs an ntfy account and an auth token.

### 4. Enable + test
- Repo → **Actions** tab → enable workflows if prompted.
- Open **Movie Ticket Watcher** → **Run workflow** (manual trigger) to do a
  live check now. Watch the logs — each movie gets its own `==== <movie> ====` block.
- The cron then runs it automatically every ~5 minutes.

---

## Test it locally first (recommended)

```powershell
cd D:\Projects\bms-ticket-watcher
pip install -r requirements.txt
python -m playwright install chromium

$env:NTFY_TOPIC     = "bms-hyd-9f3k2x"    # your alert topic
$env:NTFY_ACK_TOPIC = "bms-ack-7t1q8w"    # your ack topic

# 1) Detection across every movie in movies.json; stays quiet pre-release:
python check.py                            # -> "not open yet" per movie

# 2) Confirm the ALERT actually reaches your phone. Send one directly —
#    a dummy id keeps a stray "Got it" tap from silencing a real movie:
python -c "import check; check.send_alert({'id':'TEST-ACK','name':'TEST','city':'Hyderabad','url':'https://in.bookmyshow.com/'})"

# 3) Ad-hoc single target, ignoring movies.json (e.g. point at a movie that
#    is ALREADY bookable to see the open-detection fire):
$env:BMS_URL = "https://in.bookmyshow.com/movies/hyderabad/<a-now-showing-movie>"
python check.py                            # -> "BOOKING OPEN" + phone buzz
Remove-Item Env:BMS_URL                    # back to movies.json
```

Local runs keep their ack markers in `.state/` (gitignored). Delete that
directory to un-acknowledge everything.

---

## ⚠️ Important caveat: datacenter IPs

GitHub Actions runs on Azure datacenter IPs. BookMyShow's anti-bot
(Cloudflare) *sometimes* blocks datacenter ranges outright, even with a real
browser — and it blocked a **residential** IP during development after a burst
of requests, so this is not purely a datacenter problem. You'll
know on the first run:

- **Logs show the per-movie detection blocks** → working. ✅
- **Run fails with "Page looks blocked / unrendered"** → the runner IP is being
  challenged. This is confirmed to happen *intermittently* on GitHub's runners:
  the same runner loaded the page fine one run and got a 691-char Cloudflare
  interstitial the next. Each movie is therefore retried `BMS_ATTEMPTS` times
  (default 3) within a run, on a fresh browser context, before the run fails.
  If it still fails, fallbacks in order of effort:
  1. Re-run — blocks are often intermittent.
  2. Run the same `check.py` on a box with a residential/home IP (your laptop
     when on, a Raspberry Pi, or an Oracle Cloud Always-Free VM via cron).
  3. Route Playwright through a residential proxy (paid).

The detection logic is identical everywhere — only *where* it runs changes.

## Notes
- **GitHub disables scheduled workflows after 60 days of repo inactivity** and
  only runs schedules on the **default branch**. A commit every couple of
  months keeps it alive.
- **To stop one alert**: tap its **Got it - …** button — that theatre or
  screen only. **To stop a whole movie**: tap **Booked - stop all** on any of
  its alerts, or set `"enabled": false` in `movies.json`.
- **To stop everything**: Actions tab → disable *Movie Ticket Watcher*.
- The `.state` cache is keyed per run and restored via the `bms-alert-state-`
  prefix. Clearing the repo's Actions caches resets acknowledgements, so open
  movies would start alerting again.
- Keep the 5-min interval reasonable — automated polling is against BMS's ToS;
  5 minutes is plenty to beat manual refreshing without hammering them.
