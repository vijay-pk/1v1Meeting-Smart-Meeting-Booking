"""Render brag.mp4 from the captured screenshots: title cards, captions, push-in, crossfades."""
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = Path(__file__).parent
SHOTS = HERE / "assets" / "screenshots"
FRAMES = HERE / "frames"
OUT = HERE.parent / "brag.mp4"
POSTER = HERE.parent / "brag.jpg"
W, H, FPS, FADE = 1920, 1080, 30, 0.5

BOLD = "C:/Windows/Fonts/segoeuib.ttf"
REG = "C:/Windows/Fonts/segoeui.ttf"
NAVY, ORANGE, WHITE, MUTED = (11, 16, 32), (249, 115, 22), (255, 255, 255), (148, 163, 184)


def font(path, size):
    return ImageFont.truetype(path, size)


def centered(draw, y, text, f, fill):
    w = draw.textlength(text, font=f)
    draw.text(((W - w) / 2, y), text, font=f, fill=fill)


def title_card(name, lines, kicker=None):
    img = Image.new("RGB", (W, H), NAVY)
    glow = Image.new("RGB", (W, H), NAVY)
    ImageDraw.Draw(glow).ellipse([W * 0.25, H * 0.15, W * 0.75, H * 0.85], fill=(60, 30, 20))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(220)), 0.9)
    d = ImageDraw.Draw(img)
    f = font(BOLD, 96)
    total = len(lines) * 120 + (70 if kicker else 0)
    y = (H - total) / 2
    if kicker:
        centered(d, y, kicker, font(BOLD, 34), ORANGE)
        y += 70
    for text, color in lines:
        centered(d, y, text, f, color)
        y += 120
    img.save(FRAMES / name)


def captioned(name, shot, caption, sub):
    img = Image.open(SHOTS / shot).convert("RGB").resize((W, H))
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    f1, f2 = font(BOLD, 58), font(REG, 30)
    width = max(d.textlength(caption, font=f1), d.textlength(sub, font=f2)) + 96
    x0, y0 = 64, H - 230
    d.rounded_rectangle([x0, y0, x0 + width, y0 + 166], radius=28, fill=(11, 16, 32, 235))
    d.rounded_rectangle([x0, y0, x0 + 10, y0 + 166], radius=5, fill=ORANGE + (255,))
    d.text((x0 + 48, y0 + 22), caption, font=f1, fill=WHITE)
    d.text((x0 + 48, y0 + 102), sub, font=f2, fill=MUTED)
    Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB").save(FRAMES / name)


FRAMES.mkdir(exist_ok=True)
title_card("00-hook.png", [("Your 1:1 sessions", WHITE), ("deserve better than DMs.", WHITE)])
title_card("01-meet.png", [("BookMyMeet", ORANGE)], kicker="MEET")
captioned("02.png", "01-profile.png", "Your own booking page", "bookmymeet / riyakapoor  -  sessions, prices, your brand")
captioned("03.png", "03-slots.png", "Clients pick a real free slot", "Working hours minus calendar, leave and bookings. No double-booking.")
captioned("04.png", "04-checkout.png", "They pay you. Directly.", "Your own Razorpay account. Zero platform cut.")
captioned("05.png", "05-setup.png", "Live in four steps", "Profile, hours, a session, your gateway.")
title_card("06-end.png", [("Your page.", WHITE), ("Your Razorpay.", WHITE), ("Your rules.", ORANGE)])

clips = [("00-hook.png", 2.6, False), ("01-meet.png", 2.0, False), ("02.png", 3.6, True),
         ("03.png", 3.6, True), ("04.png", 3.6, True), ("05.png", 3.0, True), ("06-end.png", 3.2, False)]

cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
for name, dur, _ in clips:
    cmd += ["-loop", "1", "-framerate", str(FPS), "-t", str(dur), "-i", str(FRAMES / name)]

parts = []
for i, (_, dur, push) in enumerate(clips):
    n = int(dur * FPS)
    if push:
        parts.append(f"[{i}:v]scale=3840:2160,zoompan=z='1+0.05*on/{n}':x='iw/2-(iw/zoom/2)':"
                     f"y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},format=yuv420p,setsar=1[c{i}]")
    else:
        parts.append(f"[{i}:v]fps={FPS},format=yuv420p,setsar=1[c{i}]")

prev, offset = "c0", 0.0
for i in range(1, len(clips)):
    offset += clips[i - 1][1] - FADE
    out = "v" if i == len(clips) - 1 else f"x{i}"
    parts.append(f"[{prev}][c{i}]xfade=transition=fade:duration={FADE}:offset={offset:.2f}[{out}]")
    prev = out

cmd += ["-filter_complex", ";".join(parts), "-map", "[v]", "-c:v", "libx264", "-preset", "medium",
        "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)]
subprocess.run(cmd, check=True, timeout=600)

subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", "9.0", "-i", str(OUT),
                "-frames:v", "1", "-q:v", "2", str(POSTER)], check=True, timeout=60)
print(OUT, POSTER)
