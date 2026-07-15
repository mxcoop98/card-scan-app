// ============================================================
// eBay Sell API integration.
//
// OAuth 2.0 (authorization code grant), then a thin wrapper around
// the Sell / Inventory / Fulfillment APIs.
//
// Everything reads config from env: EBAY_ENV, EBAY_CLIENT_ID,
// EBAY_CLIENT_SECRET, EBAY_REDIRECT_URI, EBAY_SCOPES. Tokens live
// in the ebay_tokens table keyed by environment.
// ============================================================

import { query } from './db.js';
export { query };

const HOSTS = {
  sandbox: {
    auth: 'https://auth.sandbox.ebay.com/oauth2/authorize',
    token: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    api: 'https://api.sandbox.ebay.com',
    listing_prefix: 'https://sandbox.ebay.com/itm/',
  },
  production: {
    auth: 'https://auth.ebay.com/oauth2/authorize',
    token: 'https://api.ebay.com/identity/v1/oauth2/token',
    api: 'https://api.ebay.com',
    listing_prefix: 'https://www.ebay.com/itm/',
  },
};

function env() {
  return (process.env.EBAY_ENV || 'sandbox').toLowerCase();
}
function hosts() {
  const h = HOSTS[env()];
  if (!h) throw new Error(`Unknown EBAY_ENV: ${env()}`);
  return h;
}
function scopes() {
  return (process.env.EBAY_SCOPES || 'https://api.ebay.com/oauth/api_scope').trim();
}
function requireCreds() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  const redirect = process.env.EBAY_REDIRECT_URI;
  if (!id || !secret || !redirect) {
    throw new Error('EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REDIRECT_URI must be set in .env');
  }
  // eBay's OAuth 2.0 uses the RuName as the `redirect_uri` parameter in
  // both authorize and token endpoints — NOT the actual URL. If the user
  // has set EBAY_RUNAME we use it; if not, we fall back to the URL for
  // apps configured that way.
  const runame = process.env.EBAY_RUNAME || redirect;
  return { id, secret, redirect, runame };
}

// ---------- OAuth ----------

// Build the URL the user is redirected to for consent.
export function authorizeUrl(state) {
  const { id, runame } = requireCreds();
  const params = new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: runame,
    scope: scopes(),
    state: state ?? '',
  });
  return `${hosts().auth}?${params.toString()}`;
}

// Exchange authorization code for tokens. Persists them.
export async function exchangeCode(code) {
  const { id, secret, runame } = requireCreds();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: runame,
  });
  const res = await fetch(hosts().token, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  const t = await res.json();
  await persistTokens(t);
  return t;
}

// Get a valid access token, refreshing if expired.
export async function accessToken() {
  const row = await currentTokens();
  if (!row) throw new Error('eBay not connected — POST /api/ebay/authorize-url first');
  const now = Date.now();
  const expires = new Date(row.access_expires_at).getTime();
  if (now < expires - 60_000) return row.access_token;
  return refreshAccessToken(row);
}

async function refreshAccessToken(row) {
  const { id, secret } = requireCreds();
  // Deliberately omit `scope` from the refresh body. eBay reuses the
  // scopes originally granted to this refresh_token. Passing our
  // current env scope list would fail with invalid_scope if the user
  // has added scopes to EBAY_SCOPES since the last consent (which
  // would require a full re-authorize, not just a refresh).
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  });
  const res = await fetch(hosts().token, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`token refresh ${res.status}: ${await res.text()}`);
  const t = await res.json();
  await persistTokens({ ...t, refresh_token: row.refresh_token });
  return t.access_token;
}

