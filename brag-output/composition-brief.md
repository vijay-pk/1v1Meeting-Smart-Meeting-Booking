# BookMyMeet Brag Video — Hyperframes Composition Brief

## Video Specification

- **Duration:** 18 seconds (target)
- **Format:** Landscape 16:9 (1920×1080)
- **Frame Rate:** 30fps
- **Audio:** Instrumental upbeat track (110–120 BPM) + SFX layers
- **Tone:** Playful, clean, direct. Deadpan undertone (contrast problem → solution).

---

## Scene Breakdown & Composition Specs

### Scene 1: The Problem (0–2s)
**Narrative:** "Your booking page journey, usually:"

**Composition Structure:**
- **Layout:** Dark theme, scattered overlays on subtle gray background
- **Elements:**
  - Email icon + "50 DMs about availability"
  - Calendly logo (blurred/faded, low opacity)
  - Stripe dashboard (partial screenshot, desaturated)
  - Clock icon with "X reschedules"
  - Confused/frustrated emoji (sad face)
- **Animation:**
  - Each element fades in with a quick bounce (150ms) and slight rotation
  - Total: 3–4 elements scattered randomly, none aligned
  - Exits via fast zoom-out to black
- **Text:**
  - Single line, centered, sans-serif, white, size 48px
  - Fade in at 0.2s, hold, fade out at 1.8s
- **SFX Layer:** Tension whoosh, subtle discordant tone
- **Transition:** Zoom-out to black (0.3s easing)

