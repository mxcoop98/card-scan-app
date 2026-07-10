# Card Tracker — Handoff

Onboarding doc so any new session (Claude Code or human) can pick this up cleanly.
Written 2026-07-09.

## What it is

Personal Pokémon / sports-card tracking app. Backend is the durable product; the
Expo front end is a deliberately thin client. Backend is a Node/Express + Postgres
REST API. Front end is Expo Router (SDK 57) targeting web first (`expo start --web`),
App Store later — same codebase.

Aspirational feature set is CollX-shaped: scan a card, get its value, track your
portfolio, list for sale. Fees / marketplace decision: **do not build a marketplace**.
We're the seller's cockpit that pushes to eBay via their Sell API (phase 2).

## Repo layout

```
card-scan-app/
├── src/                     # Backend (Node/Express + Postgres)
│   ├── server.js            # All REST endpoints
│   ├── db.js                # pg pool (auto-SSL for Railway)
│   ├── migrate.js           # Applies schema.sql on boot (idempotent)
│   ├── pricing.js           # Pricing provider abstraction (PokemonTCG.io v1)
│   ├── recognition.js       # Recognition provider abstraction (hint search v1)
│   ├── grading.js           # ROI engine (pure function)
│   ├── bundling.js          # Bundle-suggestion engine (pure function)
│   └── refresh-all.js       # Daily price snapshot job (Railway cron)
├── schema.sql               # cards, price_history, listings, grading_*, listing_cards
├── docker-compose.yml       # Local Postgres 16
├── Dockerfile               # Railway deploy image
├── .env.example             # DATABASE_URL + POKEMONTCG_API_KEY + TLS bypass
├── mobile/                  # Expo (React Native + Web)
│   ├── app.json             # SDK 57, expo-router, reactCompiler DISABLED
│   ├── src/
│   │   ├── app/             # Route tree (file-based)
│   │   │   ├── _layout.tsx  # Stack + bottom tab bar
│   │   │   ├── index.tsx    # Cards grid (My Collection)
│   │   │   ├── cards/new.tsx
│   │   │   ├── cards/[id]/index.tsx    # Detail
│   │   │   ├── cards/[id]/grading.tsx  # Grading analysis
│   │   │   ├── bundles.tsx
│   │   │   ├── listings.tsx
│   │   │   ├── listings/[id].tsx        # Detail + mark-sold form
│   │   │   ├── portfolio.tsx            # Total value + sparkline
│   │   │   └── scan.tsx                 # Photo capture + hint search
│   │   ├── components/
│   │   │   ├── bottom-tab-bar.tsx       # Custom 5-tab bar
│   │   │   └── sparkline.tsx            # SVG line chart
│   │   └── lib/
│   │       ├── api.ts                   # Typed fetch wrapper for the backend
│   │       └── confirm.ts               # Cross-platform confirm() (web uses window.confirm)
```

Memory index for this project lives at
`~/.claude/projects/C--Windows-system32/memory/project_card_tracker.md` and related
`feedback_*` files.

## Local dev — first time on a new machine

Prereqs: Docker Desktop, Node 22, git.

```bash
git clone git@github.com:mxcoop98/card-scan-app.git
cd card-scan-app

# --- Backend ---
cp .env.example .env
# On networks that TLS-intercept HTTPS (bank, some VPNs), append:
#   NODE_TLS_REJECT_UNAUTHORIZED=0
# to .env, and create .npmrc with:
#   strict-ssl=false
# Both are local-only, gitignored, NEVER ship to Railway.

docker compose up -d              # Postgres on :5432
npm install
node src/server.js                # migrations run on boot; API on :3000

# --- Frontend (separate shell) ---
cd mobile
# same TLS workaround if needed: .npmrc with strict-ssl=false, .env with EXPO_PUBLIC_API_URL
cp .env.example .env
npm install
CI=1 npx expo start --web --port 8081
# open http://localhost:8081
```

If clicks fire but nothing navigates: something has replaced the layout with a wrapper
that swallows events. Our `_layout.tsx` uses a plain `Stack` + `BottomTabBar` — do NOT
switch back to the template's `expo-router/ui` `Tabs` + `CustomTabList`. And do NOT
re-enable `experiments.reactCompiler` in `app.json` — it's off for a reason (it broke
event-handler wiring).

## Ports

- 3000 — backend REST API
- 5432 — Postgres (Docker)
- 8081 — Expo web dev server (Metro)

## Endpoints (see server.js for exact shapes)

Cards: `GET /api/cards`, `GET /api/cards/:id`, `POST /api/cards`, `PATCH /api/cards/:id`,
`DELETE /api/cards/:id`, `POST /api/cards/:id/refresh-price`.

Grading: `GET /api/grading-services`, `POST /api/grading-services`,
`GET/POST /api/cards/:id/graded-estimates`, `DELETE /api/graded-estimates/:id`,
`GET/POST /api/cards/:id/grade-probabilities`, `DELETE /api/grade-probabilities/:id`,
`GET /api/cards/:id/grading-analysis`.

Bundles: `GET /api/bundle-suggestions?max_card_price&min_bundle_value&max_bundle_value&markup&group_by`.

Listings: `GET/POST /api/listings`, `GET /api/listings/:id`,
`POST /api/listings/:id/mark-sold`, `DELETE /api/listings/:id`.

Portfolio: `GET /api/portfolio/summary`, `GET /api/portfolio/timeseries`.

Scan: `POST /api/scan` — body `{category, hints:{name?, set_name?, card_number?}, image?}`,
returns `{candidates: [...]}`.