async function persistTokens(t) {
  const accessExpiresAt = new Date(Date.now() + (t.expires_in ?? 7200) * 1000);
  const refreshExpiresAt = t.refresh_token_expires_in
    ? new Date(Date.now() + t.refresh_token_expires_in * 1000)
    : null;
  await query(
    `INSERT INTO ebay_tokens (environment, access_token, refresh_token, access_expires_at, refresh_expires_at, scopes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (environment) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, ebay_tokens.refresh_token),
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_expires_at = COALESCE(EXCLUDED.refresh_expires_at, ebay_tokens.refresh_expires_at),
       scopes = EXCLUDED.scopes,
       updated_at = now()`,
    [env(), t.access_token, t.refresh_token, accessExpiresAt, refreshExpiresAt, scopes()]
  );
}

async function currentTokens() {
  const { rows } = await query('SELECT * FROM ebay_tokens WHERE environment = $1', [env()]);
  return rows[0] ?? null;
}

export async function status() {
  const t = await currentTokens();
  return {
    environment: env(),
    connected: !!t,
    access_expires_at: t?.access_expires_at ?? null,
    refresh_expires_at: t?.refresh_expires_at ?? null,
    seller_username: t?.seller_username ?? null,
    configured: !!process.env.EBAY_CLIENT_ID && !!process.env.EBAY_CLIENT_SECRET && !!process.env.EBAY_REDIRECT_URI,
    redirect_uri: process.env.EBAY_REDIRECT_URI ?? null,
    scopes: scopes(),
  };
}

// ---------- Sell API helpers ----------

// One-shot sandbox seller provisioner. Idempotent — safe to run
// repeatedly. Sandbox test users aren't opted into Business Policies
// or given a merchant location by default; this closes those gaps.
// Returns the IDs to plug into env vars for publishListing.
export async function setupSandboxSeller() {
  const result = { steps: [] };
  const step = (name, data, error) => result.steps.push({ name, ...(error ? { error } : { data }) });

  // 1. Opt into Business Policies. If already opted in, eBay returns
  // 409 which we treat as success.
  try {
    await api('POST', '/sell/account/v1/program/get_opted_in_programs', undefined).catch(() => null);
    await api('POST', '/sell/account/v1/program/opt_in', { programType: 'SELLING_POLICY_MANAGEMENT' });
    step('opt_in_business_policies', { opted_in: true });
  } catch (e) {
    // 409 Conflict = already opted in, that's fine
    if (e.message.includes('409') || e.message.toLowerCase().includes('already')) {
      step('opt_in_business_policies', { opted_in: 'already' });
    } else {
      step('opt_in_business_policies', null, e.message);
    }
  }

  // 2. Create a default merchant location. Uses a fixed key so it's idempotent.
  const locationKey = 'default';
  try {
    await api('POST', `/sell/inventory/v1/location/${locationKey}`, {
      location: {
        address: {
          country: 'US',
          postalCode: '10001',
          stateOrProvince: 'NY',
          city: 'New York',
          addressLine1: '123 Main St',
        },
      },
      locationInstructions: 'Card Tracker default warehouse',
      name: 'Card Tracker Default',
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
    });
    step('create_location', { merchantLocationKey: locationKey });
  } catch (e) {
    if (e.message.includes('204') || e.message.includes('409') || e.message.toLowerCase().includes('exist')) {
      step('create_location', { merchantLocationKey: locationKey, existed: true });
    } else {
      step('create_location', null, e.message);
    }
  }

  const marketplaceId = 'EBAY_US';

  // 3a. Fulfillment policy: 3-day handling, USPS Ground Advantage, US only.
  let fulfillmentId = null;
  try {
    const existing = await api('GET', `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`).catch(() => null);
    fulfillmentId = existing?.fulfillmentPolicies?.find((p) => p.name === 'CardTracker Default')?.fulfillmentPolicyId;
    if (!fulfillmentId) {
      const created = await api('POST', `/sell/account/v1/fulfillment_policy`, {
        name: 'CardTracker Default',
        description: 'Default fulfillment for Card Tracker',
        marketplaceId,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        handlingTime: { value: 3, unit: 'DAY' },
        shippingOptions: [
          {
            optionType: 'DOMESTIC',
            costType: 'FLAT_RATE',
            shippingServices: [
              {
                sortOrder: 1,
                shippingCarrierCode: 'USPS',
                shippingServiceCode: 'USPSPriority',
                shippingCost: { value: '4.99', currency: 'USD' },
                additionalShippingCost: { value: '0.99', currency: 'USD' },
                buyerResponsibleForShipping: false,
                freeShipping: false,
              },
            ],
          },
        ],
      });
      fulfillmentId = created.fulfillmentPolicyId;
    }
    step('fulfillment_policy', { fulfillmentPolicyId: fulfillmentId });
  } catch (e) {
    step('fulfillment_policy', null, e.message);
  }

  // 3b. Payment policy: managed payments (immediate payment required).
  let paymentId = null;
  try {
    const existing = await api('GET', `/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`).catch(() => null);
    paymentId = existing?.paymentPolicies?.find((p) => p.name === 'CardTracker Default')?.paymentPolicyId;
    if (!paymentId) {
      const created = await api('POST', `/sell/account/v1/payment_policy`, {
        name: 'CardTracker Default',
        description: 'Default payment for Card Tracker',
        marketplaceId,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        immediatePay: true,
      });
      paymentId = created.paymentPolicyId;
    }
    step('payment_policy', { paymentPolicyId: paymentId });
  } catch (e) {
    step('payment_policy', null, e.message);
  }

  // 3c. Return policy: 30 days, buyer pays return shipping, money back.
  let returnId = null;
  try {
    const existing = await api('GET', `/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`).catch(() => null);
    returnId = existing?.returnPolicies?.find((p) => p.name === 'CardTracker Default')?.returnPolicyId;
    if (!returnId) {
      const created = await api('POST', `/sell/account/v1/return_policy`, {
        name: 'CardTracker Default',
        description: 'Default returns for Card Tracker',
        marketplaceId,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: 'DAY' },
        refundMethod: 'MONEY_BACK',
        returnShippingCostPayer: 'BUYER',
      });
      returnId = created.returnPolicyId;
    }
    step('return_policy', { returnPolicyId: returnId });
  } catch (e) {
    step('return_policy', null, e.message);
  }

  result.env_vars_to_set = {
    EBAY_MERCHANT_LOCATION_KEY: locationKey,
    EBAY_FULFILLMENT_POLICY_ID: fulfillmentId,
    EBAY_PAYMENT_POLICY_ID: paymentId,
    EBAY_RETURN_POLICY_ID: returnId,
  };
  return result;
}

