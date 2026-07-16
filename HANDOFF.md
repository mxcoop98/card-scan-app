# Card Tracker — Handoff

Onboarding doc so any new session (Claude Code or human) can pick this up cleanly.
Written 2026-07-09; updated 2026-07-14 (eBay singles published); 2026-07-15 (UI polish
+ grade pill selector); 2026-07-16 (multi-card lot publishing + idempotent recovery).

## Deployed state (as of 2026-07-16)

- **Backend live on Railway**: https://card-scan-app-production.up.railway.app
  - Postgres provisioned as sibling Railway service, wired via literal `DATABASE_URL`
    (not the `${{Postgres.DATABASE_URL}}` reference — that gave us circular issues).
  - Railway networking port set to **8080** (matches what `process.env.PORT` gives Node
    on Railway; do NOT change to 3000 without adding a `PORT=3000` env var too).
- **Frontend still runs locally** (`mobile/.env` has `EXPO_PUBLIC_API_URL` pointing at
  Railway). Both desktop and phone browsers hit Railway.
- **eBay OAuth**: connected via sandbox test user, all 4 scopes granted
  (`api_scope` + `sell.inventory` + `sell.account` + `sell.fulfillment`).
  Access token 2hr, refresh token 18mo (auto-refresh on demand).
- **Two real publishes confirmed:**
  - 2026-07-14: Single-card Charizard → sandbox listing `110589912281`
    (`https://sandbox.ebay.com/itm/110589912281`).
  - 2026-07-16: 3-card lot (Pikachu / Squirtle / Poliwrath) → sandbox listing
    `110589927694` (`https://sandbox.ebay.com/itm/110589927694`), category
    Pokémon Mixed Card Lots (183456), condition `NEW`, $50 ask.

## GitHub

`https://github.com/mxcoop98/card-scan-app` — Railway auto-deploys off `main`.

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
│   ├── ebay.js              # OAuth + Sell API wrapper (single + lot publish)
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
│   │   │   ├── scan.tsx                 # Photo capture + hint search
│   │   │   └── settings.tsx             # eBay Connect + Sync buttons
│   │   ├── components/
│   │   │   ├── bottom-tab-bar.tsx       # Custom 5-tab bar (Ionicons)
│   │   │   ├── sparkline.tsx            # SVG line chart (needs react-native-svg)
│   │   │   ├── skeleton.tsx             # Pulsing grey block loader
│   │   │   ├── empty-state.tsx          # Icon ring + title + hint + CTA
│   │   │   ├── themed-input.tsx         # Theme-aware TextInput (light/dark)
│   │   │   ├── themed-text.tsx
│   │   │   └── themed-view.tsx          # backgroundElement type = elevated card
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
`POST /api/listings/:id/mark-sold`, `DELETE /api/listings/:id`,
`POST /api/listings/:id/publish-ebay` (single-card OR lot),
`POST /api/listings/:id/ebay-reset` (delete stale eBay offer/inventory to unstick a failed publish).

Portfolio: `GET /api/portfolio/summary`, `GET /api/portfolio/timeseries`.

Scan: `POST /api/scan` — body `{category, hints:{name?, set_name?, card_number?}, image?}`,
returns `{candidates: [...]}`.

Variants: `GET /api/variants?category=pokemon&name=Charizard[&set_name=&card_number=]`
returns `{variants: [...]}` — every printing across sets for the parallel picker.

eBay:
- `GET  /api/ebay/status` — connection state + configured scopes.
- `GET  /api/ebay/authorize-url` — returns URL to redirect user to.
- `GET  /api/ebay/callback?code=` — code→token exchange target.
- `GET  /api/ebay/policies` — dump seller's fulfillment/payment/return policies + locations.
- `POST /api/ebay/setup-sandbox-seller` — one-shot idempotent provisioner:
  opts into Business Policies, creates default merchant location + default
  fulfillment/payment/return policies. Returns the IDs to plug into env.
- `POST /api/ebay/sync-orders?lookback_days=30` — pull recent orders,
  match to `listings.ebay_listing_id`, mark sold with real price/fees/shipping.
  **Sandbox limitation**: returns 403 for sandbox test users (no seller verification).
  Works in production.
- `POST /api/listings/:id/publish-ebay` — single card OR multi-card lot. Idempotent
  (reuses existing offer for the SKU if a previous attempt got stuck).
- `POST /api/listings/:id/ebay-reset` — delete eBay-side offer + inventory for the
  listing's SKU (`ct-{listing_id}`). Use when a publish attempt got stuck with a
  stale offer state that keeps rejecting retries.

Health: `GET /health`.

## eBay integration setup — LESSONS LEARNED (do not relearn these)

**Fully wired end-to-end 2026-07-14.** All the gotchas hit + coded around:

### 1. HTTPS required — no localhost. Use Railway.

eBay Developer Console's Auth Accepted URL field silently enforces HTTPS + a real
public domain. `localhost` is rejected regardless of what the docs say. Railway
gives us HTTPS for free. If you need to test locally without Railway, use
Cloudflare quick tunnel (`docker run --rm cloudflare/cloudflared:latest tunnel
--url http://host.docker.internal:3000`) for a temporary HTTPS URL.

