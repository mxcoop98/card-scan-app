# Card Tracker — Handoff

Onboarding doc so any new session (Claude Code or human) can pick this up cleanly.
Written 2026-07-09; updated 2026-07-14 (eBay singles published); 2026-07-15 (UI polish
+ grade pill selector); 2026-07-16 (multi-card lot publishing + idempotent recovery);
2026-07-17 (frontend deployed to Vercel — app is now public).

## Deployed state (as of 2026-07-17)

- **Frontend live on Vercel**: **https://card-scan-app.vercel.app** ← share this URL.
  - Static export of the Expo web build; Vercel auto-deploys off GitHub `main`.
  - Env var set in Vercel dashboard: `EXPO_PUBLIC_API_URL` points at Railway backend.
  - `mobile/vercel.json` — buildCommand + outputDirectory + a single catchall
    rewrite. Static routes (`/portfolio`, `/settings`, etc.) served by filename;
    dynamic routes (`/cards/:id`, `/listings/:id`, `/cards/:id/grading`) fall
    through to `/index.html` for client-side hydration.
  - Deployment Protection is off so the production URL is public.
- **Backend live on Railway**: https://card-scan-app-production.up.railway.app
  - Postgres provisioned as sibling Railway service, wired via literal `DATABASE_URL`
    (not the `${{Postgres.DATABASE_URL}}` reference — that gave us circular issues).
  - Railway networking port set to **8080** (matches what `process.env.PORT` gives Node
    on Railway; do NOT change to 3000 without adding a `PORT=3000` env var too).
  - `app.use(cors())` allows all origins — Vercel calls work without any config.
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

`https://github.com/mxcoop98/card-scan-app` — **both Railway and Vercel** auto-deploy
off `main`. One push → both platforms rebuild in ~90 sec each.

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

### 6. RuName "auth accepted URL" misconfig — FIXED + VERIFIED END-TO-END (2026-07-27)

**Symptom:** after OAuth consent, eBay landed on its generic "Authorization
successfully completed — safe to close the browser window" page instead of
redirecting to our Railway callback. Later this hardened into a **403 Forbidden**
(with a Transaction ID) on clicking Connect/Reconnect.

**Actual root cause:** the *sandbox* RuName's **"Your auth accepted URL"** (and
declined URL) were set to eBay's **production** generic page
(`https://signin.ebay.com/ws/eBayISAPI.dll?ThirdPartyAuth...`). A production URL
inside a sandbox config both dead-ended consent AND got the sandbox authorize
request rejected (the 403).

**Fix (done in the Developer Console, saved 2026-07-24):**
- developer.ebay.com → Application Keys → **Sandbox** → **User Tokens** → section
  "Get a Token from eBay via Your Application" → **Your eBay Sign-in Settings** →
  expand RuName `Danie_Cooper-DanieCoo-CardSc-gligbmvde`.
