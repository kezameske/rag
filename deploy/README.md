# Deploy: rag.jungholee.com via Cloudflare Tunnel

Self-hosted on any always-on machine (mini PC, old laptop, home server). No public
IP, no open ports — Cloudflare Tunnel carries traffic privately to three local
containers: `backend` (FastAPI), `web` (Caddy serving the SPA + proxying `/api`),
and `cloudflared` (the tunnel).

```
Browser → https://rag.jungholee.com → Cloudflare edge (TLS + Access)
        → Tunnel → cloudflared → web:8080 ─┬─ /       → built SPA
                                            └─ /api/*  → backend:8000  (/api stripped)
```

## Prerequisites
- An always-on machine with **Docker** + **Docker Compose**.
- `jungholee.com` managed on **Cloudflare DNS** (free plan is fine).
- The Supabase project with all migrations applied (including the two new Phase 1
  migrations under `supabase/migrations/2026062300000*`).

## One-time setup

### 1. Get the code on the machine
```bash
git clone https://github.com/kezameske/rag.git
cd rag
```

### 2. Backend secrets — `backend/.env`
Copy `backend/.env.example` → `backend/.env` and fill in (Supabase → Project
Settings → API):
```
SUPABASE_URL=https://dkbbhbpluvtimzzyavyg.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SETTINGS_ENCRYPTION_KEY=<Fernet key>          # reuse the existing one if global_settings already holds encrypted keys
LANGSMITH_API_KEY=                            # optional
LANGSMITH_PROJECT=rag-masterclass
CORS_ORIGINS=["https://rag.jungholee.com"]
```
> If you don't have an encryption key yet, generate one:
> `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
> Reusing the *same* key matters only if `global_settings` already stores
> encrypted API keys from another environment; otherwise a fresh key is fine and
> you'll enter provider keys in the app afterward.

### 3. Create the Cloudflare Tunnel
Cloudflare **Zero Trust** dashboard → **Networks → Tunnels → Create a tunnel** →
**Cloudflared** → name it (e.g. `rag`):
- Copy the **connector token** (the long string after `--token`).
- Add a **Public Hostname**: subdomain `rag`, domain `jungholee.com`, type
  **HTTP**, URL **`web:8080`**. Save.

This auto-creates the `rag.jungholee.com` DNS record.

### 4. Compose env — `.env`
Copy `.env.example` → `.env` and fill in:
```
TUNNEL_TOKEN=<token from step 3>
VITE_SUPABASE_URL=https://dkbbhbpluvtimzzyavyg.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_API_URL=https://rag.jungholee.com/api
```

### 5. (Strongly recommended) Gate it with Cloudflare Access
Until the Phase 0 auth fix lands, the backend trusts unverified JWTs. Lock the app
to your identity: Zero Trust → **Access → Applications → Add → Self-hosted** →
`rag.jungholee.com` → policy **Allow** your email. Free up to 50 users.

### 6. Apply database migrations
Apply any unapplied SQL in `supabase/migrations/` to the Supabase project (SQL
editor or `supabase db push`). The two Phase 1 migrations add the HNSW vector
index and the `status='completed'` filter — read the index migration's header
note first (all embeddings must be 1536-dim).

## Launch
```bash
docker compose up -d --build
docker compose logs -f          # watch startup
```
Visit **https://rag.jungholee.com**.

## First-run app config
1. **Sign up** at the site.
2. In Supabase, edit your row in `user_profiles`: set `is_approved = true` and
   `is_admin = true` (the app gates unapproved users, and Settings is admin-only).
3. In the app **Settings**, configure providers:
   - **LLM** → OpenRouter: base URL `https://openrouter.ai/api/v1`, a vision-capable
     model id, your OpenRouter key.
   - **Embeddings** → e.g. OpenAI `text-embedding-3-small`, dimensions `1536`, key.

## Updating
```bash
git pull
docker compose up -d --build
```

## Notes
- The machine must stay on for the site to be reachable (that's the tradeoff for $0 hosting).
- Cloudflare has a ~100s timeout per request; SSE chat keeps data flowing so streams stay open.
- Single backend worker by design — ingestion runs as in-process background tasks.
