// Thin fetch wrapper around the Card Tracker backend. Everything the
// UI needs to know about the API lives here so screens stay dumb.

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type Card = {
  id: string;
  category: 'pokemon' | 'sports';
  name: string;
  set_name: string | null;
  card_number: string | null;
  year: number | null;
  player: string | null;
  team: string | null;
  sport: string | null;
  condition: string | null;
  grade: string | null;
  grader: string | null;
  external_ids: Record<string, unknown>;
  image_url: string | null;
  notes: string | null;
  cost_basis: string | null;
  created_at: string;
  updated_at: string;
  latest_price?: string | null;
  latest_currency?: string | null;
  latest_price_at?: string | null;
};

export type PriceRow = {
  source: string;
  price: string;
  currency: string;
  price_type: string | null;
  fetched_at: string;
};

export type PortfolioSummary = {
  inventory: {
    active: { card_count: number; market_value: number; cost_basis: number };
    listed: { card_count: number; market_value: number; cost_basis: number };
    sold: { card_count: number; market_value: number; cost_basis: number };
  };
  sales: {
    count: number;
    gross_revenue: number;
    platform_fees: number;
    shipping_cost: number;
    net_proceeds: number;
    cost_basis_of_sold: number;
    realized_profit: number;
  };
  owned: { market_value: number; cost_basis: number; unrealized_profit: number };
  total_portfolio_value: number;
};

export type BundleLot = {
  group_key: string;
  card_count: number;
  total_market_value: number;
  suggested_ask: number;
  markup: number;
  cards: { id: string; name: string; set_name: string | null; year: number | null; price: number }[];
};

export type BundleResponse = {
  assumptions: {
    max_card_price: number;
    min_bundle_value: number;
    max_bundle_value: number;
    markup: number;
    group_by: string;
  };
  eligible_card_count: number;
  lot_count: number;
  lots: BundleLot[];
};

export type Listing = {
  id: string;
  marketplace: string;
  external_listing_id: string | null;
  title: string | null;
  status: 'draft' | 'active' | 'sold' | 'ended';
  ask_price: string | null;
  currency: string;
  sold_price: string | null;
  sold_at: string | null;
  platform_fees: string;
  shipping_cost: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  ebay_environment: string | null;
  ebay_sku: string | null;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  ebay_view_url: string | null;
  ebay_last_synced_at: string | null;
  cards: {
    id: string;
    name: string;
    set_name: string | null;
    year: number | null;
    category: 'pokemon' | 'sports';
    cost_basis: string | null;
  }[];
};

export type GradingService = {
  id: string;
  grader: string;
  tier: string;
  fee: string;
  currency: string;
  turnaround_days: number | null;
  max_declared_value: string | null;
  active: boolean;
};

export type GradedEstimate = {
  id: string;
  card_id: string;
  grader: string;
  grade: string;
  estimated_price: string;
  currency: string;
  source: string;
  notes: string | null;
  created_at: string;
};

export type GradeProbability = {
  id: string;
  card_id: string;
  grader: string;
  grade: string;
  probability: string;
  notes: string | null;
  created_at: string;
};

export type GradingScenario = {
  grade: string;
  probability: number;
  estimated_sale: number;
  net_after_selling_fees: number;
};

export type GradingServiceResult = {
  service: {
    id: string;
    grader: string;
    tier: string;
    fee: number;
    turnaround_days?: number | null;
    max_declared_value?: number | null;
  };
  scenarios?: GradingScenario[];
  probability_coverage?: number;
  expected_gross_sale?: number;
  expected_net_sale?: number;
  grading_fee?: number;
  shipping_to_grader?: number;
  expected_net_profit?: number;
  warnings?: string[];
  profit_vs_selling_raw?: number | null;
  recommendation?: 'grade' | 'sell_raw' | 'ineligible' | 'insufficient_data';
  skipped?: string;
};

export type GradingAnalysis = {
  card_id: string;
  raw_price: number | null;
  raw_net_after_selling_fees: number | null;
  assumptions: { selling_fee_rate: number; shipping_to_grader: number };
  services: GradingServiceResult[];
  already_graded?: { grader: string; grade: string };
  note?: string;
};

export type ScanCandidate = {
  category: 'pokemon' | 'sports';
  name: string;
  set_name: string | null;
  card_number: string | null;
  year: number | null;
  external_ids: Record<string, string>;
  image_url: string | null;
  confidence: number;
  source: string;
};