- Set **Your auth accepted URL** = `https://card-scan-app-production.up.railway.app/api/ebay/callback`
- Clear **Your auth declined URL** (blank → eBay's environment-correct default).
- Save. Verified: the authorize URL no longer 403s and now routes to
  `signin.sandbox.ebay.com` consent. (Display Title + privacy-policy URL are still
  blank — that's fine, OAuth worked with them blank the whole time.)

**End-to-end verified 2026-07-27** (human, real browser): Settings → Connect eBay
→ sandbox `TESTUSER_` sign-in → consent → **landed back on
`card-scan-app.vercel.app/settings` automatically**. No manual code copy, no paste
box needed. This gotcha is closed — the old manual-code-exchange workaround is
dead, don't resurrect it.

Also confirmed the same day: the access token had expired (2026-07-24T23:20) and a
single `GET /api/ebay/policies` returned **200** and silently refreshed it to a new
expiry. The refresh-token path works unattended; a reconnect is NOT part of normal
operation. Refresh token good to **2028-01-23**.

**Permanent fallback (still in place):** if eBay ever dead-ends on the "safe to
close" page again, don't curl. Use the in-app **Finish connecting** box on the
Settings screen — paste the whole redirect URL (or just the code) and it exchanges
server-side via `POST /api/ebay/complete-auth`. Shipped in commit `dfee564`.

**Also note:** `EBAY_POST_AUTH_REDIRECT=https://card-scan-app.vercel.app/settings`
is set on Railway so a successful callback bounces back to the live app (not the
old `localhost:8081` default). The eBay *connection itself was never broken*
during this whole episode — refresh token is valid to 2028-01 and
`GET /api/ebay/policies` returned 200 throughout; this was purely about making
future reconnects painless.

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

### 14. Inventory API rejects `data:` URIs — images must be public HTTPS URLs

This is the whole reason owner photos are stored as bytes in the `card_images`
table and served from `GET /api/cards/:id/image/:side` instead of being kept as
data URIs on the card row. eBay fetches image URLs server-side, so they have to
be real, public, and reachable. Two consequences:

- `app.set('trust proxy', true)` in `server.js` is load-bearing. Railway
  terminates TLS in front of us, so without it `req.protocol` is `http` and
  every image URL we hand eBay is unfetchable. Prefer `PUBLIC_BASE_URL` or
  Railway's `RAILWAY_PUBLIC_DOMAIN` over sniffing the request.
- `publishListing()` filters image URLs through an `http(s)` test before
  sending. Fronts lead (the first image becomes the gallery thumbnail), then
  backs, capped at eBay's limit of 24.

Photo URLs carry a `?v={updated_at}` cache-buster so replacing a photo doesn't
serve eBay (or the app) a stale copy.

## Vercel frontend deploy — LESSONS LEARNED

### Setup (already done, documented here for repro)

1. https://vercel.com → **Add New Project** → import `mxcoop98/card-scan-app`.
2. **Root Directory: `mobile`** (this is the make-or-break setting — Vercel
   defaults to repo root and fails to detect Expo without this).
3. Framework Preset: **Other** (Expo web isn't in Vercel's auto-detect list).
4. Build / Install / Output are all defined in `mobile/vercel.json` so the UI
   fields can be left alone.
5. **Env vars** → add `EXPO_PUBLIC_API_URL=https://card-scan-app-production.up.railway.app`.
   `EXPO_PUBLIC_*` vars are baked into the JS bundle at build time.
6. Deploy.
7. Settings → **Deployment Protection** → set to **None** (or "Only Production")
   so preview URLs and the production URL are publicly accessible without a
   Vercel login.

### The one vercel.json that works

```json
{
  "buildCommand": "npx expo export -p web",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "cleanUrls": true,
  "rewrites": [
    { "source": "/((?!_expo|assets|favicon\\.ico|robots\\.txt).*)", "destination": "/" }
  ]
}
```

The negative-lookahead pattern excludes asset paths from the catchall so JS/CSS
bundles serve directly from `dist/_expo/...`.

**`cleanUrls: true` and `destination: "/"` are a package — changing either one
alone breaks the site.** `cleanUrls` makes `/index.html` redirect to the
extensionless form, so a rewrite pointing at `/index.html` no longer lands on a
file and Vercel answers NOT_FOUND. That is what "cleanUrls broke dynamic
routing" meant in the earlier attempt: `/cards/:id` and `/listings/:id` returned
404, taking out card detail deep links and refreshes. `/` serves the same
index.html and is not itself redirected, so the catchall works again.

**Correcting a claim this file used to make:** it said static routes got their
pre-rendered HTML anyway, because Vercel checks the filesystem before rewrites
and "a `.html` file with the same name wins". That is wrong, and it hid a bug
for a while. `/portfolio` has no extension, so it never matched `portfolio.html`
during the filesystem phase — the catchall swallowed it. Every route served
byte-identical `index.html` (verified: same md5 for `/`, `/scan`, `/portfolio`),
so every non-index route hydrated markup for the wrong page and React logged
error #418 in production. `cleanUrls` is what actually makes the extensionless
path resolve to the `.html` file.

Current behaviour, measured on a preview deployment:

- `/`, `/scan`, `/portfolio`, `/bundles`, `/listings`, `/settings`, `/cards/new`
  → their own pre-rendered HTML, hydrate clean, no console errors.
- `/cards/:id`, `/listings/:id`, `/cards/:id/grading`, unknown paths → 200
  serving index.html via the catchall, client-rendered as before.

Dynamic routes still hydrate index.html and so still log #418. Fixing that needs
explicit rewrites to files named with literal brackets
(`dist/cards/[id].html`), which is the per-route approach that caused trouble
before — worth attempting only on a preview, never straight to main.

Verify any change to this file on a preview deploy before merging. Push the
branch, then find the preview URL without needing the Vercel CLI:

```
sha=$(git rev-parse HEAD)
curl -s "https://api.github.com/repos/mxcoop98/card-scan-app/deployments?sha=$sha" # -> statuses_url
curl -s "<statuses_url>"                                                          # -> environment_url
```

Preview URLs still sit behind Deployment Protection even though production does
not, so anonymous `curl` gets a 302 to Vercel SSO. Open them in a browser that
is already signed in to Vercel, and fetch same-origin from the page to inspect
other routes.

### Production URL vs preview URLs

Vercel gives every deployment three URLs:
- `card-scan-app.vercel.app` — canonical production (public). **Use this one to share.**
- `card-scan-app-git-main-card-scan-app.vercel.app` — branch alias (still SSO-gated).
- `card-scan-omfxp0zrd-...vercel.app` — per-commit preview (still SSO-gated).

The disable-Deployment-Protection setting above makes ALL three public. Currently
only the canonical production URL is fully public.
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
- Pricing provider auto-backfills `image_url` + `external_ids` on price fetch —
  but only when `image_url` is NULL, so it never overwrites your own photo.
- **OCR auto-fill** — `POST /api/ocr` reads a card photo and returns
  `{name, card_number, set_name, confidence}` to prefill the scan form.
  Provider registry in `src/ocr.js`, same shape as pricing/recognition, so a
  paid identifier drops in as one function. See "OCR" below for accuracy and
  the tuning that got there.
- **Front + back card photos** — `PUT/GET/DELETE /api/cards/:id/image/:side`,
  bytes stored in the `card_images` table, front/back capture slots on scan and
  an add/replace/remove toggle on card detail. Shared capture UI lives in
  `mobile/src/components/photo-capture.tsx`. See eBay gotcha #14 for why the
  bytes are in Postgres instead of as data URIs on the card row.
- **eBay integration** (Railway sandbox, all 4 scopes): OAuth flow, one-shot
  sandbox seller provisioner (Business Policies opt-in + merchant location +
  fulfillment/payment/return policies), single-card publish, multi-card lot
  publish (idempotent, with `ebay-reset` recovery endpoint), order sync
  (code done — sandbox-blocked, works in production).
- **Frontend deployed to Vercel** (`https://card-scan-app.vercel.app`) via a
  static Expo web export. Auto-deploys from GitHub `main`. Env var
  `EXPO_PUBLIC_API_URL` set in Vercel dashboard points at Railway backend.
  `mobile/vercel.json` uses a negative-lookahead catchall rewrite so dynamic
  routes hydrate correctly. Deployment Protection is off for public access.

**Not built (roadmap):**
1. **Image-based recognition** — `recognition.js` has the abstraction, and OCR
   auto-fill now covers the free tier (name + number off the photo). Wire
   Ximilar `/v2/tcg_id` as a provider when ready to pay: it identifies the exact
   printing rather than inferring it from text, and covers sports too.
2. **eBay v3 items still todo**: scheduled order-sync cron (Railway cron
   service pointing at `POST /api/ebay/sync-orders`), production seller
   onboarding + getting the prod keyset re-enabled (marketplace-deletion
   compliance), more polished title / aspect logic per category. The RuName
   redirect fix is **done** — see gotcha #6.
3. **Sports pricing** — researched, still undecided; every source has a cost or
   licensing blocker. See "Sports pricing — the decision" above. Do NOT pick one
   unilaterally. Sports cards otherwise work end to end.
4. **Sports variant discovery** — the `/api/variants` endpoint returns empty for
   sports because we don't have a sports card DB. Same fix as sports pricing.
5. **PSA API for grading** — auto-populate graded price estimates + Pop Report
   probabilities so the grade pill selector fills in without manual entry.
6. **Bundle suggestions for cheap cards** — group low-value cards into lots;
   heuristics on set / year / theme. (Front + back images, previously #6,
   shipped 2026-07-29.)
7. **Native camera in dev build / Expo Go** — `scan.tsx` has the
   `expo-image-picker` path but it only fires when the app runs through Expo
   Go or a dev build. Mobile web still uses the file-input `capture="environment"`
   flow which already opens the phone camera.

## OCR — what it actually does, and what it cost to get there

`POST /api/ocr` takes a card photo and returns search hints. It runs
**tesseract.js locally**: no API key, no vendor decision, no per-scan cost.
Measured on six real Base Set / Jungle scans:

| | result |
|---|---|
| name correct | 5/6 |
| name **wrong** | **0/6** |
| card number | 6/6 |
| latency | 1.1–2.6s |

The zero is the number that matters. A wrong value in a field is worse than an
empty one, because the user has to notice it before it silently poisons the
search. Poliwrath reads as `null` rather than a guess, and the UI says so.

Three things were needed to get there, none of them obvious:

1. **Pick the name by confidence, not size.** Holo foil makes OCR hallucinate
   large nonsense over the artwork. On a Base Set Charizard the two tallest
   "words" are `sthce` (44px, 66% confident) and `Eon` (32px, 47%) — the real
   name is only 29px but **96%** confident. Selecting by height picks garbage
   every time; `confidence >= 70` separates them cleanly. Height is still used,
   but only among words that already cleared the confidence bar.
2. **Read the collector number from a second pass over the bottom strip.** It's
   small and often sits over artwork; a whole-card pass missed it half the time.
   `worker.recognize(buf, { rectangle })` confines OCR to the bottom 18%, which
   took the number from 2/6 to 6/6. That needs image dimensions, which
   `imageSize()` parses straight out of the PNG/JPEG header rather than pulling
   in an image library.
3. **Set name is deliberately never returned.** Pokémon sets are identified by a
   printed symbol, not text, so there is nothing to read. Guessing would put a
   wrong value in a field the user then has to notice and clear.

**The card number is printed `4/102` but the catalog stores `4`.** The scan
form's own placeholder says `4/102`, so anyone typing what it suggests got zero
results — a real bug that predated OCR and that OCR would have made constant.
`pokemonTcgSearch` now keeps only the part before the slash (and strips zero
padding, so `058/198` works).

Worth knowing about deployment: tesseract.js pulls `eng.traineddata` from a CDN
on first use in a fresh container, so the first scan after a deploy is slower.
If that fetch fails the endpoint returns 503 and the scan screen tells the user
to type the fields instead — OCR failing never blocks adding a card.

## Sports pricing — the decision, and why it's still open

Sports cards **scan, read, save and track** as of 2026-08-03. What they don't
have is a market value, because every price source has a blocker. Researched
2026-08-03 — re-verify before acting, this landscape moves:

| Source | Cost | Blocker |
|---|---|---|
| eBay Marketplace Insights (real sold comps) | — | **Limited Release**; non-partners routinely denied. Our `sell.*` OAuth does not help — this is not a missing scope. |
| eBay Browse (active listings) | free | *Asking* prices, not sold, so it overstates value. Also needs the prod keyset re-enabled, already a separate blocker. |
| SportsCardsPro (PriceCharting) | $49/mo | **ToS forbids use in "any software, application, or system that is accessible to third parties"** without express permission. Internal use only → unusable in a public app. Current values only, no history. |
| CardHedge | **unknown**, sales-led | Sports **and** Pokémon, price history, pop reports, plus AI photo identification. Targets startups shipping products, so the licensing posture fits. |
| Zyla API Hub listing | $49.99/mo | Only **2,000 requests/month**, then ~$0.032 each. Opaque underlying source. The daily refresh cron blows that quota at modest collection sizes. |
| Card Ladder | — | No public API; scraping only. |

**Next action:** `CARDHEDGE_ENQUIRY.md` holds a drafted enquiry, unsent, needing
two volume numbers. CardHedge is worth asking because it could close sports
pricing + sports identification + Pokémon identification + pop data in one
integration. If their answer to the licensing question matches SportsCardsPro's,
the shortlist is empty and the fallback is **manual value entry** — let the user
type a value per sports card, which costs nothing, carries no licensing risk,
and makes portfolio/P&L work immediately.

Watch the quota arithmetic on anything metered: `refresh-all.js` makes one call
per card per day, so monthly calls ≈ collection size × 30.

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
- **Vercel Deployment Protection is on by default** — preview URLs 302 to Vercel's
  SSO login. Kill it in Project Settings → Deployment Protection → None. Otherwise
  strangers can't view the app.
- **Vercel Root Directory defaults to repo root** — for our monorepo shape (mobile/
  under root) you MUST set Root Directory = `mobile` at project import time. Miss
  this and the build fails to find package.json.

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
