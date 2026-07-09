import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { api, type BundleLot, type BundleResponse } from '@/lib/api';

export default function BundlesScreen() {
  const [maxCard, setMaxCard] = useState('5');
  const [minBundle, setMinBundle] = useState('15');
  const [maxBundle, setMaxBundle] = useState('50');
  const [markup, setMarkup] = useState('1.3');
  const [data, setData] = useState<BundleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.bundleSuggestions({
        max_card_price: Number(maxCard) || undefined,
        min_bundle_value: Number(minBundle) || undefined,
        max_bundle_value: Number(maxBundle) || undefined,
        markup: Number(markup) || undefined,
      });
      setData(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [maxCard, minBundle, maxBundle, markup]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Bundle suggestions' }} />
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Bundle suggestions</ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedView style={styles.paramRow}>
            <ParamInput label="Max card $" value={maxCard} onChangeText={setMaxCard} />
            <ParamInput label="Min lot $" value={minBundle} onChangeText={setMinBundle} />
            <ParamInput label="Max lot $" value={maxBundle} onChangeText={setMaxBundle} />
            <ParamInput label="Markup" value={markup} onChangeText={setMarkup} />
          </ThemedView>
          <Pressable onPress={() => void load()} disabled={busy} style={[styles.button, busy && { opacity: 0.5 }]}>
            <ThemedText type="defaultSemiBold">{busy ? 'Loading…' : 'Recalculate'}</ThemedText>
          </Pressable>
        </ThemedView>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {data && (
          <ScrollView contentContainerStyle={{ gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.four }}>
            <ThemedText type="small">
              {data.eligible_card_count} eligible cards → {data.lot_count} lot{data.lot_count === 1 ? '' : 's'}
            </ThemedText>
            {data.lots.length === 0 && (
              <ThemedText style={styles.empty}>
                No lots match. Loosen the price band, or add more cheap cards.
              </ThemedText>
            )}
            {data.lots.map((lot, i) => <LotCard key={i} lot={lot} onListed={load} />)}
          </ScrollView>
        )}

        {!data && !error && busy && <ActivityIndicator />}
      </SafeAreaView>
    </ThemedView>
  );
}

function LotCard({ lot, onListed }: { lot: BundleLot; onListed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createListing() {
    setBusy(true);
    setErr(null);
    try {
      const listing = await api.createListing({
        card_ids: lot.cards.map((c) => c.id),
        title: `${lot.group_key} lot (${lot.card_count} cards)`,
        ask_price: lot.suggested_ask,
        status: 'draft',
      });
      onListed();
      router.push({ pathname: '/listings/[id]', params: { id: listing.id } });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.lotHeader}>
        <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
          <ThemedText type="defaultSemiBold">{lot.group_key}</ThemedText>
          <ThemedText type="small">{lot.card_count} cards · market ${lot.total_market_value.toFixed(2)}</ThemedText>
        </ThemedView>
        <ThemedView style={{ alignItems: 'flex-end', backgroundColor: 'transparent' }}>
          <ThemedText type="small">ask</ThemedText>
          <ThemedText type="defaultSemiBold">${lot.suggested_ask.toFixed(2)}</ThemedText>
        </ThemedView>
      </ThemedView>

      <ThemedView style={styles.chipRow}>
        {lot.cards.map((c) => (
          <ThemedView key={c.id} style={styles.chip}>
            <ThemedText type="small">{c.name} · ${c.price.toFixed(2)}</ThemedText>
          </ThemedView>
        ))}
      </ThemedView>

      {err && <ThemedText style={styles.error}>{err}</ThemedText>}

      <Pressable
        onPress={createListing}
        disabled={busy}
        style={[styles.button, styles.primary, busy && { opacity: 0.5 }]}>
        <ThemedText type="defaultSemiBold">{busy ? 'Creating…' : 'Create draft listing'}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function ParamInput({ label, value, onChangeText }: { label: string; value: string; onChangeText: (s: string) => void }) {
  return (
    <ThemedView style={{ flex: 1, minWidth: 90, gap: 4, backgroundColor: 'transparent' }}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        style={styles.input}
        placeholderTextColor="#888"
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  paramRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, backgroundColor: 'transparent' },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    fontSize: 14,
    color: 'white',
  },
  button: {
    padding: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  primary: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  lotHeader: { flexDirection: 'row', backgroundColor: 'transparent' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: 'transparent' },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  empty: { textAlign: 'center', marginTop: Spacing.four, opacity: 0.6 },
  error: { color: '#ff5555' },
});