export type Variant = {
  category: 'pokemon' | 'sports';
  name: string;
  set_name: string | null;
  set_series: string | null;
  card_number: string | null;
  rarity: string | null;
  year: number | null;
  external_ids: Record<string, string>;
  image_url: string | null;
  market_price: number | null;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export const api = {
  // cards
  listCards: () => req<Card[]>('/api/cards'),
  getCard: (id: string) => req<Card & { price_history: PriceRow[] }>(`/api/cards/${id}`),
  createCard: (body: Partial<Card>) =>
    req<Card>('/api/cards', { method: 'POST', body: JSON.stringify(body) }),
  patchCard: (id: string, body: Partial<Card>) =>
    req<Card>(`/api/cards/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  refreshPrice: (id: string) =>
    req<{ inserted: number }>(`/api/cards/${id}/refresh-price`, { method: 'POST' }),
  deleteCard: (id: string) => req<void>(`/api/cards/${id}`, { method: 'DELETE' }),

  // portfolio
  portfolio: () => req<PortfolioSummary>('/api/portfolio/summary'),
  portfolioTimeseries: () => req<{ date: string; value: number }[]>('/api/portfolio/timeseries'),

  // bundles
  bundleSuggestions: (params: {
    max_card_price?: number;
    min_bundle_value?: number;
    max_bundle_value?: number;
    markup?: number;
    group_by?: 'set' | 'year';
  }) => req<BundleResponse>(`/api/bundle-suggestions${qs(params)}`),

  // listings
  listListings: (status?: Listing['status']) =>
    req<Listing[]>(`/api/listings${qs({ status })}`),
  getListing: (id: string) => req<Listing>(`/api/listings/${id}`),
  createListing: (body: {
    card_ids: string[];
    title?: string;
    ask_price?: number;
    status?: Listing['status'];
    marketplace?: string;
    notes?: string;
  }) => req<Listing>('/api/listings', { method: 'POST', body: JSON.stringify(body) }),
  markSold: (
    id: string,
    body: {
      sold_price: number;
      platform_fees?: number;
      shipping_cost?: number;
      external_listing_id?: string;
      sold_at?: string;
    }
  ) => req<Listing>(`/api/listings/${id}/mark-sold`, { method: 'POST', body: JSON.stringify(body) }),
  deleteListing: (id: string) => req<void>(`/api/listings/${id}`, { method: 'DELETE' }),

  // grading
  gradingServices: () => req<GradingService[]>('/api/grading-services'),
  gradedEstimates: (cardId: string) =>
    req<GradedEstimate[]>(`/api/cards/${cardId}/graded-estimates`),
  addGradedEstimate: (
    cardId: string,
    body: { grader: string; grade: string; estimated_price: number; notes?: string }
  ) =>
    req<GradedEstimate>(`/api/cards/${cardId}/graded-estimates`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteGradedEstimate: (id: string) =>
    req<void>(`/api/graded-estimates/${id}`, { method: 'DELETE' }),
  gradeProbabilities: (cardId: string) =>
    req<GradeProbability[]>(`/api/cards/${cardId}/grade-probabilities`),
  addGradeProbability: (
    cardId: string,
    body: { grader: string; grade: string; probability: number; notes?: string }
  ) =>
    req<GradeProbability>(`/api/cards/${cardId}/grade-probabilities`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteGradeProbability: (id: string) =>
    req<void>(`/api/grade-probabilities/${id}`, { method: 'DELETE' }),
  gradingAnalysis: (cardId: string, params?: { selling_fee_rate?: number; shipping?: number }) =>
    req<GradingAnalysis>(`/api/cards/${cardId}/grading-analysis${qs(params ?? {})}`),

  // recognition
  scan: (body: {
    category: 'pokemon' | 'sports';
    hints?: { name?: string; set_name?: string; card_number?: string };
    image?: string;
  }) => req<{ candidates: ScanCandidate[] }>('/api/scan', { method: 'POST', body: JSON.stringify(body) }),
  variants: (params: {
    category: 'pokemon' | 'sports';
    name: string;
    set_name?: string;
    card_number?: string;
  }) => req<{ variants: Variant[]; note?: string }>(`/api/variants${qs(params)}`),

  // eBay
  ebayStatus: () => req<EbayStatus>('/api/ebay/status'),
  ebayAuthorizeUrl: (state?: string) => req<{ url: string }>(`/api/ebay/authorize-url${qs({ state })}`),
  publishToEbay: (listingId: string) =>
    req<{ sku: string; offerId: string; listingId: string; viewUrl: string }>(
      `/api/listings/${listingId}/publish-ebay`,
      { method: 'POST' }
    ),
};

export type EbayStatus = {
  environment: 'sandbox' | 'production';
  connected: boolean;
  access_expires_at: string | null;
  refresh_expires_at: string | null;
  seller_username: string | null;
  configured: boolean;
  redirect_uri: string | null;
  scopes: string;
};
