# 🔔 Drop Watcher

Watches **any number of BookMyShow movie pages** for ticket **booking
opening**, and **Shopify product pages** for coming back **in stock**, then
pushes a phone notification (via **ntfy**) — runs free on **GitHub Actions**,
so your laptop doesn't need to be on.

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
    "theatres": ["AMB", "Prasads", "Allu Cinemas Kokapet", "AAA Cinemas"],
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
| `theatres`  | Preferred theatres to watch for. Empty/omitted = don't check theatres at all. |
| `language`  | Optional. Narrows the showtimes lookup for a multi-language release (e.g. `"telugu"`). Omitted = whatever language BMS serves. |
| `enabled`   | Set `false` to park a movie without deleting it. Defaults to `true`. |

**To add a movie:** copy the URL from BookMyShow, append a block, commit. All
movies are checked in a **single** Actions run that reuses one browser, so each
extra movie costs ~20s — not a whole new job.

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

Per movie:

| State                        | Behaviour                              |
|------------------------------|----------------------------------------|
| Not open yet                 | silent                                 |
| Open, not acknowledged       | alerts on **every run** (~5 min)       |
| Open, acknowledged           | silent forever; movie is skipped entirely |

Each alert carries two action buttons:

- **Book now** — opens the BMS page.
- **Got it - stop alerts** — your acknowledgement. Tapping it stops the alerts
  for *that movie only*; the others keep being watched. It also stops theatre
  follow-ups for that movie, since it means "I'm done with this one".

---

## Preferred theatres

List theatres per movie and each alert tells you which of them already have
shows:

```
Avengers: Endgame Encore tickets are LIVE in Hyderabad!

Booking just opened on BookMyShow. Tap to book now:
https://in.bookmyshow.com/movies/hyderabad/avengers-endgame-encore/ET00514163

Your theatres with shows (1):
  - PVR: Nexus Mall Kukatpally, Hyderabad
Still waiting on: AMB, INMH
```

An entry matches a venue by **exact venue code**, or when **every word in the
entry appears as a whole word in the venue name** (order and punctuation
ignored). So `"PVFS"`, `"pvr nexus"` and `"PVR: Nexus"` all find
*PVR: Nexus Mall Kukatpally, Hyderabad*. Codes are the trailing segment of a
venue's BMS URL (`/cinemas/hyderabad/pvr-nexus-mall-kukatpally-hyderabad/PVFS`)
— use them when a name is ambiguous.

Word matching rather than substring matching is deliberate, for two reasons.
BMS writes venues as `Name: Location`, so the natural phrasing
`"allu cinemas kokapet"` is *not* a substring of `"Allu Cinemas: Kokapet"` and
would silently never match. And whole words keep a short entry like `"AMB"`
from matching *Ambica Theatre*.

### Finding venue names

[`venues-hyderabad.md`](venues-hyderabad.md) lists every Hyderabad venue with
its code — 72 of them — so adding a theatre is copy-paste rather than
guesswork. Regenerate it any time (the list is the *city's*, so any
currently-bookable movie works):

```powershell
python check.py --venues "https://in.bookmyshow.com/movies/hyderabad/<some-now-showing-movie>/ET00000000"
```

Add `--language telugu` to narrow a multi-language release, or
`--date 20260925` for another day. It writes `venues-<city>.md`, so the same
command builds a reference for any city.

> **Screen formats are not venues.** Prasads' *PCX*, IMAX, 4DX and similar are
> formats offered *inside* a venue and never appear in its name, so
> `"prasads pcx"` matches nothing — use `"Prasads"`. There is currently no way
> to filter down to a specific screen format.

**Theatres never gate the alert.** Booking-open always pushes immediately, even
if none of your theatres are listed yet — theatres get onboarded
progressively, and waiting for yours could cost you the opening rush. Instead,
the first time one of your theatres appears, that run's repeat alert is
*replaced* by a theatre-specific push (`AMB Cinemas: Gachibowli now has
shows!`), so extra signal never costs an extra notification. Once every
theatre you listed has been seen, the venue check stops running.

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

1. **It covers one date — today — and one language.** `etCodes=*` gets all
   screen formats, but for a multi-language release BMS serves one language
   unless you set `language`. So a theatre's absence is not hard proof it
   isn't showing the movie; treat the list as a positive signal.
2. **It costs a second page load.** Only while booking is open and some of
   your theatres are still missing, with a `SHOWTIMES_DELAY_MS` (default 6s)
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