// Fetch the seller's fulfillment, payment, and return policies plus
// merchant locations. Requires sell.account scope. Used to grab IDs
// for the .env config that publishListing needs.
export async function fetchSellerPolicies() {
  const marketplaceId = 'EBAY_US';
  const [fulfillment, payment, ret, locations] = await Promise.all([
    api('GET', `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`).catch((e) => ({ error: e.message })),
    api('GET', `/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`).catch((e) => ({ error: e.message })),
    api('GET', `/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`).catch((e) => ({ error: e.message })),
    api('GET', `/sell/inventory/v1/location`).catch((e) => ({ error: e.message })),
  ]);
  const short = (arr, keyId, keyName) =>
    Array.isArray(arr) ? arr : (arr?.[keyId] ?? []).map((p) => ({ id: p[keyId] ?? p.policyId, name: p[keyName] ?? p.name, description: p.description }));
  return {
    fulfillment_policies: fulfillment.fulfillmentPolicies?.map((p) => ({ id: p.fulfillmentPolicyId, name: p.name, description: p.description })) ?? fulfillment,
    payment_policies:     payment.paymentPolicies?.map((p) => ({ id: p.paymentPolicyId, name: p.name, description: p.description })) ?? payment,
    return_policies:      ret.returnPolicies?.map((p) => ({ id: p.returnPolicyId, name: p.name, description: p.description })) ?? ret,
    merchant_locations:   locations.locations?.map((l) => ({ key: l.merchantLocationKey, name: l.name })) ?? locations,
    hint: 'Copy the IDs and set EBAY_FULFILLMENT_POLICY_ID / EBAY_PAYMENT_POLICY_ID / EBAY_RETURN_POLICY_ID / EBAY_MERCHANT_LOCATION_KEY in Railway.',
  };
}