**Color Palette:** Grays (#333–#666), white text, desaturated accent colors (red tint for frustration)

---

### Scene 2: The Hook (2–5s)
**Narrative:** "Meet BookMyMeet." + Profile reveal

**Composition Structure:**
- **Background:** Gradient (bottom: brand primary blue, top: light white fade)
- **Main Visual:** BookMyMeet creator profile page (SuperProfileHomePage screenshot/mock)
  - Intro video thumbnail with play button (glowing, semi-transparent overlay)
  - Creator name (e.g., "Alex Rivera"), title, theme color applied
  - Tagline text (e.g., "1-to-1 Mentor Sessions")
  - Session card preview (visible, not full list)
- **Animation:**
  - Profile slides in from left (400ms ease-out)
  - Elements cascade: video → name → title → session card (staggered, 200ms apart)
  - Slight parallax: video stays back, cards move forward
- **Text:**
  - "Meet BookMyMeet" — 64px, bold, white, center-screen, fade in at 2.2s
  - Duration: 0.8s hold, then fade under next scene
- **SFX Layer:** Soft notification chime, uplifting music enters and builds
- **Transition:** Fade to next scene with a smooth parallax effect (0.3s)

**Color Palette:** Gradient primary (theme color from BookMyMeet), white accents, clean shadows

---

### Scene 3a: Session Selection (5–6s)
**Narrative:** "Pick a session"

**Composition Structure:**
- **Main Visual:** TimeAvailabilityPage screenshot — session cards grid (show 2–3 sessions)
  - One card highlighted/glowing to indicate selection
  - Pricing visible (e.g., "₹2,499 / 30 min")
  - Button state: hover or pressed
- **Animation:**
  - Fade in smoothly
  - Selected card grows slightly (105%) with a glow effect (shadow expansion)
  - Button pulses once (soft glow)
- **Text Overlay:** "Pick a session" — 40px, white, bottom-right corner, appears at 5.2s, holds 0.8s
- **SFX Layer:** Soft glass plink (selection sound)
- **Transition:** Quick fade (150ms)

**Color Palette:** Light background, theme-colored session cards, glowing accent

---

### Scene 3b: Calendar & Time Selection (6–7.5s)
**Narrative:** "Pick a time"

**Composition Structure:**
- **Main Visual:** Calendar grid (TimeAvailabilityPage, availability view)
  - Available slots shown in theme color
  - Booked/unavailable grayed out
  - One slot highlighted (clicked/selected)
- **Floating Badge:** Date + time display (e.g., "Sept 21 at 2:30 PM") fades in and hovers top-right
- **Animation:**
  - Calendar slides in from right (400ms)
  - Available slots pulse gently (opacity 0.8 → 1.0, loop 2x)
  - Selected slot grows and glows (120% scale, 0.5s)
  - Date badge appears and scales from small to full size (300ms ease-out)
- **Text Overlay:** "Pick a time" — 40px, white, bottom-right, appears at 6.2s
- **SFX Layer:** Soft whoosh for calendar entry, click sound for slot selection
- **Transition:** Snap to next scene (100ms)

**Color Palette:** Light calendar background, theme-colored available slots, white text

---

### Scene 3c: Payment Checkout (7.5–9s)
**Narrative:** "Pay directly to the creator"

**Composition Structure:**
- **Main Visual:** Payment checkout page (PaymentCheckoutPage)
  - Creator photo/avatar (small, top-left of card)
  - "Direct Payment to [Creator Name]" text
  - Razorpay modal overlay (partial, visible but not blocking the behind-card)
  - Creator branding badge visible
- **Animation:**
  - Payment card slides in from bottom (300ms ease-out)
  - Creator photo scales in and adds a subtle shadow
  - Razorpay modal fades in over the card (150ms, slight delay)
  - Amount displays with a quick scale-up (e.g., "₹2,499")
- **Text Overlay:** "Pay directly to the creator" — 40px, white, bottom-left, appears at 7.7s
- **SFX Layer:** Swipe sound for card entry, subtle interface beep for modal appearance
- **Transition:** Fade (150ms)

**Color Palette:** White card, theme-colored elements, Razorpay brand blue accents (muted)

---

### Scene 3d: Admin Dashboard Notification (9–10s)
**Narrative:** "Live in their dashboard"

**Composition Structure:**
- **Split Layout (optional):** Left side shows payment, right side shows admin dashboard, or single dashboard takes full frame
- **Main Visual:** AdminDashboard or BookingsPage screenshot
  - New booking row/card appears mid-screen
  - Includes: Client name, time, booking status (✓ Confirmed), Meet link (visible)
  - Notification indicator (badge, "1 new booking")
- **Animation:**
  - Dashboard fades in (300ms)
  - New booking card slides in from right or scales from center (400ms ease-out)
  - Checkmark appears and grows (success animation, 200ms)
  - Notification badge pulses (2x, to draw attention)
- **Text Overlay:** "Live in their dashboard" — 40px, white, bottom-center, appears at 9.2s
- **SFX Layer:** Success chime (bright, musical note), notification ping
- **Transition:** Smooth fade to next scene

**Color Palette:** Light dashboard background, green accents for confirmation, white text

---

### Scene 4: The Money Moment (11–14s)
**Narrative:** "100% of revenue. Zero platform cut."

**Composition Structure:**
- **Main Visual:** Payment/dashboard card showing amount ₹X
  - Arrow or flow animation pointing to Razorpay account (icon or logo)
  - Multiple mini-scenes (3–4 quick bookings, staggered, showing cumulative ₹) to show scale
- **Animation:**
  - Amount display scales in and glows (150ms)
  - Arrow animates from booking to account (600ms ease-in-out)
  - Multiple bookings cascade in (one every 400ms), each with a brief ✓ checkmark
  - Final view shows total or running sum (animated counter, 1–2s)
- **Text Overlay (sequential):**
  - "100% of revenue" — 48px, bold, white, center, appears at 11.2s, holds 1s
  - "Zero platform cut" — 48px, bold, theme color (green or gold), center, appears at 12.2s, holds 1.2s
- **SFX Layer:** Cash register ding (light, playful, not heavy), satisfying tone, maybe a coin sound
- **Transition:** Emphatic cut to final scene

**Color Palette:** Green accents (revenue/profit), white text, Razorpay brand blue, maybe gold tint for "100%"

---

### Scene 5: The Closer (14–18s)
**Narrative:** Creator autonomy, CTA

**Composition Structure:**
- **Background:** Clean white or light gradient
- **Content (sequential text reveals):**
  - "Your vanity page." (↵)
  - "Your Razorpay account." (↵)
  - "Your rules." (↵)
  - [CTA Button] "Start Free"
- **Optional Visual Loop:** Quick cuts of 2–3 different creator pages (different themes, colors) flashing briefly (0.5–0.7s each) to show variety and customization
- **Animation:**
  - Each text line fades in, scales 90% → 100% (300ms ease-out), holds, then fades (400ms hold before next)
  - Creator pages loop (fade in/out, 1.5s per page)
  - CTA button appears at 16.5s, scales in with a subtle bounce (150ms), and glows
- **Text Styling:**
  - Lines 1–3: 40px, white on dark gradient or 40px dark on white, depends on background choice
  - CTA button: 32px, white text, theme-colored button (e.g., brand blue), rounded corners, shadow
- **SFX Layer:** Music peaks and resolves. No additional SFX; let the audio land clean.
- **Transition:** Fade to black or white (final frame holds 1s)

**Color Palette:** Minimal. White background with dark text, OR dark background with white text. Theme button color. Avoid clutter.

---

## Audio Layer Specifications

### Music Track
- **Tempo:** 110–120 BPM
- **Key:** Major (bright, hopeful)
- **Instrumentation:** Indie pop or lo-fi electronic. Drums (hi-hats, kick), melodic element (synth or guitar), bass line.
- **Structure:**
  - **Intro (0–2s):** Sparse, tension. Maybe just drums or ambient.
  - **Build (2–5s):** Main melody enters, energy lifts.
  - **Main (5–11s):** Full mix, hi-hat-driven energy. Peaks around 8–9s.
  - **Peak (11–14s):** Slight boost in drums, confident and bright.
  - **Resolution (14–18s):** Slight drop, warm finish. Holds final note.
- **Mix:** Bright, modern, no harsh frequencies. Clean and professional.

### Sound Effects Layer
- **0–2s:** Tension whoosh, discordant tone (very subtle)
- **2s:** Chime (notification, uplifting)
- **5–6s:** Glass plink (selection)
- **6–7.5s:** Whoosh (calendar entry), click (slot selection)
- **7.5–9s:** Swipe, beep (modal)
- **9–10s:** Success chime (bright), notification ping
- **11–14s:** Cash register ding (light), coin sound (optional)
- **14–18s:** None; music resolves alone

All SFX mixed at -6dB to -12dB relative to music (not competing, supporting).

---

## Production Notes

1. **Screenshot/Asset Sourcing:**
   - Use actual BookMyMeet product screenshots (SuperProfileHomePage, TimeAvailabilityPage, PaymentCheckoutPage, AdminDashboard).
   - If live screenshots unavailable, create mockups matching the Figma design and real data.
   - Ensure text on screenshots is readable at 1920×1080 (font sizes at least 16px on screen).

2. **Branding & Colors:**
   - Primary theme color: Infer from BookMyMeet brand (if defined) or use a clean blue/teal.
   - Secondary/accents: Green for success/revenue, white for clarity, dark grays for contrast.
   - Ensure WCAG AA contrast on all text.

3. **Timing & Sync:**
   - Match scene cuts to hi-hat hits or bass kicks where possible (especially 5–11s).
   - Text holds must be 0.8s minimum for readability.
   - Transitions 150–400ms (no jarring cuts unless intentional).

4. **Export & Frame 0:**
   - Render at 1920×1080, 30fps, H.264 codec.
   - Extract best poster frame (ideally scene 5, CTA visible, or scene 2 hook moment) and save as JPG.
   - Bake poster frame as frame 0 of MP4 (1–2 frame hold at video start).

5. **Quality Gates:**
   - Music and SFX mixed and balanced (no clipping, clear dialogue/text readability over audio).
   - Colors consistent across all scenes (no random brightness/saturation shifts).
   - No text typos or UI glitches visible in screenshots.
   - Video plays smoothly without stuttering or dropped frames.

---

## Delivery Artifacts

1. `brag.mp4` — Final rendered video with poster frame baked as frame 0 (18 seconds, 1920×1080, H.264)
2. `brag.jpg` — Poster frame (extracted from video, 1920×1080)
3. `share-copy.txt` — Copy for social media (Twitter, LinkedIn, etc.)

---

## Creative Reference

- **Energy:** Match the "casual confidence" of modern creator tools (Loom, Stripe for creators, etc.).
- **Pacing:** Fast enough to hold attention, slow enough to read every text card and understand the flow.
- **Emotion:** Relief + empowerment. "This is possible. This is easy."
- **Vibe:** Not aggressively salesy. Not corporate polish. Just clean, clear, and direct.

