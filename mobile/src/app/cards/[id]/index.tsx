import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type Card, type GradedEstimate, type GradeProbability, type PriceRow } from '@/lib/api';
import { confirm } from '@/lib/confirm';

type Detail = Card & { price_history: PriceRow[] };
type GradeTab = 'RAW' | 'PSA' | 'BGS' | 'SGC';
const GRADE_TABS: GradeTab[] = ['RAW', 'PSA', 'BGS', 'SGC'];

const CARD_ASPECT = 5 / 7;

export default function CardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard] = useState<Detail | null>(null);
  const [estimates, setEstimates] = useState<GradedEstimate[]>([]);
  const [probabilities, setProbabilities] = useState<GradeProbability[]>([]);
  const [tab, setTab] = useState<GradeTab>('RAW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  const imageWidth = Math.min(width * 0.6, 320);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, e, p] = await Promise.all([
        api.getCard(id),
        api.gradedEstimates(id).catch(() => []),
        api.gradeProbabilities(id).catch(() => []),
      ]);
      setCard(c);
      setEstimates(e);
      setProbabilities(p);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    setBusy(true);
    try { await api.refreshPrice(id); await load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function listForSale() {
    if (!card) return;
    setBusy(true);
    try {
      const askDefault = card.latest_price ? Number(card.latest_price) : undefined;
      const listing = await api.createListing({
        card_ids: [id],
        title: card.name ?? `Card ${id}`,
        ask_price: askDefault,
        status: 'draft',
      });
      router.push({ pathname: '/listings/[id]', params: { id: listing.id } });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  function del() {
    confirm('Delete card?', 'This removes the card and its price history.', async () => {
      try { await api.deleteCard(id); router.back(); }
      catch (e: any) { setError(e.message); }
    });
  }

  // Raw view: latest USD from price_history is the headline; other rows are comps.
  const rawView = useMemo(() => {
    if (!card) return { latest: null as PriceRow | null, comps: [] as PriceRow[] };
    const rows = card.price_history.slice().reverse();
    const latest = rows.find((r) => r.currency === 'USD' && r.price_type === 'market')
      ?? rows.find((r) => r.currency === 'USD')
      ?? rows[0]
      ?? null;
    return { latest, comps: rows };
  }, [card]);

  // Graded view: for the selected grader, pull that grader's estimates
  // + probabilities. Big price = the top-grade estimate (highest grade).
  const gradedView = useMemo(() => {
    if (tab === 'RAW') return null;
    const est = estimates.filter((e) => e.grader === tab);
    const probByGrade = new Map(probabilities.filter((p) => p.grader === tab).map((p) => [p.grade, Number(p.probability)]));
    const rows = est
      .map((e) => ({
        grade: e.grade,
        price: Number(e.estimated_price),
        currency: e.currency,
        probability: probByGrade.get(e.grade) ?? null,
        source: e.source,
      }))
      .sort((a, b) => gradeSortKey(b.grade) - gradeSortKey(a.grade));
    const topPrice = rows[0]?.price ?? null;
    return { rows, topPrice };
  }, [tab, estimates, probabilities]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: card?.name ?? 'Card' }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, paddingBottom: BOTTOM_TAB_HEIGHT + Spacing.four, gap: Spacing.three }}>
          <BackRow />

          {!card && !error && (
            <View style={{ gap: Spacing.three, alignItems: 'center' }}>
              <Skeleton width={imageWidth} height={imageWidth / CARD_ASPECT} radius={12} />
              <Skeleton width={160} height={12} radius={4} />
              <Skeleton width={220} height={28} radius={6} />
              <Skeleton width="100%" height={110} radius={12} />
              <Skeleton width="100%" height={180} radius={12} />
            </View>
          )}
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {card && (
            <>
              <ThemedView style={styles.imageRow}>
                <ThemedView style={[styles.imageBox, { width: imageWidth, aspectRatio: CARD_ASPECT }]}>
                  {card.image_url ? (
                    <Image source={{ uri: card.image_url }} style={styles.image} contentFit="contain" />
                  ) : (
                    <ThemedView style={styles.placeholder}>
                      <ThemedText type="small" style={{ opacity: 0.5 }}>no image</ThemedText>
                    </ThemedView>
                  )}
                </ThemedView>
              </ThemedView>

              <ThemedView style={{ backgroundColor: 'transparent', alignItems: 'center', gap: 2 }}>
                <ThemedText type="small">
                  {[card.set_name, card.card_number].filter(Boolean).join(' · ')}
                </ThemedText>
                <ThemedText type="title" style={{ textAlign: 'center' }}>{card.name}</ThemedText>
                {(card.grade || card.condition) && (
                  <ThemedView style={styles.gradeBadge}>
                    <ThemedText type="small">
                      {card.grader ? `${card.grader} ${card.grade}` : card.condition}
                    </ThemedText>
                  </ThemedView>
                )}
              </ThemedView>

              {/* Grade pill selector */}
              <ThemedView style={styles.pillRow}>
                {GRADE_TABS.map((g) => {
                  const active = tab === g;
                  const hasData = g === 'RAW'
                    ? rawView.comps.length > 0
                    : estimates.some((e) => e.grader === g);
                  return (
                    <Pressable
                      key={g}
                      onPress={() => setTab(g)}
                      style={[styles.pill, active && styles.pillActive]}>
                      <ThemedText
                        type="defaultSemiBold"
                        style={{
                          color: active ? 'white' : (hasData ? undefined : 'rgba(127,127,127,0.6)'),
                          fontSize: 13,
                        }}>
                        {g}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ThemedView>

              {/* Big price + comps: source depends on selected pill */}
              {tab === 'RAW' ? (
                <RawView latest={rawView.latest} comps={rawView.comps} costBasis={card.cost_basis} />
              ) : (
                <GradedView grader={tab} view={gradedView!} onAdd={() => router.push({ pathname: '/cards/[id]/grading', params: { id } })} />
              )}

              <ThemedView style={{ gap: Spacing.two, backgroundColor: 'transparent' }}>
                <Pressable onPress={refresh} disabled={busy} style={[styles.button, styles.primary, busy && { opacity: 0.5 }]}>
                  <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>
                    {busy ? 'Refreshing…' : 'Refresh price'}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => router.push({ pathname: '/cards/[id]/grading', params: { id } })}
                  style={styles.button}>
                  <ThemedText type="defaultSemiBold">Grading analysis</ThemedText>
                </Pressable>
                <Pressable onPress={listForSale} disabled={busy} style={[styles.button, busy && { opacity: 0.5 }]}>
                  <ThemedText type="defaultSemiBold">List for sale (draft)</ThemedText>
                </Pressable>
                <Pressable onPress={del} style={[styles.button, styles.destructive]}>
                  <ThemedText type="defaultSemiBold" style={{ color: '#ff5555' }}>Delete card</ThemedText>
                </Pressable>
              </ThemedView>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function RawView({ latest, comps, costBasis }: { latest: PriceRow | null; comps: PriceRow[]; costBasis: string | null }) {
  return (
    <>
      <ThemedView type="backgroundElement" style={styles.priceBox}>
        <ThemedText type="small" style={{ opacity: 0.7 }}>Market value (raw)</ThemedText>
        <ThemedText style={styles.bigPrice}>
          {latest ? `${latest.currency === 'EUR' ? '€' : '$'}${Number(latest.price).toFixed(2)}` : '—'}
        </ThemedText>
        {latest && (
          <ThemedText type="small" style={{ opacity: 0.6 }}>
            {latest.source}
            {latest.price_type ? ` · ${latest.price_type}` : ''}
            {latest.fetched_at ? ` · ${new Date(latest.fetched_at).toLocaleDateString()}` : ''}
          </ThemedText>
        )}
        {costBasis && (
          <ThemedText type="small" style={{ marginTop: Spacing.two }}>
            Cost basis: ${Number(costBasis).toFixed(2)}
          </ThemedText>
        )}
      </ThemedView>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="defaultSemiBold">Recent comps ({comps.length})</ThemedText>
        <ThemedView style={styles.compsHeader}>
          <ThemedText type="small" style={styles.colDate}>Date</ThemedText>
          <ThemedText type="small" style={styles.colSource}>Source</ThemedText>
          <ThemedText type="small" style={styles.colType}>Type</ThemedText>
          <ThemedText type="small" style={styles.colPrice}>Price</ThemedText>
        </ThemedView>
        {comps.length === 0 && <ThemedText type="small">No prices yet. Tap “Refresh price”.</ThemedText>}
        {comps.map((p, i) => (
          <ThemedView key={i} style={styles.compsRow}>
            <ThemedText type="small" style={styles.colDate}>{new Date(p.fetched_at).toLocaleDateString()}</ThemedText>
            <ThemedText type="small" style={styles.colSource} numberOfLines={1}>{p.source.replace('_via_ptcgio', '')}</ThemedText>
            <ThemedText type="small" style={styles.colType}>{p.price_type ?? '—'}</ThemedText>
            <ThemedText type="defaultSemiBold" style={styles.colPrice}>
              {p.currency === 'EUR' ? '€' : '$'}{Number(p.price).toFixed(2)}
            </ThemedText>
          </ThemedView>
        ))}
      </ThemedView>
    </>
  );
}

function GradedView({
  grader,
  view,
  onAdd,
}: {
  grader: GradeTab;
  view: { rows: { grade: string; price: number; currency: string; probability: number | null; source: string }[]; topPrice: number | null };
  onAdd: () => void;
}) {
  const empty = view.rows.length === 0;
  return (
    <>
      <ThemedView type="backgroundElement" style={styles.priceBox}>
        <ThemedText type="small" style={{ opacity: 0.7 }}>Top grade estimate ({grader})</ThemedText>
        <ThemedText style={styles.bigPrice}>
          {view.topPrice != null ? `$${view.topPrice.toFixed(2)}` : '—'}
        </ThemedText>
        <ThemedText type="small" style={{ opacity: 0.6 }}>
          {empty ? 'No estimates yet' : `Highest of ${view.rows.length} grade${view.rows.length === 1 ? '' : 's'}`}
        </ThemedText>
      </ThemedView>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="defaultSemiBold">{grader} estimates ({view.rows.length})</ThemedText>
        {empty ? (
          <>
            <ThemedText type="small" style={{ opacity: 0.7 }}>
              No {grader} price estimates entered for this card yet.
            </ThemedText>
            <Pressable onPress={onAdd} style={[styles.button, styles.primary, { marginTop: Spacing.two }]}>
              <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>Add {grader} estimates ›</ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <ThemedView style={styles.compsHeader}>
              <ThemedText type="small" style={styles.colGrade}>Grade</ThemedText>
              <ThemedText type="small" style={styles.colProb}>Prob.</ThemedText>
              <ThemedText type="small" style={styles.colSource}>Source</ThemedText>
              <ThemedText type="small" style={styles.colPrice}>Est. price</ThemedText>
            </ThemedView>
            {view.rows.map((r, i) => (
              <ThemedView key={i} style={styles.compsRow}>
                <ThemedText type="defaultSemiBold" style={styles.colGrade}>{grader} {r.grade}</ThemedText>
                <ThemedText type="small" style={styles.colProb}>
                  {r.probability != null ? `${Math.round(r.probability * 100)}%` : '—'}
                </ThemedText>
                <ThemedText type="small" style={styles.colSource}>{r.source}</ThemedText>
                <ThemedText type="defaultSemiBold" style={styles.colPrice}>${r.price.toFixed(2)}</ThemedText>
              </ThemedView>
            ))}
          </>
        )}
      </ThemedView>
    </>
  );
}

// Sort grades numerically (10 > 9.5 > 9 > 8), fallback to string compare.
function gradeSortKey(grade: string): number {
  const n = parseFloat(grade);
  return Number.isFinite(n) ? n : -1;
}

function BackRow() {
  return (
    <Pressable onPress={() => router.back()} style={styles.backRow}>
      <ThemedText type="defaultSemiBold">‹ Back</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  backRow: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 6 },
  imageRow: { alignItems: 'center', backgroundColor: 'transparent' },
  imageBox: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  gradeBadge: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
    marginTop: 4,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'transparent',
    justifyContent: 'center',
  },
  pill: {
    paddingHorizontal: Spacing.four,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
    minWidth: 60,
    alignItems: 'center',
  },
  pillActive: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  priceBox: { padding: Spacing.four, borderRadius: Spacing.three, alignItems: 'center', gap: 2 },
  bigPrice: { fontSize: 40, fontWeight: '700', lineHeight: 44 },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  compsHeader: {
    flexDirection: 'row',
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.3)',
    opacity: 0.7,
    backgroundColor: 'transparent',
  },
  compsRow: { flexDirection: 'row', paddingVertical: 6, backgroundColor: 'transparent' },
  colDate:   { flex: 1.4 },
  colSource: { flex: 2 },
  colType:   { flex: 1 },
  colGrade:  { flex: 1.4 },
  colProb:   { flex: 1 },
  colPrice:  { flex: 1, textAlign: 'right' },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  primary: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  destructive: { borderColor: 'rgba(255,85,85,0.5)' },
  error: { color: '#ff5555' },
});