async function api(method, path, body) {
  const token = await accessToken();
  const res = await fetch(`${hosts().api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ebay ${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// Publish a listing derived from a Card Tracker listing row + its cards.
// Handles both single-card and multi-card lot listings.
export async function publishListing({ listing, cards }) {
  if (!listing) throw new Error('listing required');
  if (!cards || cards.length === 0) throw new Error('listing has no cards');

  const sku = `ct-${listing.id}`;
  const askPrice = listing.ask_price ? Number(listing.ask_price).toFixed(2) : null;
  if (!askPrice) throw new Error('listing.ask_price is required to publish');

  const isLot = cards.length > 1;
  const primary = cards[0];
  // eBay accepts up to 24 image URLs per listing.
  const imageUrls = cards.map((c) => c.image_url).filter(Boolean).slice(0, 24);

  // 1. Create/update the inventory item
  await api('PUT', `/sell/inventory/v1/inventory_item/${sku}`, {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: pickCondition({ isLot, card: primary }),
    product: {
      title: buildTitle(listing, cards),
      description: buildDescription(listing, cards),
      aspects: buildAspects(listing, cards),
      imageUrls,
    },
  });

  // 2. Create an offer for the item
  const offer = await api('POST', `/sell/inventory/v1/offer`, {
    sku,
    marketplaceId: 'EBAY_US',
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    categoryId: pickCategory({ category: primary.category, isLot }),
    pricingSummary: { price: { value: askPrice, currency: 'USD' } },
    listingPolicies: {
      // These IDs come from the seller's Account API. Populate via env
      // vars (see /api/ebay/setup-sandbox-seller).
      fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID ?? '',
      paymentPolicyId:     process.env.EBAY_PAYMENT_POLICY_ID     ?? '',
      returnPolicyId:      process.env.EBAY_RETURN_POLICY_ID      ?? '',
    },
    merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY ?? 'default',
  });

  // 3. Publish the offer → get eBay listing id
  const published = await api('POST', `/sell/inventory/v1/offer/${offer.offerId}/publish`, {});
  const listingId = published.listingId;
  const viewUrl = listingId ? `${hosts().listing_prefix}${listingId}` : null;

  await query(
    `UPDATE listings SET
       ebay_environment = $1,
       ebay_sku = $2,
       ebay_offer_id = $3,
       ebay_listing_id = $4,
       ebay_view_url = $5,
       ebay_last_synced_at = now(),
       external_listing_id = COALESCE(external_listing_id, $4),
       status = 'active',
       updated_at = now()
     WHERE id = $6`,
    [env(), sku, offer.offerId, listingId, viewUrl, listing.id]
  );

  return { sku, offerId: offer.offerId, listingId, viewUrl, is_lot: isLot, card_count: cards.length };
}

function pickCondition({ isLot, card }) {
  // Sell API enums per category. Trading Card Mixed Lots categories
  // reject USED_VERY_GOOD and plain USED (not a valid enum). USED_GOOD
  // is accepted across both single-card and lot categories.
  if (isLot) return 'USED_GOOD';                // mixed lots
  if (card.grader) return 'LIKE_NEW';           // graded singles
  return 'USED_EXCELLENT';                      // raw singles
}

// eBay category IDs. Lots go to Mixed Card Lots, singles to Individual.
function pickCategory({ category, isLot }) {
  if (category === 'pokemon') return isLot ? '183456' : '183454';  // Pokemon Mixed Lots / Individual
  if (category === 'sports')  return isLot ? '261328' : '212';     // Sports Mixed Lots / Singles
  return '183454';
}

// Pull recent orders from eBay's Fulfillment API and mark any matching
// local listing as sold. Idempotent — skips listings already sold.
// Requires sell.fulfillment scope.
export async function syncOrders({ lookbackDays = 30 } = {}) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d+Z$/, 'Z'); // eBay wants ISO without ms
  const path = `/sell/fulfillment/v1/order?filter=${encodeURIComponent(`creationdate:[${since}..]`)}&limit=200`;
  const data = await api('GET', path);
  const orders = data.orders ?? [];
  const result = { checked: orders.length, updated: [], skipped: [], errors: [] };

  for (const order of orders) {
    for (const item of order.lineItems ?? []) {
      const legacyListingId = item.legacyItemId;
      if (!legacyListingId) continue;
      try {
        const { rows } = await query(
          'SELECT * FROM listings WHERE ebay_listing_id = $1',
          [String(legacyListingId)]
        );
        if (rows.length === 0) {
          result.skipped.push({ ebay_listing_id: legacyListingId, reason: 'no local listing' });
          continue;
        }
        const local = rows[0];
        if (local.status === 'sold') {
          result.skipped.push({ id: local.id, ebay_listing_id: legacyListingId, reason: 'already sold' });
          continue;
        }
        const soldPrice = Number(item.lineItemCost?.value ?? order.pricingSummary?.priceSubtotal?.value ?? 0);
        const fees      = Number(order.pricingSummary?.fee?.value ?? 0);
        const shipping  = Number(order.pricingSummary?.deliveryCost?.shippingCost?.value ?? 0);
        await query(
          `UPDATE listings SET
             status = 'sold',
             sold_price = $1,
             sold_at = $2,
             platform_fees = $3,
             shipping_cost = $4,
             external_listing_id = COALESCE(external_listing_id, $5),
             ebay_last_synced_at = now(),
             updated_at = now()
           WHERE id = $6`,
          [soldPrice, order.creationDate, fees, shipping, String(order.orderId ?? legacyListingId), local.id]
        );
        result.updated.push({
          id: local.id,
          ebay_listing_id: legacyListingId,
          sold_price: soldPrice,
          fees,
          shipping,
          order_id: order.orderId,
        });
      } catch (e) {
        result.errors.push({ ebay_listing_id: legacyListingId, error: e.message });
      }
    }
  }
  return result;
}

function buildTitle(listing, cards) {
  // eBay title limit is 80 characters.
  if (cards.length === 1) {
    const c = cards[0];
    const parts = [c.year, c.set_name, c.name, c.card_number, c.grader && `${c.grader} ${c.grade}`]
      .filter(Boolean);
    return parts.join(' ').slice(0, 80);
  }
  // Lot: honor user-supplied title if present, else compose.
  if (listing.title) return listing.title.slice(0, 80);
  const commonSet = allSame(cards, 'set_name') ? cards[0].set_name : null;
  const commonYear = allSame(cards, 'year') ? cards[0].year : null;
  const catLabel = cards[0].category === 'pokemon' ? 'Pokemon' : 'Sports';
  const parts = [commonYear, commonSet, catLabel, 'Card Lot', `(${cards.length} cards)`].filter(Boolean);
  return parts.join(' ').slice(0, 80);
}

function buildDescription(listing, cards) {
  if (cards.length === 1) {
    const card = cards[0];
    return [
      `<h2>${card.name}</h2>`,
      card.set_name && `<p><b>Set:</b> ${card.set_name}</p>`,
      card.card_number && `<p><b>Card #:</b> ${card.card_number}</p>`,
      card.year && `<p><b>Year:</b> ${card.year}</p>`,
      card.grader && `<p><b>Grade:</b> ${card.grader} ${card.grade ?? ''}</p>`,
      listing.notes && `<p>${listing.notes}</p>`,
      `<p>Listed via Card Tracker.</p>`,
    ].filter(Boolean).join('');
  }
  // Lot description: list every card as a line item.
  const items = cards.map((c) => {
    const meta = [c.set_name, c.card_number, c.year].filter(Boolean).join(' · ');
    return `<li><b>${c.name}</b>${meta ? ` — ${meta}` : ''}</li>`;
  }).join('');
  return [
    `<h2>${cards.length}-Card Lot${listing.title ? `: ${listing.title}` : ''}</h2>`,
    `<p>Includes ${cards.length} cards:</p>`,
    `<ul>${items}</ul>`,
    listing.notes && `<p>${listing.notes}</p>`,
    `<p>Listed via Card Tracker.</p>`,
  ].filter(Boolean).join('');
}

