#!/usr/bin/env python3
"""
Release watcher: BookMyShow ticket openings and Shopify restocks.

Loads every enabled movie page from movies.json in a real headless Chromium
browser, decides whether ticket booking has opened, and pushes a notification
via ntfy when it has.

Also watches Shopify products listed in products.json for coming back in
stock. Those need no browser at all — appending `.js` to a Shopify product URL
returns JSON with an explicit `available` boolean — so they are checked first
and still work if Chromium is unavailable.

Designed to run as a near-stateless one-shot from a GitHub Actions cron job.
The only state kept between runs is a small "you already acknowledged this
movie" marker directory (STATE_DIR), which is what stops the alerts.

Alert lifecycle per movie:
    not open        -> silent
    open, un-acked  -> alert on EVERY run (so you can't miss it)
    open, acked     -> silent forever; the movie is skipped entirely

A movie may pin the date(s) it should be watched on ("show_date" for one,
"show_dates" for several — useful when any of a few days would do). Each date
is checked, alerted and acknowledged separately: the screen you want on the
26th is different news from the same screen on the 27th.

A movie may also list preferred "theatres". Those never gate the alert — the
booking-open push always fires first, annotated with which of your theatres
already have shows — but the first time one of them appears, that run's repeat
alert is replaced by a theatre-specific one. The venue list comes from a second
page load, so it happens only while booking is open AND some of your theatres
are still missing.

You acknowledge a movie by tapping the "Got it - stop alerts" button on the
notification itself. That button POSTs the movie id to a second ntfy topic
(NTFY_ACK_TOPIC), which this script polls at the start of each run. Because
ntfy.sh only caches messages for ~12h, a seen ack is immediately written to
STATE_DIR so it survives long after the ntfy cache has expired.

Usage:
    python check.py                # check every enabled movie in movies.json
    BMS_URL=... python check.py    # single ad-hoc target, ignores movies.json
    python check.py --venues <bookable-movie-url> [--language telugu]
                                   # write venues-<city>.md, a reference for
                                   # filling in a movie's "theatres"
"""

import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

# A Windows console defaults to cp1252, where printing a non-ASCII movie or
# product title (a Telugu name, a rupee sign) raises UnicodeEncodeError and
# kills the whole run. Force UTF-8 output before anything can print.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # not a real stream, or an older Python
        pass

# --- Config (env vars override these defaults) ------------------------------
MOVIES_FILE = os.environ.get("MOVIES_FILE", "movies.json")
PRODUCTS_FILE = os.environ.get("PRODUCTS_FILE", "products.json")
STATE_DIR = os.environ.get("STATE_DIR", ".state")
NTFY_SERVER = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
# .strip() because a topic pasted into a GitHub secret can pick up a trailing
# space or newline. ntfy then rejects the publish with a 400, which used to be
# swallowed into a green run that notified nobody.
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
# Topic the notification's ack button POSTs to. Defaults to "<topic>-ack".
# NOTE: `or`, not a get() default — GitHub Actions sets an undefined secret to
# an EMPTY STRING, which would otherwise silently disable acknowledgements.
NTFY_ACK_TOPIC = os.environ.get("NTFY_ACK_TOPIC", "").strip() or (
    f"{NTFY_TOPIC}-ack" if NTFY_TOPIC else ""
)
# Optional email backup. NOTE: ntfy.sh rejects e-mail sending for anonymous
# publishers (code 40053) and fails the WHOLE publish, push included — so a
# rejected email is retried without it rather than losing the notification.
ALERT_EMAIL = os.environ.get("ALERT_EMAIL", "").strip()
# BMS challenges datacenter IPs intermittently; retry inside the run.
BMS_ATTEMPTS = int(os.environ.get("BMS_ATTEMPTS", "3"))
BMS_RETRY_DELAY_MS = int(os.environ.get("BMS_RETRY_DELAY_MS", "15000"))
# Pause between a movie page and its showtimes page — two back-to-back loads
# from one IP is what tripped Cloudflare during development.
SHOWTIMES_DELAY_MS = int(os.environ.get("SHOWTIMES_DELAY_MS", "6000"))
# Runners are UTC; product "watch_from" dates are meant in local Indian time.
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
# Budget for the open alert's per-date theatre section. ntfy's hard limit is
# 4096 bytes for the WHOLE message and it rejects anything longer outright, so
# a movie watched across many dates trims its tail rather than losing the push.
MAX_THEATRE_LINES = 2500

# Ad-hoc single-target override (handy for local testing — see README).
BMS_URL = os.environ.get("BMS_URL", "")
CITY = os.environ.get("CITY", "Hyderabad")
MOVIE_NAME = os.environ.get("MOVIE_NAME", "")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Phrases that mean we hit an anti-bot wall instead of the real page.
# The Cloudflare set below was captured from a REAL 403 interstitial: its body
# was 691 chars and matched none of the original markers, so it sailed through
# the sanity check and read as a harmless "not open yet" — a block that
# silences the watcher forever is the one failure we must never miss.
BLOCK_MARKERS = (
    "access denied",
    "verify you are human",
    "are you a robot",
    "unusual traffic",
    "captcha",
    "request blocked",
    "you have been blocked",
    "attention required",
    "unable to access",
    "enable javascript and cookies",
    "cloudflare",
)


# --- Targets ----------------------------------------------------------------
def movie_id_from_url(url):
    """BMS movie codes look like ET00514163 and are stable per movie."""
    m = re.search(r"(ET\d+)", url)
    return m.group(1) if m else url.rstrip("/").rsplit("/", 1)[-1]


def movie_slug_from_url(url):
    """.../movies/hyderabad/avengers-endgame-encore/ET00514163 -> the slug."""
    parts = [p for p in url.split("?")[0].rstrip("/").split("/") if p]
    for i, part in enumerate(parts):
        if re.fullmatch(r"ET\d+", part) and i > 0:
            return parts[i - 1]
    return parts[-1] if parts else ""


