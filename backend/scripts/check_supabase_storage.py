"""
Reports whether this environment can actually store profile photos.

Run it wherever the backend runs -- locally, or in the Render shell -- to find out before an
admin discovers it by trying to upload. It performs a real round trip: create the bucket if
needed, upload a tiny PNG, read it back over the public URL, then delete it.

    cd backend
    python scripts/check_supabase_storage.py          # full round trip
    python scripts/check_supabase_storage.py --probe  # credentials only, writes nothing

**Prints no secrets.** Keys are reported only as present/absent, their length, and their
shape; the values never reach stdout, so the output is safe to paste anywhere.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.services import supabase_storage as store  # noqa: E402

# The smallest valid PNG: a single transparent pixel.
PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def describe_key(name: str, value: str) -> None:
    if not value:
        print(f"  {name}: MISSING")
        return
    looks_jwt = value.count(".") == 2 and value.startswith("ey")
    looks_new = value.startswith(("sb_secret_", "sb_publishable_"))
    placeholder = value.startswith("your-") or "your-supabase" in value
    shape = "legacy JWT" if looks_jwt else "new-style key" if looks_new else "unrecognised"
    note = "  <- PLACEHOLDER, not a real key" if placeholder else ""
    print(f"  {name}: present, {len(value)} chars, {shape}{note}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true", help="check credentials only, write nothing")
    args = parser.parse_args()

    print("Supabase project")
    print(f"  SUPABASE_URL: {settings.SUPABASE_URL or 'MISSING'}")
    describe_key("SUPABASE_ANON_KEY", settings.SUPABASE_ANON_KEY)
    describe_key("SUPABASE_SERVICE_ROLE_KEY", settings.SUPABASE_SERVICE_ROLE_KEY)
    print(f"  bucket: {store.BUCKET}")

    if not store.is_configured():
        print("\nRESULT: uploads are DISABLED. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return 1

    base = settings.SUPABASE_URL.rstrip("/")
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    headers = {"Authorization": f"Bearer {key}", "apikey": key}

    print("\nChecking the key against Supabase Storage...")
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(f"{base}/storage/v1/bucket", headers=headers)

    if res.status_code != 200:
        print(f"  REJECTED: HTTP {res.status_code} {res.text[:200]}")
        print("\nRESULT: this key cannot manage storage. Copy the service role / secret key")
        print("        from Supabase -> Project Settings -> API.")
        return 1

    buckets = [b.get("name") for b in res.json()]
    print(f"  accepted. Buckets in this project: {buckets or '(none yet)'}")

    if args.probe:
        print("\n--probe: nothing was written.")
        print("RESULT: credentials are usable.")
        return 0

    print("\nRound trip: create bucket if needed, upload, read back, delete...")
    path = store.build_object_path("healthcheck", ".png")
    try:
        url = await store.upload_object(path, PIXEL, "image/png")
    except Exception as exc:                                    # noqa: BLE001 - reported
        print(f"  upload FAILED: {type(exc).__name__}: {exc}")
        return 1
    print(f"  stored at: {path}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        read = await client.get(url)
    ok = read.status_code == 200 and read.content == PIXEL
    print(f"  public read: HTTP {read.status_code}, bytes match: {ok}")

    await store.delete_object(path)
    print("  test object deleted")

    if not ok:
        print("\nRESULT: the object stored but could not be read back publicly.")
        print("        Check that the bucket is marked public in the Supabase dashboard.")
        return 1

    print("\nRESULT: profile photo storage is working in this environment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
