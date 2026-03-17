# Bro Please Pay

AI-powered bill splitting for friend groups in India. Snap a restaurant bill, let Gemini parse it, claim what you ate, and pay the host instantly via UPI.

**Live:** [bill-splitter-4cmi.vercel.app](https://bill-splitter-4cmi.vercel.app)

## Features

### Core
- **AI Bill Parsing** — Upload a bill photo, Gemini 2.5 Flash extracts every line item
- **Real-Time Claiming** — Tap items to claim them, see friends' avatars appear live via WebSockets
- **Pizza Slider** — Shared items get a fractional claim slider (10–100%)
- **Proportional Tax Split** — Tax and service charges distributed by what you ordered
- **Instant UPI Payment** — One-tap deep link to GPay/PhonePe/Paytm, QR code on desktop
- **Smart QR Onboarding** — Scan your UPI QR once, never type your VPA again

### Social
- **Friends & Chat** — Add friends, real-time DM with text and voice messages
- **Squads** — Create groups, track inter-squad debts with a running ledger
- **Analytics** — Monthly spend charts, top restaurants, most frequent co-diners

### Gamification
- **Aura System** — Earn or lose aura points based on payment behavior (fast pay = +aura, dodge = -aura)
- **AI Roast** — Gemini generates a Gen Z roast of the group's order
- **Beg for Mercy** — Micro-debts under ₹50 can be forgiven via text or voice apology
- **The Snitch Protocol** — After 5+ days unpaid, escalate to the dodger's emergency contact

### Host Controls
- **Payment Audit** — Verify payments: unpaid → pending → cleared
- **Anti-Dodge** — Participants must request to leave; host approves or denies
- **Nudge** — Ping unpaid friends directly

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.12, httpx (no SDKs) |
| AI | Google Gemini 2.5 Flash (Vision + Text) |
| Database | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Payments | UPI deep links (manual URL construction) |
| Infra | Railway (backend), Vercel (frontend), Docker |

## Project Structure

```
├── backend/
│   ├── main.py              # FastAPI app, Gemini client, Supabase client
│   ├── auth.py              # JWT verification (Supabase tokens)
│   ├── rate_limit.py        # slowapi rate limiting
│   ├── Dockerfile           # Multi-stage production build
│   ├── railway.toml         # Railway deployment config
│   └── routers/
│       ├── bills.py         # Bill CRUD + AI parsing
│       ├── scan.py          # QR code → UPI VPA extraction
│       ├── aura.py          # Aura score tracking
│       └── squads.py        # Squad management + ledger
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Login with ?returnTo= support
│   │   ├── onboard/         # QR-based UPI onboarding
│   │   ├── home/            # Dashboard, bill grid, profile
│   │   ├── host/            # Upload → AI parse → create room
│   │   ├── bill/[id]/       # Server Component (OG meta) + BillRoom client
│   │   ├── friends/         # Friend list, requests, inline chat
│   │   ├── chat/[friendId]/ # Full-page DM (mobile)
│   │   ├── analytics/       # Spending insights + charts
│   │   ├── squads/          # Squad list + detail pages
│   │   └── components/      # NavBar, MainContent, ChatPanel
│   ├── lib/
│   │   ├── supabase.ts      # Client + auth headers + API_URL
│   │   ├── calculations.ts  # Tax split math
│   │   └── upi.ts           # UPI deep link builder
│   └── middleware.ts         # Session refresh on every request
├── supabase/
│   ├── schema.sql           # Base schema with RLS
│   └── migrations/          # Incremental migrations (002–016)
├── k8s/                     # Kubernetes manifests (Deployment, Service, HPA)
├── .github/workflows/
│   └── deploy.yml           # CI: lint, build, Docker validation
└── docker-compose.yml       # Local dev
```

## Quick Start

### Prerequisites
- Node.js 20+, Python 3.12+
- [Supabase](https://supabase.com) project
- [Gemini API key](https://aistudio.google.com/apikey)

### Backend

```bash
cd backend
python -m venv venv
pip install -r requirements.txt

cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#          GEMINI_API_KEY, FRONTEND_URL

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install

cp .env.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#          NEXT_PUBLIC_API_URL=http://localhost:8000

npm run dev
```

### Database

1. Run `supabase/schema.sql` in the Supabase SQL Editor
2. Run migrations in order: `002` through `016`
3. Enable Realtime replication for: `bills`, `bill_items`, `participants`, `claims`, `messages`, `payments`

## Deployment

- **Backend** → [Railway](https://railway.app) — auto-deploys from `main` via Dockerfile
- **Frontend** → [Vercel](https://vercel.com) — auto-deploys from `main`, root directory set to `frontend`
- **CI/CD** → GitHub Actions validates lint, build, and Docker on every push/PR

### Environment Variables

**Railway (backend):**
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `GEMINI_API_KEY`, `FRONTEND_URL`

**Vercel (frontend):**
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`

## Architecture Highlights

- **No SDKs on backend** — Custom `SimpleGeminiClient` and `SimpleSupabaseClient` using raw httpx. Zero heavy dependencies.
- **Dual-track claims** — localStorage (instant UX) + Supabase writes (persistence) + Realtime Broadcast (cross-browser sync)
- **Server/Client split** — Bill page uses a Server Component for WhatsApp OG previews, renders a Client Component for interactivity
- **UPI deep links** — Manual string concatenation instead of URLSearchParams (avoids `@` → `%40` encoding)
- **Proportional tax** — `taxShare = (tax + serviceCharge) × (mySubtotal / billTotal)`

## License

MIT
