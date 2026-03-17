# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Bro Please Pay" is an AI-powered bill-splitting app for the Indian market. Users photograph a restaurant bill, Gemini Vision parses it into line items, friends claim what they ate, and the app generates a UPI deep link for instant payment. Also includes social features: friendships, real-time DM chat, gamified "aura" scoring, payment auditing, and AI roasts.

## Development Commands

### Backend (FastAPI)
```bash
cd backend
venv/bin/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend (Next.js 14)
```bash
cd frontend
NODE_ENV=development npm install   # First run: installs devDeps (tailwindcss, postcss, autoprefixer)
NODE_ENV=development npm run dev   # Development server on :3000
npm run build                      # Production build
npm run lint                       # TypeScript + ESLint checks
```

### Health Checks
```bash
curl http://localhost:8000/health
curl http://localhost:8000/
```

### Windows/Bash Gotchas
- `venv\Scripts\activate` does not work in bash — use `venv/bin/python.exe` directly.
- `NODE_ENV=development` is **required** for both `npm install` and `npm run dev`, otherwise npm skips devDependencies and tailwindcss will be missing (causes `Unexpected character '@'` parse error).
- `next dev -H 0.0.0.0` for mobile testing on local network.

### Known TypeScript Issues
- `tsconfig.json` does not set `downlevelIteration`, so `[...map.values()]` and `[...set]` trigger TS2802 errors. These are pre-existing and do not block `npm run build` (Next.js compiles them fine). Fix by adding `"downlevelIteration": true` to `compilerOptions` if needed.
- Some `setRecentBills` calls in `home/page.tsx` have missing `host_id` in the object literal — benign at runtime but flags TS2345.

## Architecture

### Data Flow
```
User uploads bill image
  → POST /api/parse-bill (backend, Gemini 2.5 Flash REST, requires JWT auth)
  → Host edits items in inline editor (host/page.tsx)
  → "Create Party Room" → POST /api/bills/save (Supabase, requires JWT auth)
  → Host shares URL /bill/{uuid} via WhatsApp
  → Friend opens link → GET /api/bills/{uuid} (public, no auth needed)
  → Friend taps items to claim → dual-track persistence (localStorage + Supabase)
  → Proportional tax split → UPI deep link payment
```

### Security Architecture
- **Backend JWT auth**: `backend/auth.py` provides `get_current_user` FastAPI dependency. Decodes Supabase JWT from `Authorization: Bearer <token>` header. Verifies signature if `SUPABASE_JWT_SECRET` env var is set.
- **Rate limiting**: `slowapi` on `/api/parse-bill` (5 req/min per IP). Configured in `backend/rate_limit.py`.
- **Input validation**: Pydantic `Field(ge=1)` constraints on BillItem, 10MB file size limit, image magic-byte validation (JPEG/PNG/GIF/WebP).
- **CORS**: Backend whitelists `FRONTEND_URL` + localhost variants. Configured in `backend/main.py`.
- **Frontend auth**: `frontend/middleware.ts` refreshes Supabase session cookies on every request. Route protection is client-side in each page's `useEffect`.
- **Frontend auth headers**: `authHeaders()` in `frontend/lib/supabase.ts` grabs the current session token and returns `Authorization: Bearer <token>`. Must be included in all fetch calls to protected backend routes.

### Custom HTTP Clients (no SDKs)
Backend uses raw `httpx` for all external calls — no `google-generativeai` or `supabase` Python SDKs:
- **`SimpleGeminiClient`** in `backend/main.py`: base64 image → Gemini REST with exponential backoff for 429s.
- **`SimpleSupabaseClient`** in `backend/main.py`: query-builder pattern (`.select()`, `.eq()`, `.in_()`, `.insert()`, `.delete()`).

Frontend uses the official `@supabase/supabase-js` client (`frontend/lib/supabase.ts`).

### Key Design Patterns

**Claims — dual-track (local + Supabase + Broadcast):**
- Local state + localStorage for instant UX
- Supabase `claims` table writes when authenticated — triggers `update_claim_shares` and `auto_add_participant`
- Supabase Realtime Broadcast (`bill_claims_{billId}`) for cross-browser real-time locking
- `allClaims: Map<itemId, {userId, username}[]>` updated from both DB (on load) and Broadcast (live)

**Pizza Slider (fractional claims):** Single-quantity items show a 10-100% slider. `share_fraction` stored in claims table (NUMERIC(3,2) DEFAULT 1.0). DB trigger `update_claim_shares` auto-splits fractions equally.

**Real-time sync:** `postgres_changes` channel subscribes to participants, claims, payments tables. Broadcast for ephemeral claim updates.

**Presence:** `sessionId` initialized synchronously via IIFE (NOT in useEffect) — must be stable before Realtime channel opens.

**Auth guard with returnTo:** `/bill/[id]` redirects to `/?returnTo=/bill/{id}` if unauthenticated. Login → onboard → redirect chain preserves the return URL.

**Bill page Server/Client split:** `app/bill/[id]/page.tsx` is a Server Component that exports `generateMetadata()` for WhatsApp OG previews. It renders `BillRoom.tsx` (the `'use client'` component with all bill logic).

**Host self-payment guard:** `isHost` check prevents host from seeing pay/audit buttons on their own bill.

**Anti-dodge system:** Participants can "Request to Leave" (sets `leave_requested = true`); the host must approve or deny.

**Payment audit:** Host can verify payments (payment_status: 'unpaid' → 'pending_audit' → 'cleared'). "Low Taper Fade" themed payment buttons.

**AI Roast:** Gemini generates a Gen Z roast of the order during bill parsing. Stored in `bills.ai_roast` column.

**UPI deep link:** Manual URL string concatenation (no URLSearchParams — avoids `@` → `%40` encoding). Mobile uses native `<a href={upiUrl}>`, desktop shows QR modal via `qrcode.react`.

**Proportional tax:** `taxShare = (tax + serviceCharge) * (mySubtotal / billTotal)` in `lib/calculations.ts`.

## Environment Variables

**Backend** (`backend/.env`, see `backend/.env.example`):
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET          # Optional in dev; find in Supabase > Settings > API > JWT Secret
GEMINI_API_KEY
HOST, PORT, FRONTEND_URL
```

