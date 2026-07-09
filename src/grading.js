// ============================================================
// Grading worthiness ROI engine.
//
// Given a card's raw market price, per-grade sale-price estimates,
// per-grade probabilities, and the set of grading services on offer,
// compute the expected profit of grading vs selling raw.
//
// Pure function — no DB access. The server route loads the inputs
// and passes them in. Same shape a future PSA-API pull would use.
// ============================================================

const DEFAULT_SELLING_FEE_RATE = 0.13;   // eBay-ish blended fees
const DEFAULT_SHIPPING_TO_GRADER = 10;   // one-way; return usually in fee

function round(n) {
  return Math.round(n * 100) / 100;
}

// Analyze one service against one grader's estimates+probabilities.
function analyzeService(service, estimatesByGrade, probabilitiesByGrade, opts) {
  const feeRate = opts.sellingFeeRate;

  const scenarios = [];
  let expectedGrossSale = 0;
  let probabilityCoverage = 0;
  let maxEstimatedPrice = 0;

  for (const [grade, prob] of Object.entries(probabilitiesByGrade)) {
    const price = estimatesByGrade[grade];
    if (price == null) continue;
    probabilityCoverage += prob;
    expectedGrossSale += prob * price;
    if (price > maxEstimatedPrice) maxEstimatedPrice = price;
    scenarios.push({
      grade,
      probability: prob,
      estimated_sale: round(price),
      net_after_selling_fees: round(price * (1 - feeRate)),
    });
  }

  if (scenarios.length === 0) return null;

  const expectedNetSale = expectedGrossSale * (1 - feeRate);
  const totalCosts = Number(service.fee) + opts.shippingToGrader;
  const expectedProfit = expectedNetSale - totalCosts;

  const warnings = [];
  if (Math.abs(probabilityCoverage - 1) > 0.02) {
    warnings.push(
      `Probabilities cover ${round(probabilityCoverage * 100)}% (expected ~100%). Add or normalize grade probabilities.`
    );
  }
  if (service.max_declared_value != null && maxEstimatedPrice > Number(service.max_declared_value)) {
    warnings.push(
      `Highest grade estimate ($${round(maxEstimatedPrice)}) exceeds ${service.grader} ${service.tier} declared-value cap ($${service.max_declared_value}). Ineligible.`
    );
  }

  return {
    service: {
      id: service.id,
      grader: service.grader,
      tier: service.tier,
      fee: Number(service.fee),
      turnaround_days: service.turnaround_days,
      max_declared_value: service.max_declared_value != null ? Number(service.max_declared_value) : null,
    },
    scenarios: scenarios.sort((a, b) => b.probability - a.probability),
    probability_coverage: round(probabilityCoverage),
    expected_gross_sale: round(expectedGrossSale),
    expected_net_sale: round(expectedNetSale),
    grading_fee: Number(service.fee),
    shipping_to_grader: opts.shippingToGrader,
    expected_net_profit: round(expectedProfit),
    warnings,
  };
}

// Top-level: for each service, run the analysis and compare against
// the "sell raw today" alternative.
export function analyzeGrading({ card, rawPrice, services, estimates, probabilities, opts }) {
  const sellingFeeRate = opts?.sellingFeeRate ?? DEFAULT_SELLING_FEE_RATE;
  const shippingToGrader = opts?.shippingToGrader ?? DEFAULT_SHIPPING_TO_GRADER;
  const analysisOpts = { sellingFeeRate, shippingToGrader };

  // If the card is already graded, refuse — question doesn't apply.
  if (card.grade) {
    return {
      card_id: card.id,
      already_graded: { grader: card.grader, grade: card.grade },
      services: [],
      note: 'Card already has a grade; grading analysis does not apply.',
    };
  }

  const rawNet = rawPrice != null ? Number(rawPrice) * (1 - sellingFeeRate) : null;

  // Group estimates + probabilities by grader for O(services) lookup.
  const estByGrader = {};
  for (const e of estimates) {
    const bucket = (estByGrader[e.grader] ||= {});
    bucket[e.grade] = Number(e.estimated_price);
  }
  const probByGrader = {};
  for (const p of probabilities) {
    const bucket = (probByGrader[p.grader] ||= {});
    bucket[p.grade] = Number(p.probability);
  }

  const results = [];
  for (const service of services) {
    const ests = estByGrader[service.grader];
    const probs = probByGrader[service.grader];
    if (!ests || !probs) {
      results.push({
        service: {
          id: service.id,
          grader: service.grader,
          tier: service.tier,
          fee: Number(service.fee),
        },
        skipped: !ests
          ? `No graded price estimates for ${service.grader}. Add some via POST /api/cards/${card.id}/graded-estimates`
          : `No grade probabilities for ${service.grader}. Add some via POST /api/cards/${card.id}/grade-probabilities`,
      });
      continue;
    }

    const analysis = analyzeService(service, ests, probs, analysisOpts);
    if (!analysis) {
      results.push({
        service: { id: service.id, grader: service.grader, tier: service.tier, fee: Number(service.fee) },
        skipped: 'No overlap between graded price estimates and grade probabilities.',
      });
      continue;
    }

    const profitVsRaw = rawNet != null ? analysis.expected_net_profit - rawNet : null;
    results.push({
      ...analysis,
      profit_vs_selling_raw: profitVsRaw != null ? round(profitVsRaw) : null,
      recommendation:
        analysis.warnings.some((w) => w.includes('Ineligible'))
          ? 'ineligible'
          : profitVsRaw == null
          ? 'insufficient_data'
          : profitVsRaw > 0
          ? 'grade'
          : 'sell_raw',
    });
  }

  // Sort so actionable recommendations bubble up: grade > sell_raw >
  // ineligible > insufficient_data > skipped. Within a bucket, higher
  // profit-vs-raw wins.
  const priority = { grade: 0, sell_raw: 1, ineligible: 2, insufficient_data: 3 };
  results.sort((a, b) => {
    const ap = a.recommendation ? priority[a.recommendation] ?? 4 : 5;
    const bp = b.recommendation ? priority[b.recommendation] ?? 4 : 5;
    if (ap !== bp) return ap - bp;
    const av = a.profit_vs_selling_raw ?? -Infinity;
    const bv = b.profit_vs_selling_raw ?? -Infinity;
    return bv - av;
  });

  return {
    card_id: card.id,
    raw_price: rawPrice != null ? Number(rawPrice) : null,
    raw_net_after_selling_fees: rawNet != null ? round(rawNet) : null,
    assumptions: {
      selling_fee_rate: sellingFeeRate,
      shipping_to_grader: shippingToGrader,
    },
    services: results,
  };
}
