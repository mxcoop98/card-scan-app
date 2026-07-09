// ============================================================
// Bundle-suggestion engine.
//
// Idea: cheap cards are rarely worth listing individually — the
// fixed selling/shipping cost eats the margin. Group them into
// lots that sell as one listing. We group by a natural key
// (set for Pokémon, year+sport for sports) and first-fit-
// decreasing pack each group into lots that fall in the target
// price band.
// ============================================================

const DEFAULT_MARKUP = 1.3;

function bundleKey(card, groupBy) {
  if (groupBy === 'year') {
    return card.category === 'sports'
      ? `${card.category} / ${card.year ?? 'unknown-year'} / ${card.sport ?? 'unknown-sport'}`
      : `${card.category} / ${card.year ?? 'unknown-year'}`;
  }
  // default: set
  return card.category === 'sports'
    ? `${card.category} / ${card.set_name ?? 'unknown-set'} / ${card.year ?? ''}`
    : `${card.category} / ${card.set_name ?? 'unknown-set'}`;
}

// First-fit-decreasing: sort cards biggest-first, drop each into
// the first lot it fits, otherwise open a new lot. Fast and
// good-enough for the sizes we deal with.
function packLots(cards, maxTotal) {
  const sorted = [...cards].sort((a, b) => b.price - a.price);
  const lots = [];
  for (const c of sorted) {
    let placed = false;
    for (const lot of lots) {
      if (lot.total + c.price <= maxTotal) {
        lot.cards.push(c);
        lot.total += c.price;
        placed = true;
        break;
      }
    }
    if (!placed) lots.push({ cards: [c], total: c.price });
  }
  return lots;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Input: rows of { id, category, set_name, year, sport, name, latest_price }
// Output: candidate lots grouped by key, each within [minTotal, maxTotal].
export function suggestBundles(cards, opts = {}) {
  const maxCardPrice = opts.maxCardPrice ?? 5;
  const minTotal = opts.minBundleValue ?? 15;
  const maxTotal = opts.maxBundleValue ?? 100;
  const markup = opts.markup ?? DEFAULT_MARKUP;
  const groupBy = opts.groupBy ?? 'set';

  const eligible = cards.filter(
    (c) => c.latest_price != null && Number(c.latest_price) > 0 && Number(c.latest_price) <= maxCardPrice
  );

  const groups = {};
  for (const c of eligible) {
    const key = bundleKey(c, groupBy);
    (groups[key] ||= []).push({
      id: c.id,
      name: c.name,
      set_name: c.set_name,
      year: c.year,
      price: Number(c.latest_price),
    });
  }

  const suggestions = [];
  for (const [key, groupCards] of Object.entries(groups)) {
    const lots = packLots(groupCards, maxTotal);
    for (const lot of lots) {
      if (lot.total < minTotal) continue;
      suggestions.push({
        group_key: key,
        card_count: lot.cards.length,
        total_market_value: round(lot.total),
        suggested_ask: round(lot.total * markup),
        markup,
        cards: lot.cards.map((c) => ({ ...c, price: round(c.price) })),
      });
    }
  }

  suggestions.sort((a, b) => b.total_market_value - a.total_market_value);

  return {
    assumptions: {
      max_card_price: maxCardPrice,
      min_bundle_value: minTotal,
      max_bundle_value: maxTotal,
      markup,
      group_by: groupBy,
    },
    eligible_card_count: eligible.length,
    lot_count: suggestions.length,
    lots: suggestions,
  };
}
