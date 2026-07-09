# Card Tracker — Backend

Node/Express + Postgres backend for scanning, cataloging, and tracking the value
of sports & Pokémon cards over time. Built to deploy on Railway.

## What it does

- Stores cards (Pokémon + sports) in Postgres
- Fetches prices from pluggable providers (PokémonTCG.io included, free)
- Records every price fetch as a timestamped row → value-over-time history
- Exposes a REST API the Expo front end consumes
- Ships a standalone daily job (`refresh-all.js`) that snapshots every card's price

## Project layout

```
schema.sql            # DB tables (cards, price_history, listings)
src/db.js             # Postgres pool (auto-SSL for Railway)
src/migrate.js        # Applies schema.sql on startup (idempotent)
src/pricing.js        # Pricing provider abstraction + PokémonTCG.io
src/server.js         # Express API
src/refresh-all.js    # Daily price-snapshot job (Railway cron service)
Dockerfile            # Deterministic build
```

## API endpoints

| Method | Path                          | Purpose                                  |
|--------|-------------------------------|------------------------------------------|
| GET    | `/health`                     | Health check                             |
| GET    | `/api/cards`                  | List all cards with their latest price   |
| GET    | `/api/cards/:id`              | One card + full price history            |
| POST   | `/api/cards`                  | Create a card (auto-fetches first price) |
| POST   | `/api/cards/:id/refresh-price`| Manually re-fetch a card's price         |
| DELETE | `/api/cards/:id`              | Delete a card                            |

## Run locally

```bash
npm install
cp .env.example .env         # set DATABASE_URL to your local Postgres
npm run dev                  # migration runs automatically on boot
```

Test:
```bash
curl -X POST localhost:3000/api/cards -H 'Content-Type: application/json' \
  -d '{"category":"pokemon","name":"Charizard","external_ids":{"pokemontcg_io":"base1-4"}}'
curl localhost:3000/api/cards
```

## Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
   Railway detects the Dockerfile and builds automatically.
3. Add Postgres: **+ New → Database → PostgreSQL**.
4. On the API service, add a variable:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
   (Railway injects `PORT` automatically — the app already reads it.)
5. **Generate Domain** under the service's Networking settings → public API URL.

### Daily price snapshots (cron)

1. **+ New → Empty Service** (same repo).
2. Set its **Start Command** to: `node src/refresh-all.js`
3. Add the same variable: `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
4. **Settings → Cron Schedule**: `0 6 * * *` (daily at 06:00 UTC).
   The job runs to completion and exits, which is exactly what Railway cron needs.

### Optional

- `POKEMONTCG_API_KEY` — free key from https://dev.pokemontcg.io raises rate limits.

## Adding more pricing sources

Each provider is a function `(card) => [{ source, price, currency, price_type }]`.
Add one in `src/pricing.js` and register it under the right category in `PROVIDERS`.
Next up: TCGplayer-direct, and eBay sold-listings for sports cards.