Variants: `GET /api/variants?category=pokemon&name=Charizard[&set_name=&card_number=]`
returns `{variants: [...]}` — every printing across sets for the parallel picker.

eBay: `GET /api/ebay/status`, `GET /api/ebay/authorize-url`,
`GET /api/ebay/callback` (redirect target, exchanges auth code for tokens),
`POST /api/listings/:id/publish-ebay` (v1: single-card only).

Health: `GET /health`.

## eBay integration setup

**Blocked on: eBay Developer Program approval** (~24h after signup).

Once approved:

1. In eBay Developer Console → create an app, get the **Sandbox** keyset
   (App ID / Cert ID / RuName). Add these to backend `.env`:
   ```
   EBAY_ENV=sandbox
   EBAY_CLIENT_ID=<App ID>
   EBAY_CLIENT_SECRET=<Cert ID>
   EBAY_REDIRECT_URI=http://localhost:3000/api/ebay/callback
   ```
2. In Developer Console → your app → User Tokens → set your Auth Accepted URL to the
   same `http://localhost:3000/api/ebay/callback`.
3. Restart the backend (`node src/server.js`).
4. Open the app → Portfolio → "Settings & integrations ›" → "Connect eBay". Sign in
   with a **sandbox test user** (create one at developer.ebay.com → Sandbox → Test users).
5. Back in the app, "Connected: Yes" should show. Access token expires in 2 hours,
   refresh token in 18 months; refresh is automatic.
6. On a draft listing (single card, ask_price set) → "Publish to eBay". If it succeeds
   the listing detail page shows an "Open in eBay" link to the sandbox listing.

If publish fails, the most common reasons are missing seller policies. Get the IDs
from the eBay Sell Account API and add to `.env`:
```
EBAY_FULFILLMENT_POLICY_ID=
EBAY_PAYMENT_POLICY_ID=
EBAY_RETURN_POLICY_ID=
EBAY_MERCHANT_LOCATION_KEY=default
```

## What's built vs not

**Done:**
- Backend REST API (all endpoints above), migrations, seed data (18 test cards with real images).
- Frontend: cards grid, card detail (big image + big price + comps table), add card, grading
  analysis screen, bundles, listings + mark-sold, portfolio + sparkline, scan (v1 hint search).
- Bottom tab bar (Cards / Bundles / Scan / Listings / Portfolio).
- Custom lib/confirm.ts because `Alert.alert` is a no-op on web.
- Portfolio timeseries (daily portfolio USD value from price_history).
- Pricing provider auto-backfills `image_url` + `external_ids` on price fetch.

**Not built (roadmap):**
1. **Image-based recognition** — `recognition.js` has the abstraction; v1 is hint search.
   Wire Ximilar `/v2/tcg_id` or Google Vision as a new provider when we're ready to pay.
2. **eBay integration — v1 shipped 2026-07-09** (OAuth, publish single-card, view URL).
   Still todo: multi-card lot listings, seller policy discovery, order polling for auto
   mark-sold, real category/aspect mapping, production-mode HTTPS setup.
3. **Sports pricing** — no clean official API. Candidates: eBay sold-listings, Card Ladder,
   SportsCardsPro, PSA Auction Prices Realized. Do NOT hallucinate one — present tradeoffs.
4. **Sports variant discovery** — the `/api/variants` endpoint returns empty for sports
   because we don't have a sports card DB. Same fix as sports pricing.
5. **PSA API for grading** — auto-populate graded price estimates + Pop Report probabilities.
6. **Front + back card images**, **grade pill selector** (RAW/PSA/BGS/SGC filters comps),
   proper vector tab icons, animations.
7. **Native camera** for /scan (currently web file-input only).

## Gotchas we've hit (so you don't waste a session on them)

- **TLS interception** on some networks breaks `npm install` and Node's `fetch`. Fix is
  `.npmrc` with `strict-ssl=false` + `.env` with `NODE_TLS_REJECT_UNAUTHORIZED=0`. Local-dev only.
- **React Compiler** (`experiments.reactCompiler`) was breaking `onPress` handler wiring on web.
  It's off in `app.json`. Don't turn it back on without testing.
- **`AnimatedSplashOverlay`** from the Expo default template ate every click on web (`zIndex: 1000`,
  fade-out relies on a reanimated worklet callback that doesn't fire). Removed from `_layout.tsx`.
- **Expo default template's `Tabs` + `CustomTabList`** (from `expo-router/ui`) also swallowed
  clicks. Replaced with plain `Stack` + our custom `BottomTabBar`.
- **`[name, setName]` + `[setName, setSet]` collision** — I've made this mistake twice.
  When writing a form field for a Pokémon card's set name, use `[name, setCardName]`
  instead so `setName` is free for the field-value state.
- **PokemonTCG.io** returns 404 under sustained unauthenticated load. Get a free key and
  put it in `.env` as `POKEMONTCG_API_KEY` for less flakiness.
- **`node_modules`** is 700+MB. Don't commit. Already in `.gitignore`.

## Architecture decisions (do not second-guess)

- Backend is the durable product. Front end is a thin client. All logic lives server-side
  behind REST. UI is swappable.
- Expo web-first for validation, App Store later. Same codebase. Not a rewrite.
- Hosting: **Railway** (already paid). Not Cloud Startup, not AWS.
- Database: **Postgres**, staying Postgres.
- Recognition and pricing use the same provider-registry pattern. Every future data
  source (eBay sold, PSA Pop, Ximilar, Google Vision) drops in as a function without
  changing the API surface.
- Railway cron minimum is 5 minutes, UTC-only, skips run if previous still active.
  Fine for the daily `refresh-all.js` snapshot; avoid sub-5-minute schedules.
