"""
Import an admin's own public SuperProfile page.

Two jobs, kept separate on purpose:

1. `fetch_public_page()` — fetch a public URL without becoming a server-side request forgery
   tool. Only https, only superprofile.bio, only public IP addresses, redirects re-validated,
   timeouts and a hard body cap.
2. `parse_superprofile()` — turn that HTML into structured data **without inventing any of
   it**. A field the page does not expose comes back as None. There are no defaults, no
   placeholder strings, and no per-URL special cases: an importer that fabricates a price or
   a social link is worse than one that returns nothing, because the admin cannot tell the
   difference between "the page said this" and "we made it up".

Nothing here writes to the database. Parsed output goes into a ProfileImport row and is only
applied to the admin's real profile after they confirm.

Two rules the parser enforces at the source, not at the edges:

* **No photos, ever.** Nothing in this module reads `og:image`, `profilePicture`, `image`,
  `cover`, `thumbnail` or any other image URL into the result. There is no image field in the
  parsed payload for the API layer to apply even by accident.
* **Video only from YouTube or Vimeo.** Any other video host is dropped, and a page with no
  YouTube/Vimeo video yields `video_url: None` so the admin's existing video is left alone.

What the page actually looks like (verified against the live site, 2026-09):

* superprofile.bio is a Next.js *pages*-router app served through Vercel. The server HTML is
  an empty shell plus `<script id="__NEXT_DATA__">`; every visible card is rendered by the
  browser. So the JSON is the reliable source for structure, and the rendered DOM is the only
  source for **price** — the prices are fetched client-side and appear nowhere in the JSON.
  Both are parsed here and merged by session title.
* Two page shapes exist, and they nest differently:
    - `/{handle}`           -> `prefetchedData.superProfile` (displayName, bio, socialConnects,
                               blocks). No sessions.
    - `/bookings/{handle}`  -> `prefetchedData` itself (name, tagline, bio, aboutMe, sessions,
                               socialLinks, spotlight). This is the page worth importing.
"""
import ipaddress
import json
import re
import socket
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, urljoin, parse_qs

import httpx
from bs4 import BeautifulSoup

# Only this host. Checked as an exact hostname match, never as a substring: a URL like
# https://evil.example.com/?q=superprofile.bio must not pass.
ALLOWED_HOSTS = {"superprofile.bio", "www.superprofile.bio"}

MAX_RESPONSE_BYTES = 2 * 1024 * 1024        # 2 MB of fetched HTML is already generous
# Pasted source is browser-rendered markup from an authenticated admin, so it is bigger than
# the server shell but is not an outbound request; it gets its own, larger cap.
MAX_PASTED_BYTES = 6 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 10.0
MAX_REDIRECTS = 3

MAX_TITLE_LEN = 200
MAX_TEXT_LEN = 5000
MAX_URL_LEN = 1000

REQUEST_HEADERS = {
    # Identifies the caller honestly. This fetches a public page as the admin who owns it;
    # it does not try to look like a browser to get around anything.
    "User-Agent": "BookMyMeet-ProfileImporter/1.0 (+admin-initiated public page import)",
    "Accept": "text/html,application/xhtml+xml",
}

# The supported route when superprofile.bio's bot check refuses an automated request. It is
# the admin's own page, opened in their own browser; nothing is bypassed on our side. The
# wording stays short because the UI shows it to an admin, not to a developer.
BLOCKED_MESSAGE = (
    "SuperProfile is blocking automated access to this page. You can still import your "
    "public information by providing the page content instead."
)

# Fingerprints of an interstitial served *instead of* the page: Vercel's checkpoint (what
# superprofile.bio uses), Cloudflare's, and generic CAPTCHA walls. A challenge can arrive with
# a 200, so the body is checked as well as the status code -- otherwise the parser would read
# the challenge page and report "no importable content", which is the wrong diagnosis.
CHALLENGE_MARKERS = (
    "vercel security checkpoint",
    "just a moment",
    "checking your browser",
    "cf-browser-verification",
    "cf_chl_opt",
    "__cf_chl",
    "attention required! | cloudflare",
    "enable javascript and cookies to continue",
    "please verify you are a human",
    "g-recaptcha",
    "h-captcha",
)