### 2. Required env vars on Railway

```
EBAY_ENV=sandbox
EBAY_CLIENT_ID=<Sandbox App ID>
EBAY_CLIENT_SECRET=<Sandbox Cert ID>
EBAY_REDIRECT_URI=https://card-scan-app-production.up.railway.app/api/ebay/callback
EBAY_RUNAME=<RuName from Developer Console — looks like "Firstname_Lastname-XXX-XXX-xxxxx">
EBAY_SCOPES=https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment
EBAY_MERCHANT_LOCATION_KEY=default
EBAY_FULFILLMENT_POLICY_ID=6236562000
EBAY_PAYMENT_POLICY_ID=6236560000
EBAY_RETURN_POLICY_ID=6236561000
```

The policy IDs come from `POST /api/ebay/setup-sandbox-seller` (below).

### 3. RuName vs URL for OAuth's `redirect_uri`

eBay's OAuth 2.0 wants the RuName as the `redirect_uri` query parameter, NOT the
literal URL. eBay uses the RuName to look up the Auth Accepted URL. Our `ebay.js`
uses `EBAY_RUNAME` for the redirect_uri if set. If you skip the RuName, OAuth
silently fails with a "temporarily_unavailable" error which is really "we can't
find your RuName".

### 4. Sandbox login has a TESTUSER_ prefix

When signing in with a sandbox test user during OAuth, prepend `TESTUSER_` to
the username shown in Developer Console. Without it, you get "password incorrect"
even with the right password. Undocumented but well-known once you know.

### 5. Password reset in sandbox is broken (DNS error)

If the sandbox test user's password ever "doesn't work", delete the user in
Developer Console → Sandbox → Test Users and create a new one. NEVER use the
password reset link — it points to a broken domain. Use a boring compliant
password (`CardScan1!` shape — 8+ chars, upper + lower + number + symbol).

### 6. RuName redirect quirk (workaround: manual code exchange)

After OAuth consent, eBay sometimes lands on `auth2.ebay.com/oauth2/ThirdPartyAuthSucessFailure`
("Authorization successfully completed. It's now safe to close the browser window")
instead of redirecting to our Railway callback. The URL contains `?code=...`.
Copy the whole URL to Claude / a curl, then hit:
`GET https://card-scan-app-production.up.railway.app/api/ebay/callback?code=<the-code>`
to complete the exchange manually. Code is valid for 5 minutes.

Root cause is probably a RuName ↔ Auth Accepted URL config mismatch in Developer
Console. Investigate + fix in a future session for smoother UX.

### 7. Sandbox users need onboarding before publish works

Sandbox test users aren't opted into Business Policies and lack a merchant
location by default, which blocks the Sell API. Use our one-shot provisioner:

```
curl -X POST https://card-scan-app-production.up.railway.app/api/ebay/setup-sandbox-seller
```

It idempotently: opts into Business Policies, creates a default warehouse, and
creates fulfillment/payment/return policies named "CardTracker Default". Returns
IDs to plug into env vars (see step 2).

### 8. eBay Inventory API needs Accept-Language header

