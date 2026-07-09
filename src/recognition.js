// ============================================================
// Card recognition providers. Mirrors the pricing.js pattern:
// each provider takes { hints, image } → returns an array of
// candidate {category, name, set_name, card_number, year,
// external_ids, image_url, confidence, source} shapes.
//
// v1 provider (pokemonTcgSearch): pure hint-based text search
// against PokemonTCG.io. The image is captured client-side for
// UX / archival but not yet used for matching.
//
// Future providers slot in without changing the API surface:
//   - ximilarTcgId: POST image bytes → card id → lookup
//   - googleVisionLabels: labels → search
//   - ebaySoldMatch: image → visually similar sold listings
// ============================================================

async function pokemonTcgSearch({ hints }) {
  const q = [];
  if (hints.name)        q.push(`name:"${hints.name}"`);
  if (hints.card_number) q.push(`number:${hints.card_number}`);
  if (hints.set_name)    q.push(`set.name:"${hints.set_name}"`);
  if (q.length === 0) return [];

  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q.join(' '))}&pageSize=5&orderBy=set.releaseDate`;
  const headers = {};
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`pokemontcg.io ${res.status}`);
  const json = await res.json();
  const cards = json.data ?? [];

  // Rough confidence: more matching hints → higher score, capped at 0.9
  // for hint-based matching. Real recognition providers should return
  // higher confidence when image-matched.
  const hitFields = ['name', 'card_number', 'set_name'].filter((k) => hints[k]).length;
  const base = 0.4 + 0.2 * hitFields;

  return cards.map((c, i) => ({
    category: 'pokemon',
    name: c.name,
    set_name: c.set?.name ?? null,
    card_number: c.number ?? null,
    year: c.set?.releaseDate ? new Date(c.set.releaseDate).getFullYear() : null,
    external_ids: { pokemontcg_io: c.id },
    image_url: c.images?.small ?? c.images?.large ?? null,
    // First result gets full base, subsequent decay slightly
    confidence: Math.min(0.9, base - i * 0.02),
    source: 'pokemontcg_search',
  }));
}

const PROVIDERS = {
  pokemon: [pokemonTcgSearch],
  // sports: [ebaySoldMatch],  // add when we pick a sports provider
};

// Identify candidates matching the given hints (and image, when a
// provider knows what to do with one). Merges + de-dupes across
// providers, sorts by confidence descending.
export async function identifyCard({ category, hints, image }) {
  const providers = PROVIDERS[category] || [];
  const results = [];
  for (const p of providers) {
    try {
      const candidates = await p({ hints: hints ?? {}, image });
      results.push(...candidates);
    } catch (err) {
      console.error(`recognition provider failed:`, err.message);
    }
  }
  // De-dupe by external_id if present, else by (name, set_name, card_number)
  const seen = new Set();
  const deduped = [];
  for (const c of results) {
    const key = c.external_ids?.pokemontcg_io ?? `${c.name}|${c.set_name}|${c.card_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  deduped.sort((a, b) => b.confidence - a.confidence);
  return deduped;
}
