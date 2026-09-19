# brag.mp4 build

`python build.py` renders `../brag.mp4` (18.6s, 1920x1080, H.264, no audio) and `../brag.jpg`
(poster) from the screenshots in `assets/screenshots/`. Needs Pillow and ffmpeg on PATH.

The screenshots are the real app running locally (backend + Vite with
`VITE_API_URL=http://localhost:8000/api`) against a temporary demo admin, "Riya Kapoor"
(`/riyakapoor`), created through the API and permanently deleted afterwards. Nothing ran
against production.

To re-shoot: seed a demo admin (name, title, bio, working hours, three sessions, a Razorpay
test key), capture the profile, the slot picker, checkout and `/admin/setup` at 1920x1080,
then delete the admin with `permanently_delete_admin`. Don't run
`scripts/cleanup_demo_data.py --delete` for this: it also removes every orphaned row in the
database, not just the demo account.
