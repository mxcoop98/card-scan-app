import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type Card, type PriceRow } from '@/lib/api';
import { confirm } from '@/lib/confirm';

type Detail = Card & { price_history: PriceRow[] };

const CARD_ASPECT = 5 / 7;

export default function CardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  const imageWidth = Math.min(width * 0.6, 320);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCard(await api.getCard(id));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      await api.refreshPrice(id);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function del() {
    confirm('Delete card?', 'This removes the card and its price history.', async () => {
      try {
        await api.deleteCard(id);
        router.back();
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  // Latest USD price becomes the headline; other rows populate the comps table.
  const [latestUsd, comps] = useMemo(() => {
    if (!card) return [null as PriceRow | null, [] as PriceRow[]];
    const rows = card.price_history.slice().reverse();
    const usd = rows.find((r) => r.currency === 'USD' && r.price_type === 'market')
      ?? rows.find((r) => r.currency === 'USD')
      ?? rows[0]
      ?? null;
    return [usd, rows];
  }, [card]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: card?.name ?? 'Card' }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, paddingBottom: BOTTOM_TAB_HEIGHT + Spacing.four, gap: Spacing.three }}>
          <BackRow />

          {!card && !error && <ActivityIndicator />}
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

              <ThemedView type="backgroundElement" style={styles.priceBox}>
                <ThemedText type="small" style={{ opacity: 0.7 }}>Market value</ThemedText>
                <ThemedText style={styles.bigPrice}>
                  {latestUsd
                    ? `${latestUsd.currency === 'EUR' ? '€' : '$'}${Number(latestUsd.price).toFixed(2)}`
                    : '—'}
                </ThemedText>
                {latestUsd && (
                  <ThemedText type="small" style={{ opacity: 0.6 }}>
                    {latestUsd.source}
                    {latestUsd.price_type ? ` · ${latestUsd.price_type}` : ''}
                    {latestUsd.fetched_at ? ` · ${new Date(latestUsd.fetched_at).toLocaleDateString()}` : ''}
                  </ThemedText>
                )}
                {card.cost_basis && (
                  <ThemedText type="small" style={{ marginTop: Spacing.two }}>
                    Cost basis: ${Number(card.cost_basis).toFixed(2)}
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
                {comps.length === 0 && (
                  <ThemedText type="small">No prices yet. Tap “Refresh price”.</ThemedText>
                )}
                {comps.map((p, i) => (
                  <ThemedView key={i} style={styles.compsRow}>
                    <ThemedText type="small" style={styles.colDate}>
                      {new Date(p.fetched_at).toLocaleDateString()}
                    </ThemedText>
                    <ThemedText type="small" style={styles.colSource} numberOfLines={1}>
                      {p.source.replace('_via_ptcgio', '')}
                    </ThemedText>
                    <ThemedText type="small" style={styles.colType}>{p.price_type ?? '—'}</ThemedText>
                    <ThemedText type="defaultSemiBold" style={styles.colPrice}>
                      {p.currency === 'EUR' ? '€' : '$'}{Number(p.price).toFixed(2)}
                    </ThemedText>
                  </ThemedView>
                ))}
              </ThemedView>

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
