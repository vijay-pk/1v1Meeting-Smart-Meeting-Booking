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
"""
import ipaddress
import json
import re
import socket
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, urljoin

import httpx
from bs4 import BeautifulSoup

# Only this host. Checked as an exact hostname match, never as a substring: a URL like
# https://evil.example.com/?q=superprofile.bio must not pass.
ALLOWED_HOSTS = {"superprofile.bio", "www.superprofile.bio"}

MAX_RESPONSE_BYTES = 2 * 1024 * 1024        # 2 MB of HTML is already generous
MAX_IMAGE_BYTES = 5 * 1024 * 1024
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


class SuperProfileURLError(ValueError):
    """The URL is not an acceptable public SuperProfile URL."""


class SuperProfileFetchError(Exception):
    """The public page could not be retrieved."""


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
            "https://superprofile.bio/your-handle"
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
                    if response.status_code in (401, 403):
                        # The page is gated. We do not try to look like a browser or work
                        # around the check -- an import must not bypass an access control.
                        raise SuperProfileFetchError(
                            "SuperProfile did not allow this page to be read automatically. "
                            "Only publicly accessible pages can be imported."
                        )
                    if response.status_code == 429:
                        # Observed behaviour: superprofile.bio answers 429 to non-browser
                        # clients. We identify ourselves honestly rather than imitating a
                        # browser to get past it, so the admin is offered the supported
                        # alternative instead: paste the page source themselves.
                        raise SuperProfileFetchError(
                            "SuperProfile declined an automated request for this page. "
                            "Open the page in your browser, copy its source, and paste it "
                            "into the import instead."
                        )
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
                    return b"".join(chunks).decode("utf-8", errors="replace")

            raise SuperProfileFetchError("That page redirected too many times.")
    except SuperProfileFetchError:
        raise
    except httpx.TimeoutException as exc:
        raise SuperProfileFetchError("That page took too long to respond.") from exc
    except Exception as exc:
        raise SuperProfileFetchError("Unable to access this public page.") from exc


async def fetch_public_image(url: str) -> tuple[bytes, str]:
    """
    Downloads an image the admin has confirmed they may reuse, so it can be stored in our own
    media directory instead of being hotlinked. Same SSRF rules; any host is allowed here
    because SuperProfile serves its images from a CDN domain.
    """
    parsed = urlparse((url or "").strip())
    if parsed.scheme != "https":
        raise SuperProfileFetchError("That image is not served over https.")
    if not _host_resolves_to_public_ip((parsed.hostname or "").lower()):
        raise SuperProfileFetchError("That image address is not publicly reachable.")

    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=REQUEST_TIMEOUT_SECONDS) as client:
            async with client.stream("GET", parsed.geturl(), headers={"User-Agent": REQUEST_HEADERS["User-Agent"]}) as response:
                if response.status_code != 200:
                    raise SuperProfileFetchError("That image could not be downloaded.")
                content_type = (response.headers.get("content-type") or "").lower()
                if not content_type.startswith("image/"):
                    raise SuperProfileFetchError("That link is not an image.")

                chunks: List[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_IMAGE_BYTES:
                        raise SuperProfileFetchError("That image is too large to import.")
                    chunks.append(chunk)
                return b"".join(chunks), content_type
    except SuperProfileFetchError:
        raise
    except Exception as exc:
        raise SuperProfileFetchError("That image could not be downloaded.") from exc


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
        text = BeautifulSoup(text, "html.parser").get_text(separator=" ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
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
# Parsing
# ---------------------------------------------------------------------------------------

def _prefetched_data(soup: BeautifulSoup) -> Dict[str, Any]:
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
    page_props = data.get("props", {}).get("pageProps", {})
    prefetched = page_props.get("prefetchedData")
    return prefetched if isinstance(prefetched, dict) else {}


def _meta(soup: BeautifulSoup, prop: str) -> Optional[str]:
    tag = soup.find("meta", property=prop)
    if tag and tag.get("content"):
        return clean_text(tag.get("content"))
    return None


def _parse_duration(raw: Any) -> Optional[int]:
    """Minutes, or None. Never a default — an invented duration books the wrong slot."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)) and raw > 0:
        return int(raw)
    if isinstance(raw, dict):
        for key in ("value", "duration", "minutes"):
            found = _parse_duration(raw.get(key))
            if found:
                return found
        return None
    if isinstance(raw, str):
        match = re.search(r"(\d+)", raw)
        if match:
            value = int(match.group(1))
            return value if value > 0 else None
    return None


def _parse_price_paise(raw: Any) -> Optional[int]:
    """
    Price in paise, or None when the page displays no price.

    SuperProfile reports prices in major units (₹999 -> 999). The previous implementation
    guessed with `int(p * 100) if p < 10000 else int(p)` and, failing that, made up ₹1999 --
    that is how sessions ended up priced at numbers nobody had ever set.
    """
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, str):
        digits = re.sub(r"[^\d.]", "", raw)
        if not digits:
            return None
        try:
            raw = float(digits)
        except ValueError:
            return None
    if not isinstance(raw, (int, float)) or raw <= 0:
        return None
    return int(round(float(raw) * 100))


