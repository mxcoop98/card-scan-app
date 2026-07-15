import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
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
        {rows == null && !error && (
          <View style={{ gap: Spacing.two }}>
            {[0, 1, 2].map((i) => (
              <ThemedView key={i} type="backgroundElement" style={styles.row}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width="70%" height={14} radius={4} />
                  <Skeleton width="50%" height={12} radius={4} />
                </View>
                <Skeleton width={70} height={16} radius={4} />
              </ThemedView>
            ))}
          </View>
        )}
        {rows && (
          <FlatList
            data={rows}
            keyExtractor={(l) => l.id}
            contentContainerStyle={{ paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two }}
            ListEmptyComponent={
              <EmptyState
                icon="pricetag-outline"
                title="No listings yet"
                hint="Create one from a card's detail page, or bundle cheap cards from the Bundles tab."
                actionLabel="Browse cards"
                onAction={() => router.push('/')}
              />
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
  const statusColors: Record<string, string> = {
    draft: '#94a3b8', active: '#4a9eff', sold: '#22c55e', ended: '#94a3b8',
  };
  const statusColor = statusColors[listing.status] ?? '#94a3b8';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/listings/[id]', params: { id: listing.id } })}
      style={({ pressed, hovered }: any) => [
        { transitionDuration: '120ms', transitionProperty: 'transform, opacity' } as any,
        hovered && { transform: [{ translateY: -1 }] },
        pressed && { transform: [{ scale: 0.99 }], opacity: 0.9 },
      ]}>
      <ThemedView type="backgroundElement" style={styles.row}>
        <ThemedView style={{ flex: 1, backgroundColor: 'transparent', gap: 2 }}>
          <ThemedText type="defaultSemiBold">
            {listing.title ?? cardsLabel}
          </ThemedText>
          <ThemedView style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'transparent' }}>
            <ThemedView style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <ThemedText type="small" style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5, color: statusColor }}>
              {listing.status}
            </ThemedText>
            <ThemedText type="small" style={{ opacity: 0.6 }}>· {cardsLabel} · {listing.marketplace}</ThemedText>
          </ThemedView>
        </ThemedView>
        <ThemedText type="defaultSemiBold" style={isSold ? { color: '#22c55e' } : null}>{priceLabel}</ThemedText>
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
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  empty: { textAlign: 'center', marginTop: Spacing.four, opacity: 0.6 },
  error: { color: '#ff5555' },
});
