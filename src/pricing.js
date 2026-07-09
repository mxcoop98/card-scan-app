// ============================================================
// Pricing providers. Each provider returns:
//   { prices: [{source, price, currency, price_type}], image_url?, external_ids? }
// The image_url and external_ids are optional metadata harvested
// opportunistically so callers can enrich the card record without
// a second API round-trip.
// Add new providers (tcgplayer, ebay) by following the same shape.
// ============================================================

// --- PokemonTCG.io : free, no key required (higher rate limit with key) ---
// Docs: https://docs.pokemontcg.io
async function pokemonTcgIo(card) {
  const key = card.external_ids?.pokemontcg_io;
  let url;
  if (key) {
    url = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(key)}`;
  } else {
    // fallback: search by name, plus set / number when we have them
    const q = [`name:"${card.name}"`];
    if (card.card_number) q.push(`number:${card.card_number}`);
    if (card.set_name)    q.push(`set.name:"${card.set_name}"`);
    url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q.join(' '))}&pageSize=1`;
  }

  const headers = {};
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`pokemontcg.io ${res.status}`);
  const json = await res.json();
  const c = Array.isArray(json.data) ? json.data[0] : json.data;
  if (!c) return { prices: [] };

  const prices = [];
  const tp = c.tcgplayer?.prices;
  if (tp) {
    const finish = Object.values(tp)[0]; // first available (normal/holofoil/etc)
    if (finish?.market) prices.push({ source: 'tcgplayer_via_ptcgio', price: finish.market, currency: 'USD', price_type: 'market' });
    if (finish?.low)    prices.push({ source: 'tcgplayer_via_ptcgio', price: finish.low,    currency: 'USD', price_type: 'low' });
  }
  const cm = c.cardmarket?.prices;
  if (cm?.averageSellPrice) {
    prices.push({ source: 'cardmarket', price: cm.averageSellPrice, currency: 'EUR', price_type: 'market' });
  }

  return {
    prices,
    image_url: c.images?.small ?? c.images?.large ?? null,
    external_ids: { pokemontcg_io: c.id },
  };
}

// --- Registry: category -> ordered list of providers to try ---
const PROVIDERS = {
  pokemon: [pokemonTcgIo],
  // sports: [ebaySold],  // add in phase 2
};

// Fetch prices + metadata for a card. Merges across providers; the
// first provider that supplies image_url / external_ids wins.
export async function fetchPrices(card) {
  const providers = PROVIDERS[card.category] || [];
  const prices = [];
  let image_url = null;
  let external_ids = null;
  for (const p of providers) {
    try {
      const res = await p(card);
      prices.push(...(res.prices ?? []));
      if (!image_url && res.image_url) image_url = res.image_url;
      if (!external_ids && res.external_ids) external_ids = res.external_ids;
    } catch (err) {
      console.error(`pricing provider failed for card ${card.id}:`, err.message);
    }
  }
  return { prices, image_url, external_ids };
}