def _parse_sessions(prefetched: Dict[str, Any], page_url: str) -> List[Dict[str, Any]]:
    raw_sessions = prefetched.get("sessions")
    if not isinstance(raw_sessions, list):
        return []

    sessions: List[Dict[str, Any]] = []
    for item in raw_sessions:
        if not isinstance(item, dict):
            continue

        title = clean_text(item.get("title") or item.get("name"), max_len=MAX_TITLE_LEN)
        if not title:
            # A session we cannot even name is not a session we can import.
            continue

        currency = clean_text(item.get("currency"), max_len=10)
        price = _parse_price_paise(item.get("price"))
        original_price = _parse_price_paise(item.get("originalPrice") or item.get("original_price"))

        booking_url = clean_url(item.get("url") or item.get("bookingUrl") or item.get("slug"))
        if not booking_url:
            slug = safe_extract_text(item.get("slug"))
            if slug:
                booking_url = urljoin(page_url.rstrip("/") + "/", slug)

        sessions.append({
            "title": title,
            # Verbatim, only stripped of markup. Never summarised or rewritten.
            "description": clean_text(item.get("description")),
            "duration_minutes": _parse_duration(item.get("duration") or item.get("durationMinutes")),
            "price": price,
            "original_price": original_price,
            # Currency is reported only when the page states one, and is never converted.
            "currency": currency.upper() if currency else ("INR" if price is not None and currency is None and _looks_rupee(item) else None),
            "category": clean_text(item.get("category") or item.get("type"), max_len=MAX_TITLE_LEN),
            "booking_url": booking_url,
            "availability_note": clean_text(item.get("availability") or item.get("availabilityText")),
            "instructions": clean_text(item.get("instructions") or item.get("note")),
            "badge": clean_text(item.get("tag"), max_len=60),
        })
    return sessions


def _looks_rupee(item: Dict[str, Any]) -> bool:
    """True when the session's own payload marks the amount in rupees."""
    blob = json.dumps(item, default=str)
    return "₹" in blob or '"INR"' in blob


def parse_superprofile(html: str, page_url: str) -> Dict[str, Any]:
    """
    Extracts what the public page actually exposes. Absent fields come back as None.
    """
    soup = BeautifulSoup(html, "html.parser")
    prefetched = _prefetched_data(soup)

    creator = prefetched.get("creator") if isinstance(prefetched.get("creator"), dict) else {}
    about = creator.get("aboutMe") if isinstance(creator.get("aboutMe"), dict) else {}
    profile = prefetched.get("profile") if isinstance(prefetched.get("profile"), dict) else {}

    name = clean_text(about.get("name"), max_len=MAX_TITLE_LEN)
    if not name and (creator.get("firstname") or creator.get("lastname")):
        name = clean_text(f"{creator.get('firstname', '')} {creator.get('lastname', '')}", max_len=MAX_TITLE_LEN)
    if not name:
        name = _meta(soup, "og:title")

    headline = clean_text(about.get("title") or prefetched.get("tagline"), max_len=MAX_TITLE_LEN)
    if not headline:
        headline = _meta(soup, "og:description")

    bio = clean_text(about.get("bio") or prefetched.get("bio") or prefetched.get("aboutMe"))

    image = clean_url(profile.get("imageUrl"))
    if not image and isinstance(about.get("image"), dict):
        image = clean_url(about["image"].get("url"))
    if not image:
        image = clean_url(_meta(soup, "og:image"))

    cover = None
    if isinstance(profile.get("background"), dict):
        cover = clean_url(profile["background"].get("imageUrl") or profile["background"].get("url"))
    if not cover:
        cover = clean_url(profile.get("coverImageUrl"))

    intro_video = None
    spotlight = prefetched.get("spotlight")
    items = spotlight.get("items") if isinstance(spotlight, dict) else None
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            candidate = clean_url(item.get("url") or item.get("mediaUrl"))
            if candidate and any(k in candidate for k in ("vimeo.com", "youtube.com", "youtu.be")):
                intro_video = candidate
                break

    social_links: Dict[str, str] = {}
    website: Optional[str] = None

    def _record(link: Optional[str]) -> None:
        nonlocal website
        if not link:
            return
        lowered = link.lower()
        if "instagram.com" in lowered:
            social_links.setdefault("instagram", link)
        elif "wa.me" in lowered or "whatsapp.com" in lowered:
            social_links.setdefault("whatsapp", link)
        elif "linkedin.com" in lowered:
            social_links.setdefault("linkedin", link)
        elif "youtube.com" in lowered or "youtu.be" in lowered:
            social_links.setdefault("youtube", link)
        elif "t.me" in lowered or "telegram" in lowered:
            social_links.setdefault("telegram", link)
        elif "superprofile.bio" not in lowered and website is None:
            website = link

    socials = prefetched.get("socialLinks")
    social_items = socials.get("items") if isinstance(socials, dict) else None
    if isinstance(social_items, list):
        for entry in social_items:
            if isinstance(entry, dict):
                _record(clean_url(entry.get("url")))

    for anchor in soup.find_all("a", href=True):
        _record(clean_url(anchor["href"]))

    public_links: List[Dict[str, str]] = []
    links_section = prefetched.get("links")
    link_items = links_section.get("items") if isinstance(links_section, dict) else None
    if isinstance(link_items, list):
        for entry in link_items:
            if not isinstance(entry, dict):
                continue
            label = clean_text(entry.get("title") or entry.get("label"), max_len=MAX_TITLE_LEN)
            href = clean_url(entry.get("url"))
            if label and href:
                public_links.append({"label": label, "url": href})

    return {
        "source_url": page_url,
        "profile": {
            "name": name,
            "headline": headline,
            "bio": bio,
            # Image URLs are for preview only. Nothing downloads or stores them unless the
            # admin confirms they have permission to reuse the image.
            "profile_image_url": image,
            "cover_image_url": cover,
            "intro_video": intro_video,
            "social_links": social_links,
            "website": website,
            "public_links": public_links,
        },
        "sessions": _parse_sessions(prefetched, page_url),
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
        if len(page_html) > MAX_RESPONSE_BYTES:
            raise SuperProfileFetchError("That page source is too large to import.")
        return parse_superprofile(page_html, validated)
    html = await fetch_public_page(validated)
    return parse_superprofile(html, validated)
