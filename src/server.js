import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { query } from './db.js';
import { fetchPrices } from './pricing.js';
import { migrate } from './migrate.js';
import { analyzeGrading } from './grading.js';
import { suggestBundles } from './bundling.js';
import { identifyCard } from './recognition.js';
import * as ebay from './ebay.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- health ---
app.get('/health', (_req, res) => res.json({ ok: true }));

// --- list all cards (with their latest price) ---
app.get('/api/cards', async (_req, res) => {
  const { rows } = await query(`
    SELECT c.*,
           ph.price  AS latest_price,
           ph.currency AS latest_currency,
           ph.fetched_at AS latest_price_at
    FROM cards c
    LEFT JOIN LATERAL (
      SELECT price, currency, fetched_at
      FROM price_history
      WHERE card_id = c.id
      ORDER BY fetched_at DESC
      LIMIT 1
    ) ph ON true
    ORDER BY c.created_at DESC
  `);
  res.json(rows);
});

// --- get one card + full price history ---
app.get('/api/cards/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const history = await query(
    'SELECT source, price, currency, price_type, fetched_at FROM price_history WHERE card_id = $1 ORDER BY fetched_at ASC',
    [req.params.id]
  );
  res.json({ ...rows[0], price_history: history.rows });
});

// --- create a card (from a scan or manual entry) ---
app.post('/api/cards', async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO cards
      (category, name, set_name, card_number, year, player, team, sport,
       condition, grade, grader, external_ids, image_url, notes, cost_basis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      b.category, b.name, b.set_name ?? null, b.card_number ?? null, b.year ?? null,
      b.player ?? null, b.team ?? null, b.sport ?? null,
      b.condition ?? null, b.grade ?? null, b.grader ?? null,
      b.external_ids ?? {}, b.image_url ?? null, b.notes ?? null, b.cost_basis ?? null,
    ]
  );
  const card = rows[0];

  // fetch initial price + image + external_ids
  try {
    const fetched = await fetchPrices(card);
    await storePrices(card.id, fetched.prices);
    await enrichCard(card, fetched);
  } catch (e) {
    console.error('initial price fetch failed:', e.message);
  }

  const refreshed = await query('SELECT * FROM cards WHERE id = $1', [card.id]);
  res.status(201).json(refreshed.rows[0]);
});

// --- manually trigger a fresh price fetch for one card ---
app.post('/api/cards/:id/refresh-price', async (req, res) => {
  const { rows } = await query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const fetched = await fetchPrices(rows[0]);
  await storePrices(rows[0].id, fetched.prices);
  await enrichCard(rows[0], fetched);
  res.json({ inserted: fetched.prices.length, prices: fetched.prices, image_url: fetched.image_url });
});

// If the provider returned a new image_url or better external_ids, persist them.
async function enrichCard(card, fetched) {
  const patches = [];
  const values = [];
  if (fetched.image_url && !card.image_url) {
    values.push(fetched.image_url);
    patches.push(`image_url = $${values.length}`);
  }
  if (fetched.external_ids) {
    const merged = { ...(card.external_ids ?? {}), ...fetched.external_ids };
    if (JSON.stringify(merged) !== JSON.stringify(card.external_ids ?? {})) {
      values.push(merged);
      patches.push(`external_ids = $${values.length}`);
    }
  }
  if (patches.length === 0) return;
  values.push(card.id);
  await query(`UPDATE cards SET ${patches.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
}

// --- patch mutable card fields (cost_basis, notes, condition, grade info) ---
app.patch('/api/cards/:id', async (req, res) => {
  const b = req.body;
  const fields = ['cost_basis', 'notes', 'condition', 'grade', 'grader', 'image_url', 'set_name', 'card_number', 'year', 'player', 'team', 'sport'];
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (b[f] !== undefined) {
      values.push(b[f]);
      sets.push(`${f} = $${values.length}`);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no updatable fields provided' });
  values.push(req.params.id);
  const { rows } = await query(
    `UPDATE cards SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// --- delete a card ---
app.delete('/api/cards/:id', async (req, res) => {
  await query('DELETE FROM cards WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// ============================================================
// Grading worthiness endpoints
// ============================================================

app.get('/api/grading-services', async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM grading_services WHERE active = true ORDER BY grader, fee'
  );
  res.json(rows);
});

app.post('/api/grading-services', async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO grading_services (grader, tier, fee, currency, turnaround_days, max_declared_value)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.grader, b.tier, b.fee, b.currency ?? 'USD', b.turnaround_days ?? null, b.max_declared_value ?? null]
  );
  res.status(201).json(rows[0]);
});