function buildAspects(_listing, cards) {
  if (cards.length === 1) return buildSingleAspects(cards[0]);
  return buildLotAspects(cards);
}

function buildSingleAspects(card) {
  const a = {};
  if (card.category === 'pokemon') {
    a['Game']         = ['Pokémon TCG'];
    a['Type']         = ['Individual Card'];
    a['Manufacturer'] = ['The Pokémon Company'];
  } else if (card.category === 'sports') {
    if (card.sport) a['Sport'] = [card.sport];
    a['Type']       = ['Sports Trading Card'];
    if (card.player) a['Player'] = [card.player];
    if (card.team)   a['Team']   = [card.team];
  }
  if (card.year)        a['Year Manufactured'] = [String(card.year)];
  if (card.set_name)    a['Set']               = [card.set_name];
  if (card.name)        a['Character']         = [card.name];
  if (card.card_number) a['Card Number']       = [String(card.card_number)];
  if (card.grader) {
    a['Professional Grader'] = [card.grader];
    a['Graded'] = ['Yes'];
  } else {
    a['Graded'] = ['No'];
  }
  if (card.grade) a['Grade'] = [String(card.grade)];
  a['Vintage']    = card.year && Number(card.year) < 2000 ? ['Yes'] : ['No'];
  a['Features']   = ['Base Set'];
  a['Language']   = ['English'];
  a['Country/Region of Manufacture'] = ['United States'];
  a['Autographed'] = ['No'];
  return a;
}