## Product restocks (Shopify)

Targets live in [`products.json`](products.json):

```json
[
  {
    "id": "furjaden-dark-knight-batpack",
    "name": "Fur Jaden x Batman - The Dark Knight Backpack",
    "url": "https://www.furjaden.com/products/the-dark-knight-batpack",
    "enabled": true
  }
]
```

| Field     | Notes                                                            |
|-----------|------------------------------------------------------------------|
| `url`     | **Required.** The product page URL (any Shopify store).          |
| `id`      | Stable key for acknowledgements. Defaults to the URL's last path segment. |
| `name`    | Shown in the notification title.                                 |
| `watch_from` | Optional `YYYY-MM-DD` (**IST**). Before this date the product is skipped entirely — no network call. A malformed date is ignored with a warning, so it fails *open*. |
| `enabled` | Set `false` to park it without deleting it. Defaults to `true`.  |

### How stock is detected

Appending **`.js`** to any Shopify product URL returns the storefront JSON,
which carries an explicit boolean:

```json
{ "available": false,
  "variants": [ { "title": "Default Title", "available": false,
                  "inventory_policy": "deny" } ] }
```

That is a far stronger signal than the BookMyShow scraping: **one HTTP GET, no
browser, no anti-bot, no DOM guessing.** `available` flips to `true` the moment
stock is added. Products are checked *before* the movies precisely because they
need no browser — they still work on a run where Chromium fails to install.

> Use `.js`, **not** `.json`. The `.json` endpoint on the same URL omits the
> `available` field entirely, so it cannot answer the question.

If the payload ever lacks `available` (store moves off Shopify, URL changes),
the run **fails loudly** rather than reporting "out of stock" — a silent false
negative would mean never being told.

Stock alerts follow the same lifecycle as movies: repeat every run while in
stock, with a **Buy now** button and the same **Got it - stop alerts** ack.

---

## Schedules

Two independent workflows, so the two watchers keep their own cadence:

| Workflow | Watches | Cron | Notes |
|----------|---------|------|-------|
| [`movies.yml`](.github/workflows/movies.yml) | `movies.json` | every **5 min** | Installs Chromium (BMS needs a real browser). |
| [`stock.yml`](.github/workflows/stock.yml) | `products.json` | every **10 min** | **No Chromium** — a Shopify check is one HTTP GET, so the run takes seconds. |

Each is scoped with `--only movies` / `--only products`, so neither redoes the
other's work, and each keeps its **own** `.state` cache key — sharing one key
would let the two clobber each other's markers.

> GitHub's cron floor is 5 minutes and its scheduler is best-effort, so a run
> can land a few minutes late. Start dates are therefore enforced in the script
> (`watch_from`, in IST) rather than in cron, which is UTC.

To change a cadence, edit that workflow's `cron`. To stop one watcher without
touching the other: Actions tab → pick the workflow → **⋯ → Disable workflow**.

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
| `ALERT_EMAIL`    | email for a backup alert via ntfy         | optional |

### 4. Enable + test
- Repo → **Actions** tab → enable workflows if prompted.
- Open **Movie Ticket Watcher** (or **Product Stock Watcher**) → **Run
  workflow** (manual trigger) to do a live
  check now. Watch the logs — each movie gets its own `==== <movie> ====` block.
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
  challenged. Fallbacks, in order of effort:
  1. Re-run — blocks are sometimes intermittent.
  2. Run the same `check.py` on a box with a residential/home IP (your laptop
     when on, a Raspberry Pi, or an Oracle Cloud Always-Free VM via cron).
  3. Route Playwright through a residential proxy (paid).

The detection logic is identical everywhere — only *where* it runs changes.

## Notes
- **GitHub disables scheduled workflows after 60 days of repo inactivity** and
  only runs schedules on the **default branch**. A commit every couple of
  months keeps it alive.
- **To stop alerts for one movie**: tap **Got it - stop alerts** on the
  notification, or set `"enabled": false` in `movies.json`.
- **To stop everything**: Actions tab → disable **both** *Movie Ticket
  Watcher* and *Product Stock Watcher*.
- The `.state` cache is keyed per run and restored via the `bms-alert-state-`
  prefix. Clearing the repo's Actions caches resets acknowledgements, so open
  movies would start alerting again.
- Keep the 5-min interval reasonable — automated polling is against BMS's ToS;
  5 minutes is plenty to beat manual refreshing without hammering them.
