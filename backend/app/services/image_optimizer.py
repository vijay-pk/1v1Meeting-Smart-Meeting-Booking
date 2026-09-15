"""
Server-side optimization of uploaded profile images.

A phone photo is several megabytes and thousands of pixels wide; a profile photo is shown at
a few hundred pixels. Every JPEG, PNG and WebP upload is decoded, oriented, stripped of
metadata (EXIF can carry GPS coordinates), scaled down to fit MAX_DIMENSION without
upscaling or changing the aspect ratio, and re-encoded as WebP.

The result is only used when it is actually better: an already-small, already-optimized
image with no metadata is kept as it is rather than recompressed into a worse copy of itself.
GIF and AVIF are passed through untouched, as before.
"""
import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_DIMENSION = 1024
WEBP_QUALITY = 82
# Refuse images that decode to an absurd pixel count (a "decompression bomb": a few KB on
# disk, gigabytes in memory). 40 MP covers any real camera.
MAX_PIXELS = 40_000_000

OPTIMIZABLE_TYPES = {"image/jpeg", "image/png", "image/webp"}


class ImageOptimizationError(ValueError):
    """The file claims to be an image but cannot be safely decoded."""


@dataclass
class OptimizedImage:
    content: bytes
    content_type: str
    extension: str
    width: int
    height: int
    optimized: bool


def optimize_profile_image(content: bytes, content_type: str, extension: str) -> OptimizedImage:
    if content_type not in OPTIMIZABLE_TYPES:
        return OptimizedImage(content, content_type, extension, 0, 0, optimized=False)

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as probe:
                probe.verify()  # structural check without a full decode
            image = Image.open(io.BytesIO(content))
            image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning,
            OSError, SyntaxError, ValueError) as exc:
        raise ImageOptimizationError("That image could not be read. Please upload a different photo.") from exc

    if image.width * image.height > MAX_PIXELS:
        raise ImageOptimizationError("That image is too large to process.")

    original_size = image.size
    has_metadata = bool(image.info.get("exif")) or bool(image.getexif())

    # Apply the camera's orientation before the EXIF that records it is dropped, or portrait
    # phone photos come out sideways.
    image = ImageOps.exif_transpose(image)

    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    image = image.convert("RGBA" if has_alpha else "RGB")

    resized = max(image.size) > MAX_DIMENSION
    if resized:
        image.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)  # never upscales

    out = io.BytesIO()
    # No exif/xmp is passed, so none is written. The ICC profile is kept: dropping it shifts
    # colours on wide-gamut phone photos.
    save_kwargs = {"format": "WEBP", "quality": WEBP_QUALITY, "method": 6}
    icc = image.info.get("icc_profile")
    if icc:
        save_kwargs["icc_profile"] = icc
    image.save(out, **save_kwargs)
    encoded = out.getvalue()

    # Keep the original only when re-encoding would make it bigger and there is nothing to
    # remove from it: no resize needed and no metadata to strip.
    if len(encoded) >= len(content) and not resized and not has_metadata and content_type in ("image/jpeg", "image/webp"):
        return OptimizedImage(content, content_type, extension, original_size[0], original_size[1], optimized=False)

    return OptimizedImage(encoded, "image/webp", ".webp", image.width, image.height, optimized=True)