**Frontend** (`frontend/.env.local`, see `frontend/.env.example`):
```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The host page falls back to `http://127.0.0.1:8000` if `NEXT_PUBLIC_API_URL` is unset. Backend CORS allows `FRONTEND_URL` + localhost:3000/3001/3002.

## Database Schema

Eight tables in Supabase (`supabase/schema.sql` + migrations in `supabase/migrations/`):

| Table | Purpose |
|---|---|
| `users` | Profile extending `auth.users`: `username`, `upi_vpa`, `vibe` |
| `bills` | Bill header: `host_id`, `restaurant_name`, `tax_amount`, `service_charge`, `status`, `ai_roast` |
| `bill_items` | Line items: `name`, `quantity`, `total_price`, linked to a bill |
| `participants` | Junction: which users are in which bill. Has `leave_requested`, `payment_status` |
| `claims` | Which user claimed which item; `share_fraction` auto-set by trigger |
| `friendships` | Social graph: `user_id_1`, `user_id_2`, `status` ('pending'/'accepted') |
| `messages` | DM chat: `sender_id`, `receiver_id`, `content`, `audio_url`, `created_at` |
| `payments` | Payment records: `payer_id`, `receiver_id`, `bill_id`, `amount_paid` |

All tables have RLS enabled. Backend uses service role key (bypasses RLS); frontend uses anon key (respects RLS). DB triggers: `update_claim_shares` (auto-splits fractions) and `auto_add_participant` (adds to participants on first claim).

Migrations must be run manually in the Supabase SQL Editor in order: 002 → 003 → 004 → 005 → 006 → 007 → 008.

## Frontend Page Structure

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Login (email/password) with `?returnTo=` support |
| `/onboard` | `app/onboard/page.tsx` | Scan UPI QR → save profile (honors `?returnTo=`) |
| `/home` | `app/home/page.tsx` | Dashboard: monthly spend, bill grid, friends, edit profile modal |
| `/host` | `app/host/page.tsx` | Upload bill → AI parse → edit items → pick friends → create room → share |
| `/join` | `app/join/page.tsx` | Enter bill code → redirect to bill page |
| `/bill/[id]` | `app/bill/[id]/page.tsx` + `BillRoom.tsx` | Server wrapper (metadata) + Client component (claims, payments, UPI) |
| `/friends` | `app/friends/page.tsx` | Search users, friend requests, roster. Desktop: split-screen with inline chat |
| `/chat/[friendId]` | `app/chat/[friendId]/page.tsx` | Full-page 1:1 DM (mobile fallback) |
| `/analytics` | `app/analytics/page.tsx` | Spending insights: total spent, monthly chart, top restaurants, top co-diners |

### Error Boundaries
Each major route has `error.tsx` (crash recovery with retry button) and `loading.tsx` (spinner). Located alongside each route's `page.tsx`.

### Shared Components (`app/components/`)
- **`NavBar.tsx`**: Bottom bar on mobile, left sidebar on `md:+`. Hidden on auth/onboard/bill/chat routes.
- **`MainContent.tsx`**: Layout wrapper applying sidebar margin only when NavBar is visible.
- **`ChatPanel.tsx`**: Reusable chat component (messages, Realtime, send/receive) used inline on desktop friends page.

## Backend API Routes

`backend/routers/bills.py`:
- `POST /api/parse-bill` — **Auth required.** Image → Gemini → JSON. Rate limited (5/min). Does NOT save to DB.
- `POST /api/bills/save` — **Auth required.** Saves bill + items + host participant + friend participants to Supabase.
- `GET /api/bills/{bill_id}` — **Public.** Returns bill with items, claims (with usernames), host VPA/name, participants, payments, escape_requests.

`backend/routers/scan.py`:
- `POST /api/scan-qr` — **Auth required.** QR image → UPI VPA string.

## UI Conventions
- All pages use `'use client'` except `app/bill/[id]/page.tsx` (Server Component wrapper for metadata)
- Dark theme: `bg-zinc-950`, emerald-500 accents for money/success, red for destructive actions
- Icons: `lucide-react` exclusively (no emoji in UI). Use `CheckCircle2` not `CircleCheck`, `XCircle` not `CircleX`.
- No shadcn/radix installed — all dropdowns, modals, and dialogs are hand-rolled with React + Tailwind
- Gen Z slang used in copy: "aura", "crashout", "skibidi", "mogging", "low taper fade"
- `crypto.randomUUID` polyfill needed for older mobile browsers
- `navigator.clipboard` unavailable on HTTP — use `prompt()` fallback

## PWA
- `public/manifest.json` — app installable on mobile home screens
- Theme color: `#10b981` (emerald)
- Missing: actual icon files (`icon-192.png`, `icon-512.png`) need to be created

## Deployment
- Backend: Dockerfile with multi-stage build + `railway.toml` for Railway
- Frontend: `vercel.json` with security headers (HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)