Not just `Content-Language`. Missing it returns errorId 25709 ("Invalid value for
header Accept-Language"). Both headers are set in `api()` helper in `ebay.js`.

### 9. Publish requires category-specific aspects

Pokémon TCG (category 183454) requires the `Game` aspect. Sports need `Sport` /
`Player` / `Team`. `buildAspects()` in `ebay.js` fills these based on card.category.
If eBay complains about a missing aspect, add it to that function.

### 10. Order sync blocked in sandbox

`GET /sell/fulfillment/v1/order` returns 403 "Insufficient permissions" for
sandbox test users even with `sell.fulfillment` scope granted. eBay requires
full seller onboarding (identity verification, linked payments) for order
visibility — not something sandbox provides. `POST /api/ebay/sync-orders` is
coded correctly and will work in production. For sandbox demos, use the manual
"Record sale" form on the listing detail page instead.

### Reconnecting after adding a new scope

Refresh tokens can only refresh with their originally-granted scopes. Adding a
new scope requires a fresh consent flow (not a refresh). If you add a scope to
`EBAY_SCOPES` and try to use it, you'll get `invalid_scope` from the token
refresh endpoint. Fix: click Reconnect eBay in the app, do the OAuth flow again,
copy the new code, exchange.

### 11. Do NOT send `scope` on refresh_token grant

`refreshAccessToken` in `ebay.js` omits the `scope` param intentionally. eBay's
docs say scope is optional on refresh and defaults to the originally-granted
scopes. Passing our current `EBAY_SCOPES` fails with `invalid_scope` if the env
has been widened since the last consent (which happens every time we add a
Sell-API scope). Leave it off.

### 12. Multi-card lot publishing — condition + category quirks

Lot publishing lives on the same `publishListing()` — pass N cards, it detects
`isLot`. Behaviors:

- **Category ID**: Pokémon Mixed Card Lots (`183456`), Sports Mixed Card Lots
  (`261328`). Singles use `183454` / `212`.
- **Condition enum**: Pokémon Mixed Card Lots is oddly restrictive. Only `NEW`
  was accepted in sandbox. `USED_VERY_GOOD`, `USED_GOOD`, `LIKE_NEW`, and plain
  `USED` all returned errorId 25021 ("condition id is invalid for category"). If
  you extend to more lot categories, expect to have to trial-and-error the
  condition.
- **Aspects**: `Type='Card Lot'`, `Number of Cards` filled from card count,
  `Vintage`/`Graded`='Mixed' when the lot spans states, common set/year surfaced
  only when all cards share them.
- **Title**: honors `listing.title` when set (up to 80 chars, eBay's limit).
  Otherwise composed from common set/year + card count.
- **Description**: enumerates every card in the lot with meta.
- **Images**: passes all cards' `image_url` (up to 24, eBay's limit).

### 13. Publish is idempotent — reuse existing offer for SKU

`publishListing()` now queries `/sell/inventory/v1/offer?sku=ct-{listing.id}`
first. If an offer exists it reuses the `offerId` instead of creating a new one
(which would fail with "Offer entity already exists"). If the existing offer is
already published, returns the existing `listingId` immediately.

Failed publish attempts can leave the eBay-side inventory item + offer in a bad
state that keeps rejecting retries (e.g. stuck on an invalid category/condition
combo from the initial attempt). Use `POST /api/listings/:id/ebay-reset` to
force-delete the offer + inventory item and start fresh. Idempotent — safe to
call even when nothing is stuck.
```

## What's built vs not

**Done:**
- Backend REST API (all endpoints above), migrations, seed data.
- Frontend: cards grid, card detail (big image + big price + comps table +
  **grade pill selector RAW/PSA/BGS/SGC**), add card, grading analysis,
  bundles, listings + mark-sold, portfolio + **sparkline**, scan (v1 hint
  search + native camera path), settings (eBay connect + sync).
- Bottom tab bar (Cards / Bundles / Scan / Listings / Portfolio) with
  **Ionicons** from `@expo/vector-icons`.
- **UI polish**: card panels elevated via themed-view, hover/press feedback on
  card tiles + listing rows, colored status dots on listings, skeleton loaders
  everywhere (Cards, Portfolio, Listings, Card Detail), reusable EmptyState
  component (Cards, Listings, Bundles).
- Custom `lib/confirm.ts` (web uses `window.confirm`), `themed-input.tsx`
  (light/dark aware — the previous hardcoded-white bug that broke input
  visibility on light mode).
- Portfolio timeseries (daily portfolio USD value from price_history).
- Pricing provider auto-backfills `image_url` + `external_ids` on price fetch.
- **eBay integration** (Railway sandbox, all 4 scopes): OAuth flow, one-shot
  sandbox seller provisioner (Business Policies opt-in + merchant location +
  fulfillment/payment/return policies), single-card publish, multi-card lot
  publish (idempotent, with `ebay-reset` recovery endpoint), order sync
  (code done — sandbox-blocked, works in production).

**Not built (roadmap):**
1. **Image-based recognition** — `recognition.js` has the abstraction; v1 is
   hint search. Wire Ximilar `/v2/tcg_id` or Google Vision as a new provider
   when ready to pay.
2. **eBay v3 items still todo**: RuName redirect fix (currently requires
   manual code copy after every OAuth), scheduled order-sync cron (Railway
   cron service pointing at `POST /api/ebay/sync-orders`), production seller
   onboarding, more polished title / aspect logic per category.
3. **Sports pricing** — no clean official API. Candidates: eBay sold-listings,
   Card Ladder, SportsCardsPro, PSA Auction Prices Realized. Do NOT hallucinate
   one — present tradeoffs.
4. **Sports variant discovery** — the `/api/variants` endpoint returns empty for
   sports because we don't have a sports card DB. Same fix as sports pricing.
5. **PSA API for grading** — auto-populate graded price estimates + Pop Report
   probabilities so the grade pill selector fills in without manual entry.
6. **Front + back card images** — schema addition (`image_url_back`), dual
   image display on card detail, back-capture in scan.
7. **Native camera in dev build / Expo Go** — `scan.tsx` has the
   `expo-image-picker` path but it only fires when the app runs through Expo
   Go or a dev build. Mobile web still uses the file-input `capture="environment"`
   flow which already opens the phone camera.

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
- **`@expo/vector-icons` install can leave partial internals** — if you install it
  and get `Unable to resolve module ./createIconSet`, run a full `npm install` from
  the mobile/ dir to complete the dep tree. Then restart Metro with `--clear`.
- **`react-native-svg` isn't in the base template** — needed for the portfolio
  sparkline. Install via `NODE_TLS_REJECT_UNAUTHORIZED=0 npx expo install react-native-svg`
  on TLS-intercepted networks.
- **Metro's `CI=1` disables the file watcher** — every code change requires a full
  Metro restart to take effect. Run Metro *without* `CI=1` for hot reload during
  active dev; use `CI=1` only when running Metro as a long-lived background process
  and you'll be restarting manually anyway.

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