app.get('/api/cards/:id/graded-estimates', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM graded_price_estimates WHERE card_id = $1 ORDER BY grader, grade DESC',
    [req.params.id]
  );
  res.json(rows);
});
app.post('/api/cards/:id/graded-estimates', async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO graded_price_estimates (card_id, grader, grade, estimated_price, currency, source, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (card_id, grader, grade, source)
     DO UPDATE SET estimated_price = EXCLUDED.estimated_price, notes = EXCLUDED.notes
     RETURNING *`,
    [req.params.id, b.grader, b.grade, b.estimated_price, b.currency ?? 'USD', b.source ?? 'user', b.notes ?? null]
  );
  res.status(201).json(rows[0]);
});
app.delete('/api/graded-estimates/:id', async (req, res) => {
  await query('DELETE FROM graded_price_estimates WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

app.get('/api/cards/:id/grade-probabilities', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM grade_probabilities WHERE card_id = $1 ORDER BY grader, grade DESC',
    [req.params.id]
  );
  res.json(rows);
});
app.post('/api/cards/:id/grade-probabilities', async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO grade_probabilities (card_id, grader, grade, probability, notes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (card_id, grader, grade)
     DO UPDATE SET probability = EXCLUDED.probability, notes = EXCLUDED.notes
     RETURNING *`,
    [req.params.id, b.grader, b.grade, b.probability, b.notes ?? null]
  );
  res.status(201).json(rows[0]);
});
app.delete('/api/grade-probabilities/:id', async (req, res) => {
  await query('DELETE FROM grade_probabilities WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// Query params override defaults:
//   ?selling_fee_rate=0.13   (0-1)
//   ?shipping=10             (USD, one-way to grader)
app.get('/api/cards/:id/grading-analysis', async (req, res) => {
  const cardRes = await query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
  const card = cardRes.rows[0];
  if (!card) return res.status(404).json({ error: 'not found' });

  const priceRes = await query(
    `SELECT price FROM price_history
     WHERE card_id = $1 AND currency = 'USD'
     ORDER BY fetched_at DESC LIMIT 1`,
    [card.id]
  );
  const rawPrice = priceRes.rows[0]?.price ?? null;

  const [services, estimates, probabilities] = await Promise.all([
    query('SELECT * FROM grading_services WHERE active = true ORDER BY grader, fee'),
    query('SELECT * FROM graded_price_estimates WHERE card_id = $1', [card.id]),
    query('SELECT * FROM grade_probabilities WHERE card_id = $1', [card.id]),
  ]);

  const opts = {};
  if (req.query.selling_fee_rate != null) opts.sellingFeeRate = Number(req.query.selling_fee_rate);
  if (req.query.shipping != null) opts.shippingToGrader = Number(req.query.shipping);

  const analysis = analyzeGrading({
    card,
    rawPrice,
    services: services.rows,
    estimates: estimates.rows,
    probabilities: probabilities.rows,
    opts,
  });
  res.json(analysis);
});

// helper: insert an array of price observations
async function storePrices(cardId, prices) {
  for (const p of prices) {
    await query(
      `INSERT INTO price_history (card_id, source, price, currency, price_type)
       VALUES ($1,$2,$3,$4,$5)`,
      [cardId, p.source, p.price, p.currency ?? 'USD', p.price_type ?? null]
    );
  }
}

// ============================================================
// Bundle suggestions
// ============================================================
//   ?max_card_price=5       upper bound on a card's latest_price
//   ?min_bundle_value=15    reject lots below this total
//   ?max_bundle_value=100   cap a single lot at this total
//   ?markup=1.3             suggested_ask = total * markup
//   ?group_by=set|year      grouping strategy
app.get('/api/bundle-suggestions', async (req, res) => {
  // Pull cards that (a) aren't currently on any active/draft/sold listing
  // and (b) have a USD latest_price. Non-USD rows are ignored for
  // consistency with the portfolio math below.
  const { rows } = await query(`
    SELECT c.*,
           ph.price AS latest_price
    FROM cards c
    LEFT JOIN LATERAL (
      SELECT price FROM price_history
      WHERE card_id = c.id AND currency = 'USD'
      ORDER BY fetched_at DESC LIMIT 1
    ) ph ON true
    WHERE ph.price IS NOT NULL
      AND c.id NOT IN (
        SELECT lc.card_id
        FROM listing_cards lc
        JOIN listings l ON l.id = lc.listing_id
        WHERE l.status IN ('draft','active','sold')
      )
  `);

  const opts = {};
  if (req.query.max_card_price != null) opts.maxCardPrice = Number(req.query.max_card_price);
  if (req.query.min_bundle_value != null) opts.minBundleValue = Number(req.query.min_bundle_value);
  if (req.query.max_bundle_value != null) opts.maxBundleValue = Number(req.query.max_bundle_value);
  if (req.query.markup != null) opts.markup = Number(req.query.markup);
  if (req.query.group_by) opts.groupBy = req.query.group_by;

  res.json(suggestBundles(rows, opts));
});

// ============================================================
// Listings + sales
// ============================================================

// helper: hydrate a listing row with its cards
async function hydrateListing(listing) {
  const cards = await query(
    `SELECT c.id, c.name, c.set_name, c.year, c.category, c.cost_basis
     FROM listing_cards lc
     JOIN cards c ON c.id = lc.card_id
     WHERE lc.listing_id = $1`,
    [listing.id]
  );
  return { ...listing, cards: cards.rows };
}

// create a listing (draft by default). Accepts either card_id (single)
// or card_ids (lot). Rejects cards that are already on a live listing.
app.post('/api/listings', async (req, res) => {
  const b = req.body;
  const cardIds = b.card_ids ?? (b.card_id != null ? [b.card_id] : []);
  if (cardIds.length === 0) return res.status(400).json({ error: 'card_ids required' });

  const conflict = await query(
    `SELECT lc.card_id FROM listing_cards lc
     JOIN listings l ON l.id = lc.listing_id
     WHERE l.status IN ('draft','active','sold')
       AND lc.card_id = ANY($1::bigint[])`,
    [cardIds]
  );
  if (conflict.rows.length > 0) {
    return res.status(409).json({
      error: 'one or more cards are already on an existing listing',
      card_ids: conflict.rows.map((r) => r.card_id),
    });
  }

  const { rows } = await query(
    `INSERT INTO listings (marketplace, title, status, ask_price, currency, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      b.marketplace ?? 'ebay',
      b.title ?? null,
      b.status ?? 'draft',
      b.ask_price ?? null,
      b.currency ?? 'USD',
      b.notes ?? null,
    ]
  );
  const listing = rows[0];
  for (const cardId of cardIds) {
    await query(
      'INSERT INTO listing_cards (listing_id, card_id) VALUES ($1,$2)',
      [listing.id, cardId]
    );
  }
  res.status(201).json(await hydrateListing(listing));
});

app.get('/api/listings', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT * FROM listings ${where} ORDER BY created_at DESC`,
    params
  );
  const hydrated = await Promise.all(rows.map(hydrateListing));
  res.json(hydrated);
});

app.get('/api/listings/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM listings WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(await hydrateListing(rows[0]));
});

// Record a sale. Manual path for now; the eBay API integration
// will call this same route (or its logic) with parsed order data.
app.post('/api/listings/:id/mark-sold', async (req, res) => {
  const b = req.body;
  if (b.sold_price == null) return res.status(400).json({ error: 'sold_price required' });
  const { rows } = await query(
    `UPDATE listings
     SET status = 'sold',
         sold_price = $1,
         sold_at = COALESCE($2::timestamptz, now()),
         platform_fees = COALESCE($3, platform_fees),
         shipping_cost = COALESCE($4, shipping_cost),
         external_listing_id = COALESCE($5, external_listing_id),
         updated_at = now()
     WHERE id = $6
     RETURNING *`,
    [
      b.sold_price,
      b.sold_at ?? null,
      b.platform_fees ?? null,
      b.shipping_cost ?? null,
      b.external_listing_id ?? null,
      req.params.id,
    ]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(await hydrateListing(rows[0]));
});

app.delete('/api/listings/:id', async (req, res) => {
  await query('DELETE FROM listings WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// ============================================================
// Portfolio summary
// ============================================================
// Buckets:
//   - active  : owned, not on a live listing
//   - listed  : on a draft/active listing, not yet sold
//   - sold    : on a sold listing
// USD-only for math consistency.
app.get('/api/portfolio/summary', async (_req, res) => {
  // cards labeled by their listing state
  const { rows: cards } = await query(`
    WITH latest AS (
      SELECT DISTINCT ON (card_id) card_id, price, fetched_at
      FROM price_history
      WHERE currency = 'USD'
      ORDER BY card_id, fetched_at DESC
    ),
    card_state AS (
      SELECT c.id,
             c.cost_basis,
             latest.price AS latest_price,
             CASE
               WHEN sold.card_id IS NOT NULL THEN 'sold'
               WHEN live.card_id IS NOT NULL THEN 'listed'
               ELSE 'active'
             END AS state
      FROM cards c
      LEFT JOIN latest ON latest.card_id = c.id
      LEFT JOIN (
        SELECT DISTINCT lc.card_id FROM listing_cards lc
        JOIN listings l ON l.id = lc.listing_id
        WHERE l.status IN ('draft','active')
      ) live ON live.card_id = c.id
      LEFT JOIN (
        SELECT DISTINCT lc.card_id FROM listing_cards lc
        JOIN listings l ON l.id = lc.listing_id
        WHERE l.status = 'sold'
      ) sold ON sold.card_id = c.id
    )
    SELECT state,
           COUNT(*)                                             AS card_count,
           COALESCE(SUM(latest_price), 0)                       AS market_value,
           COALESCE(SUM(cost_basis),   0)                       AS cost_basis
    FROM card_state
    GROUP BY state
  `);

  // sales totals from listings
  const { rows: salesRows } = await query(`
    SELECT COALESCE(SUM(sold_price), 0)                                                AS gross,
           COALESCE(SUM(sold_price - platform_fees - shipping_cost), 0)                AS net,
           COALESCE(SUM(platform_fees), 0)                                             AS fees,
           COALESCE(SUM(shipping_cost), 0)                                             AS shipping,
           COUNT(*) FILTER (WHERE status = 'sold')                                     AS sale_count
    FROM listings
    WHERE status = 'sold'
  `);
  const sales = salesRows[0];

  const buckets = { active: null, listed: null, sold: null };
  for (const r of cards) {
    buckets[r.state] = {
      card_count: Number(r.card_count),
      market_value: Number(r.market_value),
      cost_basis: Number(r.cost_basis),
    };
  }
  for (const k of Object.keys(buckets)) {
    if (!buckets[k]) buckets[k] = { card_count: 0, market_value: 0, cost_basis: 0 };
  }

  const r = (n) => Math.round(n * 100) / 100;
  const totalOwnedMarketValue = buckets.active.market_value + buckets.listed.market_value;
  const totalOwnedCostBasis   = buckets.active.cost_basis   + buckets.listed.cost_basis;
  for (const b of Object.values(buckets)) {
    b.market_value = r(b.market_value);
    b.cost_basis = r(b.cost_basis);
  }

  res.json({
    inventory: buckets,
    sales: {
      count: Number(sales.sale_count),
      gross_revenue: r(Number(sales.gross)),
      platform_fees: r(Number(sales.fees)),
      shipping_cost: r(Number(sales.shipping)),
      net_proceeds:  r(Number(sales.net)),
      cost_basis_of_sold: buckets.sold.cost_basis,
      realized_profit: r(Number(sales.net) - buckets.sold.cost_basis),
    },
    owned: {
      market_value: r(totalOwnedMarketValue),
      cost_basis:   r(totalOwnedCostBasis),
      unrealized_profit: r(totalOwnedMarketValue - totalOwnedCostBasis),
    },
    total_portfolio_value: r(totalOwnedMarketValue + Number(sales.net)),
  });
});

// Variants: return every known printing/parallel for a card by name.
// Powers the "which specific printing did you scan?" picker.
// Query: ?category=pokemon&name=Charizard&set_name=...&card_number=...
app.get('/api/variants', async (req, res) => {
  const { category, name, set_name, card_number } = req.query;
  if (!category || !name) return res.status(400).json({ error: 'category and name required' });

  if (category !== 'pokemon') {
    // Sports variant discovery requires a sports card DB we don't have yet.
    return res.json({ variants: [], note: 'variant discovery is Pokémon-only for now' });
  }

  const q = [`name:"${name}"`];
  if (card_number) q.push(`number:${card_number}`);
  // Deliberately DON'T constrain by set_name here — we want all sets.

  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q.join(' '))}&pageSize=30&orderBy=set.releaseDate`;
  const headers = {};
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;

  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(502).json({ error: `pokemontcg.io ${r.status}` });
    const json = await r.json();
    const variants = (json.data ?? []).map((c) => {
      const tp = c.tcgplayer?.prices;
      const finish = tp ? Object.values(tp)[0] : null;
      return {
        category: 'pokemon',
        name: c.name,
        set_name: c.set?.name ?? null,
        set_series: c.set?.series ?? null,
        card_number: c.number ?? null,
        rarity: c.rarity ?? null,
        year: c.set?.releaseDate ? new Date(c.set.releaseDate).getFullYear() : null,
        external_ids: { pokemontcg_io: c.id },
        image_url: c.images?.small ?? c.images?.large ?? null,
        // Cheap price hint so the picker can show $ next to each variant.
        market_price: finish?.market ?? finish?.mid ?? finish?.low ?? null,
      };
    });
    // Highlight the set_name the user thought they had so it floats first.
    if (set_name) {
      variants.sort((a, b) => {
        const aMatch = a.set_name?.toLowerCase() === String(set_name).toLowerCase() ? 0 : 1;
        const bMatch = b.set_name?.toLowerCase() === String(set_name).toLowerCase() ? 0 : 1;
        return aMatch - bMatch;
      });
    }
    res.json({ variants });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recognition: return candidate cards matching the given hints.
// Body: { category, hints: {name?, set_name?, card_number?}, image? }
// The image param is currently accepted but unused — Ximilar/Google
// Vision providers will consume it when they're added.
app.post('/api/scan', async (req, res) => {
  const { category, hints, image } = req.body ?? {};
  if (!category) return res.status(400).json({ error: 'category required' });
  const candidates = await identifyCard({ category, hints, image });
  res.json({ candidates });
});

// ============================================================
// eBay integration
// ============================================================

// Read-only status: is the app configured, is a token stored, when
// does it expire, which environment are we on.
app.get('/api/ebay/status', async (_req, res) => {
  try {
    res.json(await ebay.status());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Returns the URL the client should redirect the user to for consent.
app.get('/api/ebay/authorize-url', async (req, res) => {
  try {
    const state = req.query.state ? String(req.query.state) : undefined;
    res.json({ url: ebay.authorizeUrl(state) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// eBay redirects the user's browser here with ?code=... after consent.
// We exchange it for tokens, then bounce back to the app frontend.
app.get('/api/ebay/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.status(400).send(`eBay returned error: ${error} — ${error_description ?? ''}`);
  if (!code) return res.status(400).send('missing code');
  try {
    await ebay.exchangeCode(String(code));
    // Bounce the browser back to the frontend. The Expo web dev server
    // is on 8081 in dev; in prod this will be the app's own origin.
    const back = process.env.EBAY_POST_AUTH_REDIRECT ?? 'http://localhost:8081/settings';
    res.redirect(back);
  } catch (e) {
    res.status(500).send(`token exchange failed: ${e.message}`);
  }
});

// Publish a listing to eBay. Uses hydrated cards + listing row.
app.post('/api/listings/:id/publish-ebay', async (req, res) => {
  try {
    const l = await query('SELECT * FROM listings WHERE id = $1', [req.params.id]);
    if (!l.rows[0]) return res.status(404).json({ error: 'listing not found' });
    const cards = await query(
      `SELECT c.* FROM listing_cards lc JOIN cards c ON c.id = lc.card_id WHERE lc.listing_id = $1`,
      [req.params.id]
    );
    const result = await ebay.publishListing({ listing: l.rows[0], cards: cards.rows });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Historical portfolio value: for each day we have data, sum the last
// known USD market price per card as of that day. Powers the sparkline.
app.get('/api/portfolio/timeseries', async (_req, res) => {
  const { rows } = await query(`
    WITH ph AS (
      SELECT card_id, price, fetched_at::date AS d, fetched_at
      FROM price_history
      WHERE currency = 'USD' AND price_type = 'market'
    ),
    days AS (SELECT DISTINCT d FROM ph),
    per_card_per_day AS (
      SELECT c.id AS card_id, days.d,
             (SELECT price FROM ph
               WHERE ph.card_id = c.id AND ph.fetched_at <= days.d + INTERVAL '1 day' - INTERVAL '1 second'
               ORDER BY ph.fetched_at DESC LIMIT 1) AS price
      FROM cards c CROSS JOIN days
    )
    SELECT d, COALESCE(SUM(price), 0) AS value
    FROM per_card_per_day
    GROUP BY d
    ORDER BY d ASC
  `);
  res.json(rows.map((r) => ({ date: r.d, value: Number(r.value) })));
});

const PORT = process.env.PORT || 3000;

// Apply schema, then start listening. Railway injects PORT.
migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Startup migration failed:', err);
    process.exit(1);
  });