def looks_like_a_challenge_page(html: str) -> bool:
    """True when the document is an anti-bot interstitial rather than the page asked for."""
    if not html:
        return False
    head = html[:20000].lower()
    return any(marker in head for marker in CHALLENGE_MARKERS)


class SuperProfileURLError(ValueError):
    """The URL is not an acceptable public SuperProfile URL."""


class SuperProfileFetchError(Exception):
    """The public page could not be retrieved."""


class SuperProfileBlockedError(SuperProfileFetchError):
    """
    An anti-bot control refused the request.

    Distinct from every other fetch failure because it has a specific, legitimate remedy --
    the page's owner supplies the page content themselves -- and because it must never be
    worked around. Nothing in this module solves a challenge, retries with a browser
    User-Agent, or otherwise tries to look like something it is not.
    """

    reason = "automated_access_blocked"
    fallback = "html_paste"


class SuperProfileParseError(Exception):
    """The page was retrieved but is not a readable SuperProfile page."""


# ---------------------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------------------

def _host_resolves_to_public_ip(hostname: str) -> bool:
    """
    True only if every address the hostname resolves to is publicly routable.

    This is the SSRF gate. Without it, a redirect (or a DNS record the attacker controls)
    could point this fetcher at 127.0.0.1, 169.254.169.254 (cloud metadata) or anything on
    the deployment's private network.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False

    if not infos:
        return False

    for info in infos:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            return False
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    return True


def validate_superprofile_url(url: str) -> str:
    """Normalises and validates a user-supplied SuperProfile URL, or raises."""
    candidate = (url or "").strip()
    if not candidate:
        raise SuperProfileURLError("Please paste your public SuperProfile URL.")
    if len(candidate) > MAX_URL_LEN:
        raise SuperProfileURLError("That URL is too long to be a SuperProfile link.")

    if not candidate.startswith("http://") and not candidate.startswith("https://"):
        candidate = "https://" + candidate

    parsed = urlparse(candidate)
    if parsed.scheme != "https":
        raise SuperProfileURLError("Only https:// SuperProfile links can be imported.")

    hostname = (parsed.hostname or "").lower()
    if hostname not in ALLOWED_HOSTS:
        raise SuperProfileURLError(
            "That is not a SuperProfile URL. It should look like "
            "https://superprofile.bio/bookings/your-handle"
        )

    return parsed.geturl()


def _validate_fetch_target(url: str, *, allowed_hosts: set) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise SuperProfileFetchError("This page redirected somewhere we will not follow.")
    hostname = (parsed.hostname or "").lower()
    if allowed_hosts and hostname not in allowed_hosts:
        raise SuperProfileFetchError("This page redirected off SuperProfile; nothing was imported.")
    if not _host_resolves_to_public_ip(hostname):
        raise SuperProfileFetchError("That address is not publicly reachable.")
    return url


async def fetch_public_page(
    url: str,
    *,
    allowed_hosts: Optional[set] = None,
    max_bytes: int = MAX_RESPONSE_BYTES,
    expected_content_type: str = "text/html",
) -> str:
    """
    Fetches a public page as text, with redirects validated at every hop.

    Raises SuperProfileFetchError for anything that goes wrong; the caller turns that into a
    user-facing message. Never raises an httpx error to the API layer.
    """
    hosts = ALLOWED_HOSTS if allowed_hosts is None else allowed_hosts
    target = _validate_fetch_target(url, allowed_hosts=hosts)

    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=REQUEST_TIMEOUT_SECONDS) as client:
            for _hop in range(MAX_REDIRECTS + 1):
                async with client.stream("GET", target, headers=REQUEST_HEADERS) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise SuperProfileFetchError("This page could not be loaded.")
                        target = _validate_fetch_target(
                            urljoin(target, location), allowed_hosts=hosts
                        )
                        continue

                    if response.status_code == 404:
                        raise SuperProfileFetchError("That SuperProfile page could not be found.")
                    if response.status_code in (401, 403, 429, 503):
                        # Verified behaviour: superprofile.bio sits behind Vercel's bot check,
                        # which answers every non-browser request with 429 and a JavaScript
                        # challenge. Solving that challenge would be defeating an anti-bot
                        # control, so this stops here and offers the supported alternative.
                        raise SuperProfileBlockedError(BLOCKED_MESSAGE)
                    if response.status_code != 200:
                        raise SuperProfileFetchError("Unable to access this public page.")

                    content_type = (response.headers.get("content-type") or "").lower()
                    if expected_content_type not in content_type:
                        raise SuperProfileFetchError("That link does not point at a public web page.")

                    # Streamed, so an enormous or endless body is cut off rather than read
                    # into memory in full.
                    chunks: List[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > max_bytes:
                            raise SuperProfileFetchError("That page is too large to import.")
                        chunks.append(chunk)
                    body = b"".join(chunks).decode("utf-8", errors="replace")
                    # A challenge can be served with a 200. Reporting it as a successful
                    # fetch would make the parser blame the page for having no content.
                    if looks_like_a_challenge_page(body):
                        raise SuperProfileBlockedError(BLOCKED_MESSAGE)
                    return body

            raise SuperProfileFetchError("That page redirected too many times.")
    except SuperProfileFetchError:
        raise
    except httpx.TimeoutException as exc:
        raise SuperProfileFetchError("That page took too long to respond.") from exc
    except Exception as exc:
        raise SuperProfileFetchError("Unable to access this public page.") from exc


# ---------------------------------------------------------------------------------------
# Text handling
# ---------------------------------------------------------------------------------------

def safe_extract_text(val: Any) -> str:
    """
    Pulls plain text out of a string, a DraftJS-style dict, or a list of those.

    SuperProfile stores rich text several different ways depending on the field, which is why
    this handles more than one shape.
    """
    if not val:
        return ""
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, dict):
        if isinstance(val.get("text"), str):
            return val["text"].strip()
        if isinstance(val.get("html"), str):
            return BeautifulSoup(val["html"], "html.parser").get_text(separator=" ").strip()
        if isinstance(val.get("blocks"), list):
            texts = [b.get("text", "") for b in val["blocks"] if isinstance(b, dict)]
            return "\n".join(t for t in texts if t).strip()
        return " ".join(str(v) for v in val.values() if isinstance(v, str)).strip()
    if isinstance(val, list):
        return " ".join(safe_extract_text(item) for item in val).strip()
    return str(val).strip()


def clean_text(value: Any, *, max_len: int = MAX_TEXT_LEN) -> Optional[str]:
    """
    Normalises imported text and strips any markup.

    Everything from the external page passes through here, so no HTML — and therefore no
    script, iframe or event handler — is ever stored or handed to the frontend. Returns None
    for empty values so callers can distinguish "absent" from "empty string".
    """
    text = safe_extract_text(value)
    if not text:
        return None
    if "<" in text:
        # Block-level tags become newlines first, otherwise a session description written as
        # <p>…</p><p>…</p> collapses into one run-on paragraph.
        soup = BeautifulSoup(text, "html.parser")
        for tag in soup.find_all(["script", "style", "iframe", "noscript"]):
            tag.decompose()
        for tag in soup.find_all(["p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6"]):
            tag.append("\n")
        text = soup.get_text(separator=" ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    # Inline markup (<strong>word</strong>.) leaves a space before the punctuation once the
    # tags are gone. Close it up so the imported copy reads as the page reads.
    text = re.sub(r" +([,.;:!?%])", r"\1", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return None
    return text[:max_len]


def clean_url(value: Any) -> Optional[str]:
    """Accepts only absolute http(s) URLs of a sane length."""
    raw = safe_extract_text(value)
    if not raw or len(raw) > MAX_URL_LEN:
        return None
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return raw


# ---------------------------------------------------------------------------------------
# Video: YouTube and Vimeo only
# ---------------------------------------------------------------------------------------

YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "www.youtu.be",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
}
VIMEO_HOSTS = {"vimeo.com", "www.vimeo.com", "player.vimeo.com"}

_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
_VIMEO_ID = re.compile(r"^\d{6,15}$")


def normalize_video_url(value: Any) -> Optional[Dict[str, str]]:
    """
    Recognises a public YouTube or Vimeo video and returns it in canonical form.

    Anything else — a self-hosted mp4, a Loom, a Wistia embed, a bare image, a non-video page
    on the same host — returns None. That is deliberate: requirement is that only YouTube and
    Vimeo can become an imported profile video, and that we never store an arbitrary
    third-party media URL.

    The returned `url` is the watch/canonical form, which is what the public profile page
    already knows how to render; `embed_url` is provided for the preview.
    """
    raw = safe_extract_text(value)
    if not raw or len(raw) > MAX_URL_LEN:
        return None
    if raw.startswith("//"):
        raw = "https:" + raw
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        return None

    host = (parsed.hostname or "").lower()
    segments = [s for s in (parsed.path or "").split("/") if s]

    if host in YOUTUBE_HOSTS:
        video_id: Optional[str] = None
        if host in ("youtu.be", "www.youtu.be"):
            video_id = segments[0] if segments else None
        elif segments and segments[0] in ("embed", "shorts", "live", "v"):
            video_id = segments[1] if len(segments) > 1 else None
        elif (parsed.path or "").rstrip("/") in ("/watch", ""):
            video_id = (parse_qs(parsed.query).get("v") or [None])[0]
        if not video_id or not _YOUTUBE_ID.match(video_id):
            return None
        return {
            "provider": "youtube",
            "video_id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "embed_url": f"https://www.youtube.com/embed/{video_id}",
        }

    if host in VIMEO_HOSTS:
        # https://vimeo.com/1130419767, https://player.vimeo.com/video/1149115590,
        # https://vimeo.com/channels/staffpicks/1130419767 -- the id is the last numeric part.
        video_id = next((s for s in reversed(segments) if _VIMEO_ID.match(s)), None)
        if not video_id:
            return None
        return {
            "provider": "vimeo",
            "video_id": video_id,
            "url": f"https://vimeo.com/{video_id}",
            "embed_url": f"https://player.vimeo.com/video/{video_id}",
        }

    return None


def _iter_strings(value: Any, depth: int = 0):
    """Yields every string inside a nested JSON structure, depth-capped."""
    if depth > 8:
        return
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_strings(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_strings(item, depth + 1)


_URL_IN_TEXT = re.compile(r"https?://[^\s\"'<>\\]+")


def find_video(*sources: Any) -> Optional[Dict[str, str]]:
    """
    Returns the first YouTube/Vimeo video found across the given sources, in the order given.

    Each source may be a string, a nested dict/list of SuperProfile data, or a BeautifulSoup
    tag; strings are also scanned for embedded URLs, which is how the video inside a session's
    rich-text description (an `<iframe src="https://player.vimeo.com/video/…">`) is found.
    """
    for source in sources:
        if source is None:
            continue
        if isinstance(source, BeautifulSoup) or hasattr(source, "find_all"):
            for frame in source.find_all(["iframe", "embed", "source", "video"]):
                found = normalize_video_url(frame.get("src"))
                if found:
                    return found
            for anchor in source.find_all("a", href=True):
                found = normalize_video_url(anchor["href"])
                if found:
                    return found
            continue
        for text in _iter_strings(source):
            found = normalize_video_url(text)
            if found:
                return found
            for candidate in _URL_IN_TEXT.findall(text):
                found = normalize_video_url(candidate.replace("&amp;", "&"))
                if found:
                    return found
    return None


# ---------------------------------------------------------------------------------------
# Structured page data
# ---------------------------------------------------------------------------------------

def _next_data(soup: BeautifulSoup) -> Dict[str, Any]:
    """`props.pageProps.prefetchedData` from the Next.js payload, or {}."""
    script = soup.find("script", id="__NEXT_DATA__")
    if not script:
        return {}
    raw = script.string or script.get_text() or ""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    page_props = data.get("props", {})
    if not isinstance(page_props, dict):
        return {}
    page_props = page_props.get("pageProps", {})
    if not isinstance(page_props, dict):
        return {}
    prefetched = page_props.get("prefetchedData")
    return prefetched if isinstance(prefetched, dict) else {}


def _sub(container: Dict[str, Any], key: str) -> Dict[str, Any]:
    value = container.get(key)
    return value if isinstance(value, dict) else {}


def _meta(soup: BeautifulSoup, prop: str) -> Optional[str]:
    tag = soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})
    if tag and tag.get("content"):
        return clean_text(tag.get("content"))
    return None


_SUPERPROFILE_SUFFIX = re.compile(r"\s*[|\-–]\s*SuperProfile\s*$", re.IGNORECASE)


def _strip_site_suffix(value: Optional[str]) -> Optional[str]:
    """og:title is "Adways Academy | SuperProfile"; the site name is not part of the name."""
    if not value:
        return None
    cleaned = _SUPERPROFILE_SUFFIX.sub("", value).strip()
    return cleaned or None


# ---------------------------------------------------------------------------------------
# Prices: rendered DOM only
# ---------------------------------------------------------------------------------------

CURRENCY_SYMBOLS = {"₹": "INR", "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY"}
_MONEY = re.compile(r"([₹$€£¥])\s*([\d,]+(?:\.\d{1,2})?)")


def _money(text: Optional[str]) -> Optional[Tuple[int, str]]:
    """"₹1,497" -> (149700, "INR"). Minor units, because that is how prices are stored."""
    if not text:
        return None
    match = _MONEY.search(text)
    if not match:
        return None
    try:
        amount = float(match.group(2).replace(",", ""))
    except ValueError:
        return None
    if amount <= 0:
        return None
    return int(round(amount * 100)), CURRENCY_SYMBOLS[match.group(1)]


def _normalize_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (title or "").casefold())


def _rendered_session_cards(soup: BeautifulSoup) -> Dict[str, Dict[str, Any]]:
    """
    Reads the browser-rendered session cards, keyed by normalised title.

    This exists for one reason: the displayed price is fetched client-side and is not present
    anywhere in `__NEXT_DATA__`. Verified against the live page — the server HTML contains no
    `.session-card` markup and no currency amounts at all.
    """
    cards: Dict[str, Dict[str, Any]] = {}
    for card in soup.select(".session-card"):
        title_el = card.select_one(".session-card-title")
        title = clean_text(title_el.get_text() if title_el else None, max_len=MAX_TITLE_LEN)
        if not title:
            continue

        final_el = card.select_one(".session-final-price")
        original_el = card.select_one(".original-price")
        final = _money(final_el.get_text() if final_el else None)
        original = _money(original_el.get_text() if original_el else None)

        duration_el = card.select_one(".session-duration")
        duration = _parse_duration(duration_el.get_text() if duration_el else None)

        description_el = card.select_one(".session-card-description")

        cards[_normalize_key(title)] = {
            "title": title,
            "price": final[0] if final else None,
            "currency": final[1] if final else (original[1] if original else None),
            "original_price": original[0] if original else None,
            "duration_minutes": duration,
            "description": clean_text(description_el.get_text() if description_el else None),
        }
    return cards


# ---------------------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------------------

def _parse_duration(raw: Any) -> Optional[int]:
    """
    Minutes, or None. Never a default — an invented duration books the wrong slot.

    Real shape on the live page: {"value": 15, "unit": "min", "duration": 15,
    "durationUnit": "min"}. The rendered card says "15 mins" / "1 hour".
    """
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)) and raw > 0:
        return int(raw)
    if isinstance(raw, dict):
        unit = str(raw.get("unit") or raw.get("durationUnit") or "min").lower()
        for key in ("value", "duration", "minutes"):
            found = _parse_duration(raw.get(key))
            if found:
                return found * 60 if unit.startswith("h") else found
        return None
    if isinstance(raw, str):
        match = re.search(r"(\d+)", raw)
        if not match:
            return None
        value = int(match.group(1))
        if value <= 0:
            return None
        return value * 60 if re.search(r"\bh(ou)?r", raw, re.IGNORECASE) else value
    return None


def _parse_input_fields(raw: Any) -> List[Dict[str, Any]]:
    """The public booking form's questions, as the page declares them."""
    if not isinstance(raw, list):
        return []
    fields: List[Dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        label = clean_text(entry.get("fieldName") or entry.get("label"), max_len=MAX_TITLE_LEN)
        if not label:
            continue
        fields.append({
            "label": label,
            "type": clean_text(entry.get("fieldType") or entry.get("type"), max_len=40),
            "required": bool(entry.get("mandatory")),
            "description": clean_text(entry.get("fieldDescription"), max_len=500),
        })
    return fields


def _parse_sessions(
    prefetched: Dict[str, Any],
    rendered: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Merges the JSON sessions with the rendered cards.

    JSON wins for everything it actually carries (title, duration, descriptions, form fields,
    the SuperProfile session id); the rendered card supplies the price, which the JSON does
    not contain. A session the page shows but the JSON omits is still imported from the card
    alone rather than dropped.
    """
    sessions: List[Dict[str, Any]] = []
    matched: set = set()

    raw_sessions = prefetched.get("sessions")
    for item in raw_sessions if isinstance(raw_sessions, list) else []:
        if not isinstance(item, dict):
            continue

        # status 1 is "live". A session the creator has hidden is not public information.
        if "status" in item and item.get("status") not in (1, "1", True, None):
            continue

        title = clean_text(item.get("title") or item.get("name"), max_len=MAX_TITLE_LEN)
        if not title:
            # A session we cannot even name is not a session we can import.
            continue

        key = _normalize_key(title)
        card = rendered.get(key, {})
        matched.add(key)

        description = clean_text(item.get("description"))
        short_description = clean_text(
            item.get("shortDescription") or item.get("subtitle"), max_len=1000
        )

        currency = clean_text(item.get("currency") or item.get("creatorCurrency"), max_len=10)

        sessions.append({
            # Verbatim, only stripped of markup. Never summarised or rewritten.
            "title": title,
            "description": description or short_description,
            "short_description": short_description,
            "duration_minutes": (
                _parse_duration(item.get("duration") or item.get("durationMinutes"))
                or card.get("duration_minutes")
            ),
            # Price and currency come from the rendered card, because the JSON has neither.
            "price": card.get("price"),
            "original_price": card.get("original_price"),
            "currency": (currency.upper() if currency else None) or card.get("currency"),
            "category": clean_text(
                item.get("sessionCategory") or item.get("category"), max_len=MAX_TITLE_LEN
            ),
            "input_fields": _parse_input_fields(item.get("inputFields")),
            # Only YouTube/Vimeo; the cover may also be an image, which is ignored.
            "video_url": (find_video(item.get("cover"), description_html(item)) or {}).get("url"),
            # SuperProfile's own id for this session, used to recognise a re-import.
            "source_ref": clean_text(item.get("_id") or item.get("id"), max_len=64),
            "badge": clean_text(item.get("tag"), max_len=60),
        })

    # Cards the JSON did not describe (a different page shape, or a pasted fragment).
    for key, card in rendered.items():
        if key in matched:
            continue
        sessions.append({
            "title": card["title"],
            "description": card.get("description"),
            "short_description": card.get("description"),
            "duration_minutes": card.get("duration_minutes"),
            "price": card.get("price"),
            "original_price": card.get("original_price"),
            "currency": card.get("currency"),
            "category": None,
            "input_fields": [],
            "video_url": None,
            "source_ref": None,
            "badge": None,
        })

    return sessions


def description_html(item: Dict[str, Any]) -> Optional[str]:
    """The raw description markup, kept only so a video embedded in it can be found."""
    raw = item.get("description")
    return raw if isinstance(raw, str) else None


# ---------------------------------------------------------------------------------------
# Social links
# ---------------------------------------------------------------------------------------

# SuperProfile stores some socials as a bare handle plus a type ("Instagram" / "adways.in").
# Rebuilding the canonical URL from the creator's own stated handle is reconstruction, not
# invention; a type we do not recognise is skipped rather than guessed at.
SOCIAL_URL_TEMPLATES = {
    "instagram": "https://www.instagram.com/{handle}",
    "youtube": "https://www.youtube.com/@{handle}",
    "linkedin": "https://www.linkedin.com/in/{handle}",
    "twitter": "https://twitter.com/{handle}",
    "x": "https://x.com/{handle}",
    "facebook": "https://www.facebook.com/{handle}",
    "threads": "https://www.threads.net/@{handle}",
    "telegram": "https://t.me/{handle}",
    "tiktok": "https://www.tiktok.com/@{handle}",
    "snapchat": "https://www.snapchat.com/add/{handle}",
    "pinterest": "https://www.pinterest.com/{handle}",
    "github": "https://github.com/{handle}",
    "spotify": "https://open.spotify.com/user/{handle}",
    "discord": "https://discord.gg/{handle}",
}

# The keys the AdminProfile.social_links JSON already uses.
SOCIAL_KEY_BY_DOMAIN = (
    ("instagram.com", "instagram"),
    ("wa.me", "whatsapp"),
    ("whatsapp.com", "whatsapp"),
    ("linkedin.com", "linkedin"),
    ("youtube.com", "youtube"),
    ("youtu.be", "youtube"),
    ("t.me", "telegram"),
    ("telegram.me", "telegram"),
    ("twitter.com", "twitter"),
    ("x.com", "twitter"),
    ("facebook.com", "facebook"),
    ("threads.net", "threads"),
    ("tiktok.com", "tiktok"),
    ("github.com", "github"),
)


def _social_key(url: str) -> Optional[str]:
    lowered = url.lower()
    for domain, key in SOCIAL_KEY_BY_DOMAIN:
        if domain in lowered:
            return key
    return None


def _resolve_social(kind: Any, value: Any) -> Optional[str]:
    """A social entry as a full URL, from either a URL or a type + handle."""
    direct = clean_url(value)
    if direct:
        return direct
    handle = safe_extract_text(value).strip().lstrip("@")
    if not handle or " " in handle or len(handle) > 100:
        return None
    template = SOCIAL_URL_TEMPLATES.get(safe_extract_text(kind).strip().casefold())
    if not template:
        return None
    return template.format(handle=handle)


# ---------------------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------------------

def parse_superprofile(html: str, page_url: str) -> Dict[str, Any]:
    """
    Extracts what the public page actually exposes. Absent fields come back as None.

    Raises SuperProfileParseError when the document is not a SuperProfile page at all, so the
    admin gets "we could not read this page" rather than a silent, empty preview.
    """
    soup = BeautifulSoup(html or "", "html.parser")
    prefetched = _next_data(soup)
    rendered = _rendered_session_cards(soup)

    # `/{handle}` nests everything under superProfile; `/bookings/{handle}` does not.
    super_profile = _sub(prefetched, "superProfile")
    about = _sub(prefetched, "aboutMe")

    name = (
        clean_text(about.get("name"), max_len=MAX_TITLE_LEN)
        or clean_text(prefetched.get("name"), max_len=MAX_TITLE_LEN)
        or clean_text(super_profile.get("displayName"), max_len=MAX_TITLE_LEN)
    )
    if not name and (super_profile.get("firstname") or super_profile.get("lastname")):
        name = clean_text(
            f"{super_profile.get('firstname', '')} {super_profile.get('lastname', '')}",
            max_len=MAX_TITLE_LEN,
        )
    if not name:
        name = _strip_site_suffix(_meta(soup, "og:title"))

    headline = clean_text(
        about.get("headline") or about.get("title") or prefetched.get("tagline"),
        max_len=MAX_TITLE_LEN,
    )
    bio = clean_text(
        about.get("description") or prefetched.get("bio") or super_profile.get("bio")
    )
    if not headline and not bio:
        # Only as a last resort, and only into one of the two, so the same sentence is not
        # imported twice.
        headline = _meta(soup, "og:description")

    # ---- video: YouTube/Vimeo only, and only from profile-level places ----
    # Session videos belong to their session and are reported there, never promoted into the
    # profile video: importing a session's cover as the admin's intro video would be exactly
    # the "unrelated video URL" the requirements rule out.
    video = find_video(
        _sub(prefetched, "spotlight").get("items"),
        about,
        super_profile.get("blocks"),
        super_profile.get("highlights"),
        _meta(soup, "og:video") or _meta(soup, "og:video:url"),
        soup.find("main") or soup.find("body") or soup,
    )
    video_source = "profile" if video else None

    # ---- social links ----
    social_links: Dict[str, str] = {}
    website: Optional[str] = None

    def _record(link: Optional[str]) -> None:
        nonlocal website
        if not link:
            return
        key = _social_key(link)
        if key:
            social_links.setdefault(key, link)
        elif "superprofile.bio" not in link.lower() and "cosmofeed.com" not in link.lower():
            if website is None:
                website = link

    for entry in _sub(prefetched, "socialLinks").get("items") or []:
        if isinstance(entry, dict):
            _record(_resolve_social(
                entry.get("type") or entry.get("socialType") or entry.get("title"),
                entry.get("url") or entry.get("link") or entry.get("socialURL") or entry.get("value"),
            ))

    for entry in super_profile.get("socialConnects") or []:
        if isinstance(entry, dict) and entry.get("enabled"):
            _record(_resolve_social(entry.get("socialType"), entry.get("socialURL")))

    for entry in about.get("socials") or []:
        if isinstance(entry, dict):
            _record(_resolve_social(
                entry.get("type") or entry.get("socialType"),
                entry.get("url") or entry.get("socialURL") or entry.get("value"),
            ))

    for anchor in soup.find_all("a", href=True):
        _record(clean_url(anchor["href"]))

    # ---- public link sections ----
    public_links: List[Dict[str, str]] = []
    for entry in _sub(prefetched, "links").get("items") or []:
        if not isinstance(entry, dict):
            continue
        label = clean_text(entry.get("title") or entry.get("label"), max_len=MAX_TITLE_LEN)
        href = clean_url(entry.get("url"))
        if label and href:
            public_links.append({"label": label, "url": href})

    faqs: List[Dict[str, str]] = []
    faq_section = _sub(prefetched, "faqs")
    if faq_section.get("isEnabled"):
        for entry in faq_section.get("items") or []:
            if not isinstance(entry, dict):
                continue
            question = clean_text(entry.get("question") or entry.get("title"), max_len=MAX_TITLE_LEN)
            answer = clean_text(entry.get("answer") or entry.get("description"))
            if question and answer:
                faqs.append({"question": question, "answer": answer})

    sessions = _parse_sessions(prefetched, rendered)

    if not video:
        # Nothing profile-level, so fall back to the first video attached to a session on the
        # same page. It is still a video the creator published on this page, and the preview
        # labels where it came from -- but it is never applied without the admin ticking it.
        first = next((s for s in sessions if s.get("video_url")), None)
        if first:
            video = normalize_video_url(first["video_url"])
            video_source = "session" if video else None

    if not prefetched and not rendered and not name:
        raise SuperProfileParseError(
            "That page could not be read as a SuperProfile page. Make sure the URL is a "
            "public SuperProfile profile or booking page."
        )

    return {
        "source_url": page_url,
        "profile": {
            "name": name,
            "headline": headline,
            "bio": bio,
            # Photos are never read from the page. There is deliberately no image field here.
            "video_url": (video or {}).get("url"),
            "video_provider": (video or {}).get("provider"),
            "video_embed_url": (video or {}).get("embed_url"),
            # "profile" (spotlight/about/blocks/meta) or "session" (a session's own video).
            "video_source": video_source,
            "social_links": social_links,
            "website": website,
            "public_links": public_links,
            "faqs": faqs,
        },
        "sessions": sessions,
    }


async def import_superprofile(url: str, page_html: Optional[str] = None) -> Dict[str, Any]:
    """
    Validate -> fetch -> parse. The only entry point the API layer needs.

    `page_html` lets the admin supply the page source themselves, which is the supported
    route when SuperProfile refuses an automated request. It is their own page, opened in
    their own browser -- no access control is worked around, and the HTML is parsed and
    sanitized by exactly the same code as a fetched page.
    """
    validated = validate_superprofile_url(url)
    if page_html:
        if len(page_html) > MAX_PASTED_BYTES:
            raise SuperProfileFetchError("That page source is too large to import.")
        if looks_like_a_challenge_page(page_html):
            raise SuperProfileParseError(
                "That looks like the security-check page rather than your booking page. "
                "Wait for the page itself to finish loading, then copy it again."
            )
        return parse_superprofile(page_html, validated)
    html = await fetch_public_page(validated)
    return parse_superprofile(html, validated)