def load_targets():
    """Return target dicts — from BMS_URL if set, else movies.json."""
    if BMS_URL:
        return [
            {
                "id": movie_id_from_url(BMS_URL),
                "name": MOVIE_NAME or movie_id_from_url(BMS_URL),
                "city": CITY,
                "url": BMS_URL,
                "theatres": [],
                "screens": [],
                "language": os.environ.get("LANGUAGE", ""),
                "book_code": "",
                "show_date": "",
                "show_dates": [],
                "showtimes_url": "",
            }
        ]

    with open(MOVIES_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    targets = []
    for entry in raw:
        if not entry.get("enabled", True):
            print(f"-- skipping (disabled): {entry.get('name') or entry.get('url')}")
            continue
        url = entry["url"]
        targets.append(
            {
                "id": entry.get("id") or movie_id_from_url(url),
                "name": entry.get("name") or movie_id_from_url(url),
                "city": entry.get("city", CITY),
                "url": url,
                "theatres": entry.get("theatres") or [],
                "screens": entry.get("screens") or [],
                "language": entry.get("language", ""),
                # The movie page's ET code is NOT always the one the
                # showtimes path uses — a regional/format sub-event gets its
                # own. "id" stays the ack key; "book_code" is only for
                # building the buytickets URL.
                "book_code": entry.get("book_code", ""),
                # One date or many: "show_date" is the single-date spelling,
                # "show_dates" the list. Both are read, so an existing config
                # keeps working and a second date is one line to add.
                "show_date": entry.get("show_date", ""),
                "show_dates": entry.get("show_dates") or [],
                "showtimes_url": entry.get("showtimes_url", ""),
            }
        )
    return targets


def today_ist():
    """Today's date in IST, whatever timezone the runner thinks it is in.

    GitHub runners are UTC, so a bare date() would roll over 5.5h late and a
    "watch_from" of the 14th would not start until the 14th morning IST.
    """
    return datetime.datetime.now(IST).date()


def load_products():
    """Return Shopify product targets from products.json (optional file)."""
    if not os.path.exists(PRODUCTS_FILE):
        return []
    with open(PRODUCTS_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    today = today_ist()
    targets = []
    for entry in raw:
        label = entry.get("name") or entry.get("url")
        if not entry.get("enabled", True):
            print(f"-- skipping (disabled): {label}")
            continue

        # Optional "don't even look before this date" (IST).
        start = entry.get("watch_from")
        if start:
            try:
                start_date = datetime.datetime.strptime(start, "%Y-%m-%d").date()
            except ValueError:
                print(f"!! bad watch_from {start!r} for {label} - ignoring",
                      file=sys.stderr)
                start_date = None
            if start_date and today < start_date:
                days = (start_date - today).days
                print(f"-- skipping (watch starts {start}, {days} day(s) away): "
                      f"{label}")
                continue

        url = entry["url"].split("?")[0].rstrip("/")
        targets.append(
            {
                "id": entry.get("id") or url.rsplit("/", 1)[-1],
                "name": entry.get("name") or url.rsplit("/", 1)[-1],
                "url": url,
            }
        )
    return targets


# --- Shopify stock ----------------------------------------------------------
def fetch_product(url):
    """Fetch a Shopify storefront product payload.

    Appending `.js` to any Shopify product URL returns the storefront JSON,
    which carries an explicit per-variant `available` boolean. Note the `.json`
    variant of this endpoint omits `available`, so it is NOT interchangeable.
    """
    req = urllib.request.Request(
        url + ".js",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        payload = resp.read().decode("utf-8", "replace")
    data = json.loads(payload)
    if "available" not in data:
        # Never treat a shape change as "out of stock" — that would go quiet
        # forever instead of alerting.
        raise RuntimeError(
            "no 'available' field in payload - not a Shopify product page?"
        )
    return data


def check_product(product):
    """Return (in_stock, product_payload, available_variant_names)."""
    data = fetch_product(product["url"])
    live = [
        v.get("title") or "Default"
        for v in data.get("variants", [])
        if v.get("available")
    ]
    in_stock = bool(data.get("available")) or bool(live)
    print(f"   title      : {data.get('title')!r}")
    print(f"   available  : {data.get('available')!r}")
    print(f"   variants   : {len(data.get('variants', []))} "
          f"({len(live)} in stock)")
    return in_stock, data, live


def send_product_alert(product, data, live):
    """Push a back-in-stock alert. Returns True if ntfy accepted it."""
    if not NTFY_TOPIC:
        print("!! NTFY_TOPIC not set - cannot send notification", file=sys.stderr)
        return False

    # Shopify prices are integer paise/cents.
    price = data.get("price")
    price_line = f"\n₹{price / 100:,.0f}" if isinstance(price, int) else ""
    variants = ""
    if live and live != ["Default Title"]:
        variants = f"\nIn stock: {', '.join(live)}"

    return _publish(
        {
            "topic": NTFY_TOPIC,
            "title": f"{product['name']} is IN STOCK!",
            "message": (
                f"{data.get('title') or product['name']}"
                f"{price_line}{variants}\n{product['url']}"
            ),
            "priority": 5,
            "tags": ["shopping_bags"],
            "click": product["url"],
            "actions": _actions_for(product, "Buy now"),
        }
    )


# --- Theatres / showtimes ---------------------------------------------------
def showtimes_url(movie, when=None):
    """Showtimes URL for a movie+date, derived from the movie page URL.

    .../movies/hyderabad/irumudi/ET00513087
      -> .../movies/hyderabad/irumudi/buytickets/ET00513087/20260909?etCodes=*

    Built directly rather than by clicking the movie page's CTA, because that
    CTA opens a language/format modal instead of navigating. `etCodes=*` asks
    for every screen format rather than the one BMS would auto-select; an
    optional per-movie "language" narrows a multi-language release.
    """
    # Full override wins: paste the URL BMS itself gave you and nothing is
    # guessed. It pins the date, so it needs editing once that date passes —
    # and it is a SINGLE url, so a multi-date movie cannot use it.
    if movie.get("showtimes_url"):
        return movie["showtimes_url"]

    day = showtime_date(movie, when).strftime("%Y%m%d")
    base = movie["url"].split("?")[0].rstrip("/")
    # Rebuild as <...>/<slug>/buytickets/<ET code>/<date>, whatever trails the
    # movie URL.
    head = base.rsplit("/", 1)[0] if re.search(r"/ET\d+$", base) else base
    # The BOOKING event code, which for a re-release or a per-language event is
    # NOT the movie page's code: .../movies/.../ET00514163 lists its shows
    # under .../buytickets/ET00516728/... . Getting this wrong returns a page
    # with zero venue records and no error at all.
    # Fall back to the code in the movie URL, never to movie["id"]: the id is
    # only the acknowledgement key and may be set to anything, which would
    # silently point this URL at an event that does not exist.
    page_code = movie_id_from_url(movie["url"])
    code = movie.get("book_code") or page_code
    url = f"{head}/buytickets/{code}/{day}?etCodes=*"
    if movie.get("language"):
        url += f"&language={movie['language']}"
    if code != page_code:
        url += f"&refEventCode={code}"
    return url


def showtime_dates(movie):
    """The dates this movie's showtimes are read for, earliest first.

    A movie whose booking has opened for a FUTURE release has no shows today,
    so set "show_date" (one date) or "show_dates" (several) — otherwise every
    run reads an empty page and reports no venues.

    Dates already past are DROPPED, not rolled forward: their showtimes page
    is empty, which is the same silent zero-venue failure the field exists to
    avoid. An empty result therefore means "nothing pinned any more", and the
    caller falls back to today — exactly what the single-date version did by
    taking max(show_date, today).
    """
    raws = list(movie.get("show_dates") or [])
    single = (movie.get("show_date") or "").strip()
    if single:
        raws.append(single)

    today, out = today_ist(), []
    for raw in raws:
        raw = str(raw).strip()
        if not raw:
            continue
        try:
            day = datetime.datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            # Fail open: skip the bad entry rather than the whole check.
            print(f"!! bad show date {raw!r} for {movie.get('name')} - "
                  "ignoring", file=sys.stderr)
            continue
        if day < today:
            print(f"-- show date {raw} has passed for {movie.get('name')} "
                  "- ignoring")
            continue
        if day not in out:
            out.append(day)
    return sorted(out)


def showtime_date(movie, when=None):
    """The single date a bare showtimes lookup should use.

    The earliest watched date, or today (IST) when none is pinned. today_ist()
    rather than date.today() because the runner is UTC: between 00:00 and
    05:30 IST a bare today() is still on YESTERDAY, whose showtimes payload has
    zero venues.
    """
    if when:
        return when
    dates = showtime_dates(movie)
    return dates[0] if dates else today_ist()


def watch_days(movie):
    """Every date to check this movie on, as a list for the per-date loops.

    `None` — the single-element fallback — means "whatever is on today, and
    don't stamp a date onto the ack keys". That distinction matters: a film
    already running is watched on a rolling today, and stamping the ack keys
    with it would un-silence every theatre you acked at midnight.
    """
    return showtime_dates(movie) or [None]


def day_stamp(day):
    """Ack/marker suffix for one watched date; "" for the undated fallback."""
    return f"@{day:%Y%m%d}" if day else ""


def day_label(day):
    """How a watched date reads in a notification, e.g. "Sat 26 Sep"."""
    return day.strftime("%a %d %b") if day else ""


# Venue records inside the showtimes page's embedded state, e.g.
#   "venueCode":"PRHN", ... ,"venueName":"Prasads Multiplex: Hyderabad"
VENUE_RE = re.compile(r'"venueCode":"([^"]+)"[^{}]*?"venueName":"([^"]+)"')
# One venue card per listed cinema. Splitting the payload on this marker is
# what lets a screen be attributed to the venue running it — screens live in
# the showtime objects nested inside the card, not next to the venue name.
VENUE_CARD = '"type":"venue-card"'
# Per-showtime screen format. Both keys carry it; `format` is the richer of
# the two — "Telugu • 2D | PCX SCREEN" against screenAttr's bare
# "PCX SCREEN" — so a 2D and a 3D IMAX show stay distinguishable.
SCREEN_ATTR_RE = re.compile(r'"screenAttr":"([^"]+)"')
SCREEN_FORMAT_RE = re.compile(r'"format":"([^"]*•[^"]*)"')


def parse_screens(segment):
    """Unique screen formats inside one venue card, in payload order."""
    labels = SCREEN_FORMAT_RE.findall(segment) or SCREEN_ATTR_RE.findall(segment)
    out, seen = [], set()
    for label in labels:
        key = _normalise(label)
        if key and key not in seen:
            seen.add(key)
            out.append(label)
    return out


def parse_venues(html):
    """Pull [{name, code, screens}] out of a showtimes page's embedded state.

    Read from the page payload, NOT the rendered DOM: the venue list is
    virtualised, so scrolling it only ever mounts a handful of rows and
    scrolling past unmounts them all. Scraping anchors gave a page-wide cinema
    widget instead — the same 10 venues for every movie.

    `screens` is None — not [] — when the card layout could not be read at
    all. The distinction matters: "we could not read this venue's screens"
    must never be reported as "this venue is not running your screen", or a
    payload change would silence a screen watch forever.
    """
    venues, seen = [], set()
    for segment in html.split(VENUE_CARD)[1:]:
        m = VENUE_RE.search(segment)
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        venues.append({"name": m.group(2), "code": m.group(1),
                       "screens": parse_screens(segment)})
    if venues:
        return venues
    # Card layout changed: fall back to the flat venue scan, which still finds
    # every venue but can no longer say which screen each one is running.
    for code, name in VENUE_RE.findall(html):
        if code not in seen:
            seen.add(code)
            venues.append({"name": name, "code": code, "screens": None})
    return venues


def watchlist(movie):
    """Expand a movie's `theatres` into flat [{venue, screen, label}] items.

    An entry is either a plain venue string (that venue on any screen) or an
    object naming the screens that matter there:

        "theatres": ["AAA Cinemas",
                     {"venue": "AMBH", "screens": ["IMAX", "4DX"]}]

    A movie-level "screens" list applies to every plain-string entry, for the
    common case of wanting one format across all your theatres.

    One item per venue+screen pair, because each is separately worth an alert
    and its own ack: AMB's Screen 1 opening is its own news even when AMB's
    Screen 3 has been live for days.
    """
    default = [x for x in (movie.get("screens") or []) if str(x).strip()]
    items = []
    for entry in movie.get("theatres") or []:
        if isinstance(entry, dict):
            venue = str(entry.get("venue") or entry.get("theatre") or "").strip()
            screens = [x for x in (entry.get("screens") or []) if str(x).strip()]
        else:
            venue, screens = str(entry or "").strip(), default
        if not venue:
            continue
        for screen in screens or [None]:
            screen = str(screen).strip() if screen else None
            items.append({
                "venue": venue,
                "screen": screen,
                "label": f"{venue} ({screen})" if screen else venue,
            })
    return items


def scrape_venues(context, movie, when=None):
    """Return [{name, code}] of venues listed for the movie on a date.

    Raises on an anti-bot wall, or on a page that yields no venues at all, so
    the caller can say "couldn't read the theatre list" instead of
    misreporting it as "none of your theatres yet".

    CAVEAT: this is the list for one date and, for a multi-language release,
    whatever language BMS serves unless the movie sets "language" — a
    theatre's absence is not hard proof it isn't showing the movie.
    """
    url = showtimes_url(movie, when)
    page = context.new_page()
    try:
        # Breathe between the movie page and this one. Hitting both
        # back-to-back earned a real Cloudflare 403 during development.
        page.wait_for_timeout(SHOWTIMES_DELAY_MS)
        print(f"   venues <- {url}")
        resp = page.goto(url, wait_until="domcontentloaded", timeout=60000)
        status = resp.status if resp else 0
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except Exception:
            pass
        page.wait_for_timeout(4000)

        body = (page.inner_text("body") or "").lower()
        if status >= 400 or any(m in body for m in BLOCK_MARKERS):
            raise RuntimeError(
                f"showtimes page blocked (HTTP {status}, body {len(body)} chars)"
            )
        html = page.content()
    finally:
        page.close()

    venues = parse_venues(html)
    if not venues:
        # Zero venues has two very different causes, and "no venues found" on
        # its own cannot tell them apart, so count the raw keys:
        #   0 keys  -> BMS listed no shows at all for this date/language, i.e.
        #              booking is not really open (or opened for a later date)
        #   n keys  -> the shows exist but VENUE_RE no longer matches the
        #              payload shape, and the regex needs updating
        codes = html.count('"venueCode"')
        names = html.count('"venueName"')
        raise RuntimeError(
            f"no venues parsed from showtimes payload ({len(html)} chars, "
            f"venueCode keys={codes}, venueName keys={names}) - "
            + ("no shows listed for this date/language"
               if codes == 0 else "payload shape changed, VENUE_RE is stale")
        )
    return venues


def _normalise(name):
    """Lowercase and drop apostrophes, so Prasad's == Prasads."""
    return name.lower().replace("'", "").replace("’", "")


def _all_words_in(entry, text):
    """Does every word of `entry` appear as a whole word in `text`?

    Order and punctuation are ignored, so "allu cinemas kokapet" matches
    "Allu Cinemas: Kokapet" — which plain substring matching would miss,
    because BMS writes venues as "Name: Location".

    Whole words, not substrings, keep "AMB" off "Ambica Theatre".
    """
    words = re.findall(r"[a-z0-9]+", _normalise(entry))
    if not words:
        return False
    hay = _normalise(text)
    return all(re.search(r"\b" + re.escape(w) + r"\b", hay) for w in words)


def theatre_matches(entry, venue):
    """Does one movies.json theatre entry match one venue?

    Either the exact venue code, or every word of the entry appearing as a
    whole word in the venue name.
    """
    if entry.strip().upper() == venue["code"].upper():
        return True
    return _all_words_in(entry, venue["name"])


def screen_matches(entry, venue):
    """Is the wanted screen among the formats this venue is running?

    Same word rule as venues, so "PXL" matches "Telugu • 2D | PXL", "PCX"
    matches "PCX SCREEN", and "dolby cinema" matches
    "Telugu • DOLBY CINEMA 2D | DOLBY CINEMA" — while none of them match a
    plain 2D screen.

    False when the venue's screens are unknown or empty — never a match on
    a guess. The caller reports that case separately, because "could not read
    the screens" and "that screen is not running" must not look alike.
    """
    return any(_all_words_in(entry, x) for x in (venue.get("screens") or []))


def match_watchlist(venues, items):
    """Map each watch item's label -> the venues satisfying it.

    Keyed by the label you wrote rather than by venue, so "which of my
    theatres and screens are live" survives BMS renaming a venue.
    """
    hits = {}
    for item in items:
        found = [v for v in venues if theatre_matches(item["venue"], v)]
        if item["screen"]:
            found = [v for v in found if screen_matches(item["screen"], v)]
        if found:
            hits[item["label"]] = found
    return hits


def screens_at(venues, item):
    """Screens running at the venues matching this item's venue.

    None when the venue is not listed at all; [] when it is listed but its
    screens could not be read. That split is what makes a "still waiting"
    line useful: "AMB is listed, running only Screen 3" is very different
    news from "AMB is not listed yet".
    """
    listed, screens, seen = False, [], set()
    for v in venues:
        if not theatre_matches(item["venue"], v):
            continue
        listed = True
        for label in v.get("screens") or []:
            if _normalise(label) not in seen:
                seen.add(_normalise(label))
                screens.append(label)
    return screens if listed else None


# --- Acknowledgement state --------------------------------------------------
# An ack id names one ALERT, not one movie: "ET00514163" is that movie's
# booking-open alert, "ET00514163@amb" is its AMB theatre alert. Ids arrive
# from a public ntfy topic, so they are untrusted input — anything outside
# this character set could walk out of STATE_DIR via "..".
ACK_ID_SAFE = re.compile(r"[^A-Za-z0-9@._-]+")


def ack_marker(ack_id):
    return os.path.join(STATE_DIR, "acked-" + ACK_ID_SAFE.sub("-", ack_id))


def is_acked(ack_id):
    return os.path.exists(ack_marker(ack_id))


def record_ack(ack_id, source):
    os.makedirs(STATE_DIR, exist_ok=True)
    path = ack_marker(ack_id)
    if os.path.exists(path):
        return
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"acked via {source}\n")
    print(f"   ack recorded for {ack_id} (via {source})")


def _touch(path, note):
    os.makedirs(STATE_DIR, exist_ok=True)
    if os.path.exists(path):
        return False
    with open(path, "w", encoding="utf-8") as f:
        f.write(note + "\n")
    return True


def has_alerted(movie_id):
    """True once we've sent at least one booking-open alert for this movie."""
    return os.path.exists(os.path.join(STATE_DIR, f"alerted-{movie_id}"))


def record_alerted(movie_id):
    _touch(os.path.join(STATE_DIR, f"alerted-{movie_id}"), "open-alert sent")


def _slug(text):
    """Filename-safe key for a free-text theatre entry."""
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()[:40] or "x"


def theatre_ack_id(movie_id, wanted, day=None):
    """Ack key for ONE watch item of one movie on ONE date.

    `wanted` is a watchlist label, so a screen gets its own key:
    "ET00514163@ambh-hdr-by-barco" is AMB's Screen 1, distinct from the same
    venue's other screens. Namespaced under the movie so "Got it" on one
    alert silences that one alone, and the booking-open ack no longer
    silences theatres.

    A watched date is stamped on top of that
    ("...@ambh-hdr-by-barco@20260926"), because the same screen on the 26th
    and on the 27th are two different pieces of news: acking "yes, the 27th is
    open" must not silence the date you actually want to watch on. `day` is
    None for a movie with no date pinned, which keeps the old undated keys —
    a rolling today would otherwise change the key every midnight and
    resurrect every ack.
    """
    return f"{movie_id}@{_slug(wanted)}{day_stamp(day)}"


def all_ack_id(movie_id):
    """Ack key for "stop everything about this movie", e.g. ET00514163@all.

    Restores the original one-tap behaviour as an explicit choice: you tap it
    once you have actually booked, and neither the booking-open alert nor any
    theatre alert can come back.
    """
    return f"{movie_id}@all"


def is_silenced(movie_id):
    """True if the movie-wide stop button has been tapped."""
    return is_acked(all_ack_id(movie_id))


def pending_alerts(movie):
    """This movie's alerts that are still un-acknowledged.

    "open" is the booking-open alert; the rest are theatre entries. An empty
    list means every alert for the movie has been acked and the movie can be
    skipped entirely — the old whole-movie behaviour, except it now takes
    N+1 taps instead of one.
    """
    if is_silenced(movie["id"]):
        return []
    jobs = ["open"] if not is_acked(movie["id"]) else []
    for day in watch_days(movie):
        jobs += [
            f"{i['label']}{day_stamp(day)}" for i in watchlist(movie)
            if not is_acked(theatre_ack_id(movie["id"], i["label"], day))
        ]
    return jobs


def theatre_marker(movie_id, wanted, day=None):
    stamp = day_stamp(day).replace("@", "-")
    return os.path.join(STATE_DIR, f"venue-{movie_id}-{_slug(wanted)}{stamp}")


def theatre_seen(movie_id, wanted, day=None):
    """True once this theatre has been reported live at least once."""
    return os.path.exists(theatre_marker(movie_id, wanted, day))


def record_theatre(movie_id, wanted, venues=(), day=None):
    """Remember that this theatre went live, and under which venue name(s).

    The names are stored because a theatre alert now repeats until it is
    acked: once a theatre is known live, the repeat can name the venue from
    this marker instead of reloading the showtimes page.
    """
    names = [v["name"] for v in venues] or [wanted]
    _touch(theatre_marker(movie_id, wanted, day), "\n".join(names))


def theatre_venue_names(movie_id, wanted, day=None):
    try:
        with open(theatre_marker(movie_id, wanted, day), encoding="utf-8") as f:
            names = [ln.strip() for ln in f if ln.strip()]
    except OSError:
        return [wanted]
    # Markers written before per-theatre alerts held a "theatre live: X" note.
    return [n.split("theatre live: ")[-1] for n in names] or [wanted]


def fetch_acks():
    """Poll the ack topic and persist any acks we haven't recorded yet.

    ntfy has no read receipts, so acks are explicit: the notification's action
    button POSTs the movie id here. A poll returns the topic's whole cache
    (~12h on ntfy.sh), hence the copy into STATE_DIR for durability.
    """
    if not NTFY_ACK_TOPIC:
        return
    url = f"{NTFY_SERVER}/{NTFY_ACK_TOPIC}/json?poll=1&since=all"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            body = resp.read().decode("utf-8", "replace")
    except Exception as e:
        # A missing/empty ack topic is normal; never fail the run over this.
        print(f"!! could not poll ack topic: {e}", file=sys.stderr)
        return

    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("event") != "message":
            continue
        ack_id = (msg.get("message") or "").strip()
        if ack_id:
            record_ack(ack_id, "ntfy ack button")


# --- Notification -----------------------------------------------------------
def day_lines(items, report, pad=""):
    """The theatre section for ONE watched date.

    `report["status"]` distinguishes the reasons we may have no venue data for
    that date, so a skipped check never masquerades as a failed one.
    """
    venues, hits = report.get("venues"), report.get("hits") or {}
    if report.get("status") == "all-live":
        live = ", ".join(i["label"] for i in items)
        return f"{pad}All your theatres already have shows: {live}"
    if venues is None:
        return f"{pad}(Could not read the theatre list this run.)"

    live, waiting, seen = [], [], set()
    for item in items:
        if item["label"] in hits:
            for v in hits[item["label"]]:
                line = v["name"] + (f" - {item['screen']}" if item["screen"] else "")
                if line not in seen:
                    seen.add(line)
                    live.append(line)
            continue
        running = screens_at(venues, item)
        if running is None:
            waiting.append(f"{pad}  - {item['label']}: not listed yet")
        elif not running:
            # Listed, but its screens could not be read - say so rather than
            # implying the screen you want is definitely absent.
            waiting.append(f"{pad}  - {item['label']}: listed, screens unreadable")
        else:
            # The useful case: the theatre is live, just not on your screen.
            waiting.append(f"{pad}  - {item['label']}: listed, running "
                           + ", ".join(running))

    if live:
        body = (f"{pad}Your theatres with shows ({len(live)}):\n"
                + "\n".join(f"{pad}  - {x}" for x in live))
    else:
        body = (f"{pad}None of your theatres yet ({len(venues)} other venue(s) "
                "listed). Theatres are onboarded progressively, so yours may "
                "appear later.")
    if waiting:
        body += f"\n\n{pad}Still waiting on:\n" + "\n".join(waiting)
    return body


def theatre_lines(movie, reports):
    """The 'which of your theatres and screens are live' alert section.

    `reports` is one {day, venues, hits, status} per watched date. A movie
    watched across several dates gets one block per date, each headed by the
    date — "AMB has shows" is only useful once you know for WHICH day.
    """
    items = watchlist(movie)
    if not items:
        return ""
    if not reports:
        return "\n\n(Could not read the theatre list this run.)"
    if len(reports) == 1 and not reports[0].get("day"):
        # Undated single-date movie: the original, heading-less wording.
        return "\n\n" + day_lines(items, reports[0])

    # ntfy caps a message at 4096 bytes and rejects — not truncates — anything
    # longer, which would cost the whole notification. Many dates x many
    # screens can get there, so drop the tail rather than the alert.
    body, dropped = "", 0
    for r in reports:
        block = (f"\n\n{day_label(r['day']) or 'Today'}:\n"
                 + day_lines(items, r, pad="  "))
        if len(body) + len(block) > MAX_THEATRE_LINES:
            dropped += 1
            continue
        body += block
    if dropped:
        body += (f"\n\n(+{dropped} more date(s) watched - each still gets its "
                 "own alert when a screen goes live.)")
    return body


def _publish(payload):
    """POST one notification. Returns True only if ntfy accepted it.

    The caller MUST surface a False: delivering the alert is the whole job, so
    a swallowed failure here is the worst possible bug — the run goes green
    while you are never told. That is exactly what happened once, so failures
    now propagate and fail the run.
    """
    if ALERT_EMAIL:
        payload["email"] = ALERT_EMAIL

    def attempt(body):
        req = urllib.request.Request(
            NTFY_SERVER + "/",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                print(f"   ntfy sent -> HTTP {resp.status} "
                      f"(topic {body.get('topic')!r})")
                return 200 <= resp.status < 300, ""
        except urllib.error.HTTPError as e:
            # ntfy puts the real reason in the response body; the bare
            # "HTTP Error 400: Bad Request" tells you nothing.
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace").strip()
            except Exception:
                pass
            print(f"!! ntfy send FAILED: HTTP {e.code} {detail[:300]}",
                  file=sys.stderr)
            return False, detail
        except Exception as e:
            print(f"!! ntfy send FAILED: {e}", file=sys.stderr)
            return False, ""

    ok, detail = attempt(payload)
    if not ok and "email" in payload and "email sending is not allowed" in detail:
        # An optional extra must never cost us the actual notification.
        print("   retrying without the email backup "
              "(ntfy.sh needs an account for e-mail)", file=sys.stderr)
        payload.pop("email", None)
        ok, _ = attempt(payload)
    return ok


def _ack_action(label, ack_id):
    return {
        "action": "http",
        "label": label,
        "url": f"{NTFY_SERVER}/{NTFY_ACK_TOPIC}",
        "method": "POST",
        "body": ack_id,
        "clear": True,
    }


def _actions_for(movie, label="Book now", ack_id=None,
                 ack_label="Got it - stop alerts", all_button=False):
    """Buttons for one notification.

    `ack_id` is what the narrow ack button POSTs, and so decides what gets
    silenced: the movie id for the booking-open alert, a per-theatre id for a
    theatre alert. Defaults to the movie so products and ad-hoc sends are
    unchanged.

    `all_button` adds the movie-wide stop on top of it — "I have booked, I am
    done with this film" — which is the only way to silence a theatre you have
    not been told about yet.

    NOTE: ntfy allows a MAXIMUM OF 3 actions per notification, and a movie
    alert now uses all three (view + narrow ack + stop-all). A fourth is
    rejected outright, taking the whole publish with it.
    """
    actions = [{"action": "view", "label": label, "url": movie["url"]}]
    if NTFY_ACK_TOPIC:
        actions.append(_ack_action(ack_label, ack_id or movie["id"]))
        if all_button:
            actions.append(
                _ack_action("Booked - stop all", all_ack_id(movie["id"]))
            )
    return actions


def send_alert(movie, reports=None):
    """Push a booking-open alert. Returns True if ntfy accepted it."""
    if not NTFY_TOPIC:
        print("!! NTFY_TOPIC not set - cannot send notification", file=sys.stderr)
        return False

    # Published as JSON rather than via headers: metadata headers must be
    # latin-1 safe, which mangles non-ASCII movie titles.
    return _publish(
        {
            "topic": NTFY_TOPIC,
            "title": f"{movie['name']} tickets are LIVE in {movie['city']}!",
            "message": (
                "Booking just opened on BookMyShow. Tap to book now:\n"
                f"{movie['url']}"
                + theatre_lines(movie, reports or [])
            ),
            "priority": 5,
            "tags": ["rotating_light"],
            "click": movie["url"],
            "actions": _actions_for(
                movie, "Book now",
                ack_label="Got it - open alert", all_button=True,
            ),
        }
    )


def send_theatre_alert(movie, wanted, names, first_time, what="theatre",
                       day=None):
    """Push an alert about ONE watched theatre or screen on ONE date.

    One notification per watch item per date, each carrying its own ack id, so
    "Got it" here silences this item on this date and nothing else — not the
    movie, not the other theatres, not the same venue's other screens, and not
    the same screen on another day you are watching. Like the booking-open
    alert it therefore repeats every run until it is acked; `first_time` only
    changes the wording.
    """
    if not NTFY_TOPIC:
        print("!! NTFY_TOPIC not set - cannot send notification", file=sys.stderr)
        return False

    shown = ", ".join(names) or wanted
    # The date is what makes this alert distinct from the same screen on
    # another watched day, so it goes in the title, not buried in the body.
    when = f" on {day_label(day)}" if day else ""
    title = (
        f"{movie['name']}: {shown} now has shows{when}!" if first_time
        else f"{movie['name']}: still showing at {shown}{when}"
    )
    lead = (
        f"A {what} you asked about just came online"
        if first_time else f"Reminder - a {what} you asked about has shows"
    )
    return _publish(
        {
            "topic": NTFY_TOPIC,
            "title": title,
            "message": (
                f"{lead} in {movie['city']}{when}.\n{movie['url']}"
                f"\n\n\"Got it\" stops this {what}{when} only; "
                "\"Booked - stop all\" stops the whole movie."
            ),
            "priority": 5,
            "tags": ["performing_arts"],
            "click": movie["url"],
            "actions": _actions_for(
                movie, "Book now", theatre_ack_id(movie["id"], wanted, day),
                ack_label="Got it - this theatre", all_button=True,
            ),
        }
    )


# --- Detection --------------------------------------------------------------
def check_page(context, movie):
    """Return True if ticket booking is open for this movie."""
    page = context.new_page()
    try:
        print(f"   loading {movie['url']}")
        page.goto(movie["url"], wait_until="domcontentloaded", timeout=60000)

        # Let the SPA render. networkidle is best-effort (analytics beacons can
        # keep the network "busy" forever), so we cap it and always fall back to
        # a fixed settle delay.
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except Exception:
            pass
        page.wait_for_timeout(5000)

        # The movie's primary CTA lives in #page-cta-container. On a bookable
        # page it renders <button data-phase="postRelease">Book tickets</button>;
        # pre-release pages don't render this container at all. Wait briefly for
        # it — its ABSENCE is the normal "not open yet" state, not an error.
        try:
            page.wait_for_selector("#page-cta-container", timeout=10000)
        except Exception:
            pass
        page.wait_for_timeout(1000)

        body_text = (page.inner_text("body") or "")
        cta = page.query_selector("#page-cta-container")
        cta_text = cta.inner_text().strip() if cta else ""
        cta_phase = None
        if cta:
            phase_el = cta.query_selector("[data-phase]")
            if phase_el:
                cta_phase = phase_el.get_attribute("data-phase")
    finally:
        page.close()

    bl = body_text.lower()

    # --- Anti-bot / load sanity check ---
    # A real, rendered movie page is several thousand chars (header, cast,
    # footer). A challenge/blank page is tiny or carries a block marker.
    if len(bl) < 500 or any(m in bl for m in BLOCK_MARKERS):
        raise RuntimeError(
            "Page looks blocked or unrendered (likely anti-bot challenge). "
            f"body length={len(bl)}"
        )

    # Positive "booking is open" signals — verified on a LIVE bookable page
    # (maa-inti-bangaaram) and absent on the pre-release page:
    #   1. PRIMARY: the CTA button's data-phase == "postRelease" (structural —
    #      survives wording/localisation changes).
    #   2. BACKUP : the CTA / page text reads "Book tickets" / "Book now".
    # NOTE: /buytickets/ href detection was dropped — confirmed it never appears
    # even when bookable (the button navigates via JS, not an <a href>).
    phase_open = (cta_phase == "postRelease")
    cta_lower = cta_text.lower()
    text_open = (
        "book tickets" in cta_lower
        or "book now" in cta_lower
        or "book tickets" in bl
    )

    print(f"   cta data-phase    : {cta_phase!r}")
    print(f"   cta text          : {cta_text[:40]!r}")
    print(f"   postRelease phase : {phase_open}")
    print(f"   book-tickets text : {text_open}")

    return phase_open or text_open


def city_from_url(url):
    """.../movies/hyderabad/irumudi/ET00513087 -> "hyderabad"."""
    parts = [p for p in url.split("?")[0].split("/") if p]
    if "movies" in parts:
        i = parts.index("movies")
        if i + 1 < len(parts):
            return parts[i + 1]
    return "unknown"


def list_venues_cli(argv):
    """Write a browsable venue reference for a city.

        python check.py --venues <a currently-bookable movie URL>
                        [--language telugu] [--date YYYYMMDD]

    Needs a bookable movie because venues only exist once booking is open —
    any current release in your city will do, the list is the city's, not the
    movie's.
    """
    url = argv[0]
    opts = dict(zip(argv[1::2], argv[2::2]))
    when = None
    if "--date" in opts:
        when = datetime.datetime.strptime(opts["--date"], "%Y%m%d").date()

    city = city_from_url(url)
    movie = {
        "id": movie_id_from_url(url),
        "name": movie_slug_from_url(url),
        "city": city,
        "url": url,
        "theatres": [],
        "language": opts.get("--language", ""),
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        try:
            context = browser.new_context(
                user_agent=USER_AGENT,
                locale="en-IN",
                timezone_id="Asia/Kolkata",
                viewport={"width": 1366, "height": 900},
            )
            try:
                venues = scrape_venues(context, movie, when)
            finally:
                context.close()
        finally:
            browser.close()

    out = f"venues-{city}.md"
    today = datetime.date.today().isoformat()
    lines = [
        f"# {city.title()} venues on BookMyShow",
        "",
        f"{len(venues)} venues, captured {today} from "
        f"`{movie['name']}` ({movie['id']}).",
        "",
        "Paste any venue below into a movie's `theatres` in `movies.json`. "
        "Matching ignores case, word order and punctuation — every word in your "
        "entry must appear as a whole word in the venue name — or use the "
        "**code** for an exact, rename-proof match.",
        "",
        "**Screens** are the formats each venue is running *this* movie on, "
        "matched by the same word rule. Copy one into a theatre's `screens` "
        "to be told when that screen in particular opens:",
        "",
        "```json",
        '{"venue": "AMBH", "screens": ["HDR By Barco"]}',
        "```",
        "",
        "The screen list is per movie, not per venue — a cinema's IMAX screen "
        "only appears here while it is running the movie this was captured "
        "from.",
        "",
        "Regenerate with:",
        "",
        "```",
        "python check.py --venues <a currently-bookable movie URL>",
        "```",
        "",
        "| Venue | Code | Screens |",
        "|-------|------|---------|",
    ]
    for v in sorted(venues, key=lambda x: x["name"].lower()):
        screens = v.get("screens")
        # BMS writes a format as "Telugu • 2D | PCX SCREEN" - that pipe would
        # end the table cell, so escape it.
        cell = ("?" if screens is None
                else "<br>".join(f"`{x}`".replace("|", r"\|") for x in screens)
                or "—")
        lines.append(f"| {v['name']} | `{v['code']}` | {cell} |")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    print(f"\n{len(venues)} venues -> {out}")
    for v in sorted(venues, key=lambda x: x["name"].lower())[:8]:
        screens = v.get("screens")
        print(f"   {v['name']}  [{v['code']}]  "
              f"{'?' if screens is None else ', '.join(screens)}")
    print("   ...")


USAGE = (
    "usage: python check.py [--only movies|products]\n"
    "       python check.py --venues <bookable-movie-url> "
    "[--language <lang>] [--date YYYYMMDD]"
)


def new_context(browser):
    return browser.new_context(
        user_agent=USER_AGENT,
        locale="en-IN",
        timezone_id="Asia/Kolkata",
        viewport={"width": 1366, "height": 900},
    )


def check_with_retries(browser, movie, context):
    """check_page, retried when the page comes back as an anti-bot wall.

    BMS challenges datacenter IPs *intermittently* — the same runner loaded
    the page fine one run and got a 691-char Cloudflare interstitial the next.
    Retrying inside the run, on a brand-new browser context, converts most of
    those into a real answer instead of waiting 5 minutes for the next cron.

    Returns (is_open, context) — the context may have been replaced, and the
    caller still owns closing it.
    """
    last = None
    for attempt in range(1, BMS_ATTEMPTS + 1):
        try:
            return check_page(context, movie), context
        except Exception as e:
            last = e
            blocked = "blocked or unrendered" in str(e)
            if attempt >= BMS_ATTEMPTS or not blocked:
                raise
            wait = BMS_RETRY_DELAY_MS * attempt  # linear backoff
            print(f"   attempt {attempt}/{BMS_ATTEMPTS} looks blocked; "
                  f"retrying in {wait // 1000}s with a fresh context",
                  file=sys.stderr)
            # A fresh context drops the cookies/fingerprint that got flagged.
            context.close()
            context = new_context(browser)
            page = context.new_page()
            try:
                page.wait_for_timeout(wait)
            finally:
                page.close()
    raise last


def main():
    argv = sys.argv[1:]

    if argv[:1] == ["--venues"]:
        if len(argv) < 2:
            # Never fall through to a normal check: a typo here would silently
            # run the watcher instead.
            print(USAGE, file=sys.stderr)
            sys.exit(2)
        list_venues_cli(argv[1:])
        return

    # --only lets the movie and product watchers run on separate schedules
    # without each redoing the other's work.
    only = None
    if argv[:1] == ["--only"]:
        if len(argv) < 2 or argv[1] not in ("movies", "products"):
            print(USAGE, file=sys.stderr)
            sys.exit(2)
        only = argv[1]
        argv = argv[2:]
    if argv:
        print(f"unknown arguments: {' '.join(argv)}\n{USAGE}", file=sys.stderr)
        sys.exit(2)

    try:
        targets = [] if only == "products" else load_targets()
        # An ad-hoc BMS_URL run is about that one movie; skip products.
        products = (
            [] if (only == "movies" or BMS_URL) else load_products()
        )
    except Exception as e:
        print(f"!! could not load targets: {e}", file=sys.stderr)
        sys.exit(1)

    if not targets and not products:
        print("Nothing to check.")
        return

    fetch_acks()

    # A movie is done only when its booking-open alert AND every one of its
    # theatres has been acked — acking the open alert no longer takes the
    # theatres down with it.
    pending = [m for m in targets if pending_alerts(m)]
    pending_products = [p for p in products if not is_acked(p["id"])]
    for m in targets:
        if not pending_alerts(m):
            why = ("booked - all alerts stopped" if is_silenced(m["id"])
                   else "every alert acknowledged")
            print(f"-- skipping ({why}): {m['name']}")
    for p in products:
        if is_acked(p["id"]):
            print(f"-- skipping (already acknowledged): {p['name']}")
    if not pending and not pending_products:
        print("Everything has been acknowledged - nothing to watch.")
        return

    failures = []

    # Products first: a plain HTTP GET, so they don't need (or wait for) the
    # browser and still run if Chromium is unavailable.
    for product in pending_products:
        print(f"\n==== {product['name']} (stock) ====")
        try:
            in_stock, data, live = check_product(product)
        except Exception as e:
            print(f"!! stock check failed for {product['name']}: {e}",
                  file=sys.stderr)
            failures.append(product["name"])
            continue

        if in_stock:
            print(f">>> IN STOCK: {product['name']} - sending alert")
            if send_product_alert(product, data, live):
                record_alerted(product["id"])
            else:
                # An undelivered alert is a failed run, not a green one.
                failures.append(f"{product['name']} (alert not delivered)")
        else:
            print(">>> still out of stock")

    if not pending:
        if failures:
            print(f"\n!! {len(failures)} check(s) failed: {', '.join(failures)}",
                  file=sys.stderr)
            sys.exit(1)
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        try:
            for movie in pending:
                print(f"\n==== {movie['name']} ({movie['city']}) ====")
                # A fresh context per movie so cookies/storage can't leak
                # between checks.
                context = browser.new_context(
                    user_agent=USER_AGENT,
                    locale="en-IN",
                    timezone_id="Asia/Kolkata",
                    viewport={"width": 1366, "height": 900},
                )
                open_pending = not is_acked(movie["id"])
                days = watch_days(movie)
                if len(days) > 1:
                    print("   watching dates  : "
                          + ", ".join(str(d) for d in days))
                # Watch items (venue + screen) still owed an alert, per date —
                # each date is its own question, with its own ack.
                wanted = {
                    day: [
                        i for i in watchlist(movie)
                        if not is_acked(
                            theatre_ack_id(movie["id"], i["label"], day))
                    ]
                    for day in days
                }
                # Only items never yet seen live need the showtimes page —
                # a known-live one re-alerts from its marker, for free.
                outstanding = {
                    day: [
                        i for i in items
                        if not theatre_seen(movie["id"], i["label"], day)
                    ]
                    for day, items in wanted.items()
                }

                # The context must outlive the whole per-movie body, because
                # the theatre check opens a second page in it.
                try:
                    if has_alerted(movie["id"]):
                        # Booking-open never reverts and we have already said
                        # so. Skipping the movie page matters more now that a
                        # movie stays in play after its open alert is acked:
                        # that page is the main Cloudflare exposure.
                        print("   booking already known open - "
                              "skipping detection")
                        is_open = True
                    else:
                        try:
                            is_open, context = check_with_retries(
                                browser, movie, context
                            )
                        except Exception as e:
                            # Isolate failures: one blocked movie must not stop
                            # the rest.
                            print(f"!! check failed for {movie['name']}: {e}",
                                  file=sys.stderr)
                            failures.append(movie["name"])
                            continue

                    if not is_open:
                        print(">>> not open yet")
                        continue

                    print(f">>> BOOKING OPEN for {movie['name']}")

                    # One showtimes page per watched date, and only while some
                    # theatre on that date is still unaccounted for — every
                    # extra load is extra anti-bot exposure, so a date with
                    # nothing left to learn is never fetched.
                    reports = {}
                    for day in days:
                        report = {"day": day, "venues": None, "hits": {},
                                  "status": "ok"}
                        reports[day] = report
                        head = f"[{day}] " if day else ""
                        if not outstanding[day]:
                            report["status"] = "all-live"
                            if movie["theatres"]:
                                print(f"   {head}nothing left to look up - "
                                      "skipping theatre check")
                            continue
                        try:
                            venues = scrape_venues(context, movie, day)
                            hits = match_watchlist(venues, outstanding[day])
                            # Items already known live on this date are not
                            # looked up again (they re-alert from their
                            # marker), so fill them in from it — otherwise the
                            # open alert's repeat would report a screen it
                            # already told you was live as "not listed yet".
                            for i in watchlist(movie):
                                if i["label"] in hits:
                                    continue
                                if not theatre_seen(movie["id"], i["label"], day):
                                    continue
                                hits[i["label"]] = [
                                    {"name": n, "code": "", "screens": None}
                                    for n in theatre_venue_names(
                                        movie["id"], i["label"], day)
                                ]
                            report["venues"], report["hits"] = venues, hits
                            print(f"   {head}venues listed   : {len(venues)}")
                            print(f"   {head}yours with shows: {sorted(hits)}")
                            for i in outstanding[day]:
                                if i["label"] not in hits:
                                    print(f"   {head}still waiting   : "
                                          f"{i['label']} "
                                          f"(running {screens_at(venues, i)})")
                        except Exception as e:
                            # A theatre-list failure must never suppress the
                            # booking-open alert itself, nor the other dates.
                            print(f"!! {head}venue scrape failed: {e}",
                                  file=sys.stderr)
                finally:
                    context.close()

                # The booking-open alert and each theatre alert are now
                # independent notifications with independent acks, so a run
                # can legitimately send several.
                if open_pending:
                    if send_alert(movie, [reports[d] for d in days]):
                        record_alerted(movie["id"])
                    else:
                        # An undelivered alert is a failed run, not a green one.
                        failures.append(
                            f"{movie['name']} (open alert not delivered)"
                        )

                for day in days:
                    hits = reports[day]["hits"]
                    when = f" [{day}]" if day else ""
                    for item in wanted[day]:
                        label = item["label"]
                        seen = theatre_seen(movie["id"], label, day)
                        first_time = label in hits and not seen
                        if first_time:
                            names = [v["name"] for v in hits[label]]
                        elif seen:
                            names = theatre_venue_names(movie["id"], label, day)
                        else:
                            continue  # not live yet
                        # The screen is what makes this alert distinct from the
                        # same venue's other screens, so it belongs in the name.
                        if item["screen"]:
                            names = [f"{n} - {item['screen']}" for n in names]
                        print(f"   theatre alert: {label}{when} "
                              f"({'new' if first_time else 'repeat'})")
                        if send_theatre_alert(
                                movie, label, names, first_time,
                                "screen" if item["screen"] else "theatre",
                                day):
                            if first_time:
                                record_theatre(movie["id"], label,
                                               hits[label], day)
                        else:
                            failures.append(
                                f"{movie['name']} / {label}{when} "
                                "(alert not delivered)"
                            )
        finally:
            browser.close()

    if failures:
        # Exit non-zero so the failure is visible in the Actions tab, but only
        # after every other movie has been checked.
        print(f"\n!! {len(failures)} check(s) failed: {', '.join(failures)}",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
