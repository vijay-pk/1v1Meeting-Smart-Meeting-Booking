# BookMyMeet Brag Video — Hyperframes Composition

Hyperframes composition files ready to check and render.

## Files

- **`composition.json`** — Main composition spec (7 scenes, 18 seconds, all animations and timing)
- **`assets-manifest.json`** — Asset references, sources, and capture guide
- **`README.md`** (this file) — Setup and render instructions

## Setup: Gather Assets

Before rendering, collect all required assets in the `assets/` subdirectory:

```
composition/
├── assets/
│   ├── screenshots/
│   │   ├── superprofile-homepage.png (1920x1080)
│   │   ├── time-availability-sessions.png
│   │   ├── time-availability-calendar.png
│   │   ├── payment-checkout.png
│   │   ├── razorpay-modal.png
│   │   └── admin-dashboard-booking.png
│   ├── music/
│   │   └── indie-uplifting-110bpm.mp3 (18-20s, 110-120 BPM)
│   └── audio/
│       └── sfx-layer.mp3 (18s, SFX cues embedded)
├── composition.json
└── assets-manifest.json
```

### Screenshot Capture Steps

1. **Start frontend dev server:**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Capture each screenshot** (1920×1080 landscape):
   - **superprofile-homepage.png:** Navigate to `http://localhost:5173/ameen-ahsan` (or any creator with video + sessions)
   - **time-availability-sessions.png:** Navigate to `/:username/schedule/:meetingId` (session selection view)
   - **time-availability-calendar.png:** Same route, scroll/navigate to calendar grid view
   - **payment-checkout.png:** Navigate to `/book/payment?adminId=...` (payment card visible, before modal)
   - **razorpay-modal.png:** (Optional) Use Razorpay test environment or screenshot from docs
   - **admin-dashboard-booking.png:** Navigate to `/admin/dashboard` (logged in as admin, with recent booking visible)

3. **Tools:** Use browser DevTools (Ctrl+Shift+K → Screenshot tool) or a tool like Sharp CLI to crop and resize to exact 1920×1080 if needed.

### Audio Files

**Music Track:**
- **Source:** Royalty-free or licensed indie/lo-fi electronic track
- **Specs:** 110-120 BPM, C major or compatible key, ~20 seconds
- **Providers:** Epidemic Sound, Artlist, Unsplash Music, Pixabay Music, YouTube Audio Library
- **Licensing:** Ensure commercial use is permitted
- **Format:** MP3, 320 kbps recommended
- **File:** `assets/music/indie-uplifting-110bpm.mp3`

**SFX Layer:**
- **Source:** Composite from royalty-free SFX libraries
- **Cues:** See `assets-manifest.json` for exact timing and types (whoosh, chimes, plinks, swipes, cash register, etc.)
- **Mixing:** Compile into single MP3, normalized to -6dB to -12dB relative to music peak
- **Format:** MP3, 128-192 kbps
- **File:** `assets/audio/sfx-layer.mp3`

**SFX Cue Library Recommendations:**
- Freesound.org (search by cue type, download royalty-free WAV/MP3)
- Epidemic Sound (SFX library, commercial license)
- Zapsplat (royalty-free SFX)
- YouTube Audio Library (SFX section)

## Render Workflow

### Step 1: Validate Composition

```bash
cd composition
npx hyperframes check
```

**Expected output:**
```
✓ composition.json is valid
✓ Scene timing: 0–18s (within bounds)
✓ Text readability: all fonts >16px
✓ Color contrast: WCAG AA pass
✓ Animation timings: no overlaps
✓ Assets referenced (6 screenshots, 2 audio tracks)

WARNING: Assets not found locally (expected — see setup guide)
```

**If errors appear:**
- Check `composition.json` for typos or invalid animation types
- Validate all `animation.type` values against hyperframes-animation spec
- Ensure all time values are in milliseconds (0–18000)

### Step 2: Place Assets

Copy all screenshots and audio files into the `assets/` subdirectory (as shown in setup).

### Step 3: Re-validate

```bash
npx hyperframes check
```

Should now show all assets found.

### Step 4: Render

```bash
npx hyperframes render --output brag.mp4
```

**Expected output:**
```
🎬 Rendering BookMyMeet Brag Video...
🎨 Composing 7 scenes (18 seconds)...
🔊 Mixing audio layers (music + SFX)...
🎞️  Writing frames (540 @ 30fps)...
✓ Render complete: brag.mp4 (1920x1080, 18s)
```

**Rendering time:** ~2–5 minutes on a modern machine.

### Step 5: Extract Poster Frame

```bash
npx hyperframes extract-frame --input brag.mp4 --time 7500 --output brag.jpg
```

(Extract frame at 7.5s — the hook moment with the profile page visible)

**Or manually:** Use ffmpeg to extract frame 225 (at 30fps, 7.5s = frame 225):
```bash
ffmpeg -i brag.mp4 -vf "select=eq(n\,225)" -q:v 3 brag.jpg
```

### Step 6: Bake Poster as Frame 0

```bash
npx hyperframes bake-poster --input brag.mp4 --poster brag.jpg --output brag-final.mp4
```

Final video now has poster frame baked in (visible as thumbnail before play).

## Output

Final artifacts:
- **`brag.mp4`** (18s, 1920×1080, H.264) — Video with poster baked as frame 0
- **`brag.jpg`** (1920×1080) — Poster frame (extracted separately for social)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Asset not found | Verify path in `composition.json` matches actual file location |
| Animation looks wrong | Check `delay` values are < `duration` of preceding scene |
| Audio out of sync | Ensure music and SFX tracks are exactly 18000ms (18s) |
| Text unreadable | Increase `fontSize` in composition.json (minimum 32px for most screens) |
| Render fails | Ensure Hyperframes CLI is up to date: `npm install -g @hyperframes/cli@latest` |

## Tips

1. **Test with placeholder assets first:** Use solid-color PNGs for screenshots and silent MP3s for audio to validate composition logic before final render.
2. **Preview in browser:** Some Hyperframes CLI versions support `--preview` to preview composition in browser before rendering.
3. **Music syncing:** If music cues are off, edit `composition.json` `audio.music.cues[]` to match actual beat positions.
4. **Font fallback:** `fontFamily: "sans-serif"` will use system default; specify exact font names for consistency.

## Next Steps

After render:
1. Share `brag.mp4` on Twitter, LinkedIn, and other platforms.
2. Use `share-copy.txt` (generated in parent brag-output directory) for post captions.
3. Monitor engagement and iterate (tone, pacing, music).

---

**Questions?** Refer to `../brag-plan.md` for creative intent and `../composition-brief.md` for detailed specs.