function buildLotAspects(cards) {
  const a = {};
  const first = cards[0];
  if (first.category === 'pokemon') {
    a['Game']         = ['Pokémon TCG'];
    a['Type']         = ['Card Lot'];
    a['Manufacturer'] = ['The Pokémon Company'];
  } else if (first.category === 'sports') {
    if (first.sport) a['Sport'] = [first.sport];
    a['Type'] = ['Card Lot'];
  }
  // If every card shares a set / year, surface it. Otherwise leave off
  // rather than pick misleading data.
  if (allSame(cards, 'set_name') && first.set_name)  a['Set'] = [first.set_name];
  if (allSame(cards, 'year')     && first.year)      a['Year Manufactured'] = [String(first.year)];
  const anyVintage = cards.some((c) => c.year && Number(c.year) < 2000);
  const allVintage = cards.every((c) => c.year && Number(c.year) < 2000);
  a['Vintage']    = allVintage ? ['Yes'] : anyVintage ? ['Mixed'] : ['No'];
  a['Graded']     = cards.some((c) => c.grader) ? ['Mixed'] : ['No'];
  a['Language']   = ['English'];
  a['Country/Region of Manufacture'] = ['United States'];
  a['Autographed'] = cards.some((c) => c.notes?.toLowerCase().includes('auto')) ? ['Mixed'] : ['No'];
  a['Number of Cards'] = [String(cards.length)];
  return a;
}

function allSame(cards, key) {
  const first = cards[0]?.[key];
  return cards.every((c) => c[key] === first);
}
