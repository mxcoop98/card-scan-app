-- ============================================================
-- Card Tracker schema (PostgreSQL)
-- Core idea: cards live in one table; every price fetch is an
-- immutable timestamped row in price_history. Value-over-time
-- is just: SELECT ... FROM price_history WHERE card_id = ?
-- ============================================================

CREATE TABLE IF NOT EXISTS cards (
    id              BIGSERIAL PRIMARY KEY,
    -- what kind of card
    category        TEXT NOT NULL CHECK (category IN ('pokemon','sports')),
    -- identity
    name            TEXT NOT NULL,          -- "Charizard", "Mike Trout"
    set_name        TEXT,                   -- "Base Set", "2011 Topps Update"
    card_number     TEXT,                   -- "4/102", "US175"
    year            INT,
    -- sports-specific
    player          TEXT,
    team            TEXT,
    sport           TEXT,                   -- baseball, basketball, football...
    -- condition / grading
    condition       TEXT,                   -- "Raw NM", "PSA 9"
    grade           TEXT,                   -- "9", "10", null if raw
    grader          TEXT,                   -- "PSA", "BGS", null if raw
    -- linking to external catalogs so we can refetch prices
    external_ids    JSONB DEFAULT '{}'::jsonb, -- {"tcgplayer": 12345, "pokemontcg_io": "base1-4"}
    -- media
    image_url       TEXT,                   -- stored scan or catalog image
    -- housekeeping
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
CREATE INDEX IF NOT EXISTS idx_cards_name     ON cards(name);

-- Every price observation is one row. Never updated, only inserted.
CREATE TABLE IF NOT EXISTS price_history (
    id              BIGSERIAL PRIMARY KEY,
    card_id         BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,          -- "pokemontcg_io","tcgplayer","ebay_sold"
    price           NUMERIC(12,2) NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'USD',
    price_type      TEXT,                   -- "market","low","mid","last_sold"
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_card_time
    ON price_history(card_id, fetched_at DESC);

-- eBay-style listings. Supports single cards AND lots (via listing_cards).
-- card_id is intentionally NOT on this table — see listing_cards below.
CREATE TABLE IF NOT EXISTS listings (
    id                  BIGSERIAL PRIMARY KEY,
    marketplace         TEXT NOT NULL DEFAULT 'ebay',
    external_listing_id TEXT,                   -- eBay's returned listing/offer id
    title               TEXT,                   -- listing title (helpful for lots)
    status              TEXT NOT NULL DEFAULT 'draft', -- draft, active, sold, ended
    ask_price           NUMERIC(12,2),
    currency            TEXT NOT NULL DEFAULT 'USD',
    -- Sale accounting: filled when a listing moves to 'sold'.
    sold_price          NUMERIC(12,2),
    sold_at             TIMESTAMPTZ,
    platform_fees       NUMERIC(12,2) NOT NULL DEFAULT 0,
    shipping_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migrations for existing dev DBs (idempotent). If the listings table
-- was created by an older schema (with card_id NOT NULL and no sale
-- fields), these bring it forward.
ALTER TABLE listings DROP COLUMN IF EXISTS card_id;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS title         TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_price    NUMERIC(12,2);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_at       TIMESTAMPTZ;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS platform_fees NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS notes         TEXT;

-- Join table so a listing can carry one card (single-item listing)
-- or many cards (a lot). A card can appear on at most one listing
-- at a time — enforced in application logic.
CREATE TABLE IF NOT EXISTS listing_cards (
    listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    card_id    BIGINT NOT NULL REFERENCES cards(id)    ON DELETE CASCADE,
    PRIMARY KEY (listing_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_listing_cards_card ON listing_cards(card_id);

-- Optional acquisition cost so we can compute realized/unrealized P&L.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS cost_basis NUMERIC(12,2);

-- ============================================================
-- eBay integration: one row per environment (sandbox / production)
-- since a seller may connect both. Tokens auto-refresh via the
-- refresh_token; when refresh_token itself expires (18mo), user
-- must re-authorize.
-- ============================================================
CREATE TABLE IF NOT EXISTS ebay_tokens (
    environment       TEXT PRIMARY KEY,       -- 'sandbox' | 'production'
    access_token      TEXT NOT NULL,
    refresh_token     TEXT NOT NULL,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_expires_at TIMESTAMPTZ,
    seller_username   TEXT,
    scopes            TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track eBay-specific state on listings that we've pushed there.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ebay_environment TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ebay_sku         TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ebay_offer_id    TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ebay_listing_id  TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ebay_view_url    TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ebay_last_synced_at TIMESTAMPTZ;

-- ============================================================
-- Grading worthiness: three tables that plug into a shared ROI
-- engine. Data comes from the user for v1; PSA API can populate
-- graded_price_estimates later as source='psa_api' without any
-- schema change.
-- ============================================================

-- Grading service tiers (PSA Value/Regular/Express, BGS, CGC, etc.)
CREATE TABLE IF NOT EXISTS grading_services (
    id                  BIGSERIAL PRIMARY KEY,
    grader              TEXT NOT NULL,        -- "PSA","BGS","CGC"
    tier                TEXT NOT NULL,        -- "Value","Regular","Express"
    fee                 NUMERIC(10,2) NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'USD',
    turnaround_days     INT,
    max_declared_value  NUMERIC(12,2),        -- some tiers cap eligible card value
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (grader, tier)
);

-- Estimated post-grading sale price at a given grade for a given card.
-- Multiple sources allowed (user vs eventually psa_api) via source col.
CREATE TABLE IF NOT EXISTS graded_price_estimates (
    id              BIGSERIAL PRIMARY KEY,
    card_id         BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    grader          TEXT NOT NULL,            -- "PSA","BGS","CGC"
    grade           TEXT NOT NULL,            -- "10","9","8.5"
    estimated_price NUMERIC(12,2) NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'USD',
    source          TEXT NOT NULL DEFAULT 'user',  -- "user","psa_api",...
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (card_id, grader, grade, source)
);

-- Estimated probability the raw copy earns a given grade.
-- Per-card because it depends on the specific copy's condition.
CREATE TABLE IF NOT EXISTS grade_probabilities (
    id              BIGSERIAL PRIMARY KEY,
    card_id         BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    grader          TEXT NOT NULL,
    grade           TEXT NOT NULL,
    probability     NUMERIC(4,3) NOT NULL CHECK (probability >= 0 AND probability <= 1),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (card_id, grader, grade)
);

CREATE INDEX IF NOT EXISTS idx_graded_estimates_card ON graded_price_estimates(card_id);
CREATE INDEX IF NOT EXISTS idx_grade_probs_card      ON grade_probabilities(card_id);

-- Seed common services. Fees are approximate 2026 rates; the user can
-- override in the UI. ON CONFLICT keeps the seed idempotent.
INSERT INTO grading_services (grader, tier, fee, turnaround_days, max_declared_value) VALUES
    ('PSA', 'Value',         25.00, 65,  499.00),
    ('PSA', 'Regular',       75.00, 45, 1499.00),
    ('PSA', 'Express',      150.00, 20, 2499.00),
    ('PSA', 'Super Express',300.00, 10, 4999.00),
    ('BGS', 'Standard',      50.00, 30, NULL),
    ('CGC', 'Bulk',          15.00, 60,  200.00)
ON CONFLICT (grader, tier) DO NOTHING;
