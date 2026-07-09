import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { api, type Listing } from '@/lib/api';

const STATUSES: (Listing['status'] | 'all')[] = ['all', 'draft', 'active', 'sold', 'ended'];

export default function ListingsScreen() {
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>('all');
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError(null);
      api.listListings(filter === 'all' ? undefined : filter)
        .then((data) => alive && setRows(data))
        .catch((e) => alive && setError(e.message));
      return () => { alive = false; };
    }, [filter])
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Listings' }} />
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Listings</ThemedText>
        <ThemedView style={styles.filterRow}>
          {STATUSES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setFilter(s)}
              style={[styles.chip, filter === s && styles.chipActive]}>
              <ThemedText type="small">{s}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {rows == null && !error && <ActivityIndicator />}
        {rows && (
          <FlatList
            data={rows}
            keyExtractor={(l) => l.id}
            contentContainerStyle={{ paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two }}
            ListEmptyComponent={
              <ThemedText style={styles.empty}>
                No listings yet. Create one from a bundle suggestion or a card.
              </ThemedText>
            }
            renderItem={({ item }) => <ListingRow listing={item} />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function ListingRow({ listing }: { listing: Listing }) {
  const isSold = listing.status === 'sold';
  const priceLabel = isSold && listing.sold_price
    ? `sold $${Number(listing.sold_price).toFixed(2)}`
    : listing.ask_price != null
    ? `ask $${Number(listing.ask_price).toFixed(2)}`
    : '—';
  const cardsLabel =
    listing.cards.length === 1
      ? listing.cards[0].name
      : `${listing.cards.length} cards`;

  return (
    <Pressable onPress={() => router.push({ pathname: '/listings/[id]', params: { id: listing.id } })}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
          <ThemedText type="defaultSemiBold">
            {listing.title ?? cardsLabel}
          </ThemedText>
          <ThemedText type="small">
            {listing.status} · {cardsLabel} · {listing.marketplace}
          </ThemedText>
        </ThemedView>
        <ThemedText type="defaultSemiBold">{priceLabel}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.three },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: 'transparent' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  chipActive: { borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.15)' },
  row: {
    flexDirection: 'row',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  empty: { textAlign: 'center', marginTop: Spacing.four, opacity: 0.6 },
  error: { color: '#ff5555' },
});
