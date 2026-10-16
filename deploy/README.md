# Deploying the backend to the Mumbai VPS

Moves **only the FastAPI backend** to a Hostinger VPS in Mumbai (`86.38.243.161`). Supabase
(database + storage) and Vercel (frontend) do not move. Mumbai backend + Mumbai database
removes the cross-Pacific query latency, and an always-on VPS removes the free-tier cold start.

Files in this folder:

- `docker-compose.prod.yml` — backend + Caddy (HTTPS), backend-only, `restart: always`.
- `Caddyfile` — automatic HTTPS for `api.adwaysacademy.com`, proxies to the backend.
- `.env.prod.example` — every environment variable the backend needs.

---

## 1. DNS

Add an **A record** for the API subdomain, pointing at the VPS:

```
api.adwaysacademy.com.  A  86.38.243.161
```

Wait until it resolves (`ping api.adwaysacademy.com` returns the VPS IP). Caddy cannot get a
TLS certificate until this is live.

## 2. Open the firewall

On the VPS (and in Hostinger's firewall panel) allow inbound **80** and **443**:

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

## 3. Install Docker (once)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # then log out and back in
```

## 4. Get the code and the env file

```bash
git clone <this-repo-url> bookmymeet && cd bookmymeet
cp deploy/.env.prod.example deploy/.env.prod
nano deploy/.env.prod            # fill EVERY value from the Render dashboard
```

Copy `ENCRYPTION_KEY` and `SECRET_KEY` **exactly** as they are on Render. Do not generate new
ones — see the warnings in `.env.prod.example`. Set `GOOGLE_REDIRECT_URI` to
`https://api.adwaysacademy.com/api/google/callback`.

## 5. Start it

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f backend   # watch it boot
```

Caddy fetches the TLS certificate on first start (needs step 1 done).

## 6. Verify the backend before switching traffic

```bash
curl -s https://api.adwaysacademy.com/health
```

Must report `"database":"postgresql"` and `"persistent_storage":true`. If it says `sqlite`,
`DATABASE_URL` is wrong — fix it before continuing.

Also confirm it is the same database as before (same admin id) without logging in:

```bash
curl -s https://api.adwaysacademy.com/api/profiles/public/midhunvijay
```

## 7. Point the frontend and Google at the new backend

1. **Vercel** → project env → `VITE_API_URL = https://api.adwaysacademy.com/api` → redeploy.
2. **Google Cloud Console** → OAuth client → Authorized redirect URIs → add
   `https://api.adwaysacademy.com/api/google/callback` (must match `GOOGLE_REDIRECT_URI`).
3. **Razorpay** webhook URL, if one is configured → new host.

`CORS_ALLOWED_ORIGINS` and `APP_URL` point at the frontend and stay as they are.

## 8. Confirm end-to-end, then you're done

- A booking page loads and slots appear (should be well under a second now).
- An admin logs in (proves `SECRET_KEY` carried over).
- An admin's Google/Razorpay still reads **connected** (proves `ENCRYPTION_KEY` carried over).

## Rollback

Point `VITE_API_URL` back at the Render host and redeploy Vercel. Keep Render running until
the VPS is confirmed.

## Updating later

```bash
cd bookmymeet && git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

(No auto-deploy-on-push on a plain VPS — run the two lines above after each merge, or wire a
GitHub webhook later.)

## Notes

- The backend runs its own reminder and meeting-termination loops continuously here (no sleep),
  so the external cron that Render's free tier needed is optional.
- `caddy_data` holds the issued certificate — keep that volume across restarts so Caddy does
  not re-request a cert every time (Let's Encrypt rate-limits).
