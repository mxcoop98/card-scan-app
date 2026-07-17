import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { ThemedInput } from '@/components/themed-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type Card } from '@/lib/api';

const CARD_ASPECT = 5 / 7; // trading-card ratio, width/height

export default function CardsScreen() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { width } = useWindowDimensions();

  const cols = width >= 900 ? 5 : width >= 600 ? 4 : 3;
  const gutter = Spacing.two;
  const outerPad = Spacing.four;
  const tileWidth = (width - outerPad * 2 - gutter * (cols - 1)) / cols;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError(null);
      api.listCards()
        .then((data) => alive && setCards(data))
        .catch((e) => alive && setError(e.message));
      return () => { alive = false; };
    }, [])
  );

  const filtered = useMemo(() => {
    if (!cards) return null;
    const q = search.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [c.name, c.set_name, c.player, c.team, c.year && String(c.year)]
        .filter(Boolean).some((s) => (s as string).toLowerCase().includes(q))
    );
  }, [cards, search]);

  const totalValue = useMemo(() => {
    if (!cards) return 0;
    return cards.reduce((a, c) => a + (c.latest_currency === 'USD' && c.latest_price ? Number(c.latest_price) : 0), 0);
  }, [cards]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedView style={styles.header}>
          <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
            <ThemedText type="title">My Collection</ThemedText>
            {cards && (
              <ThemedText type="small">
                {cards.length} cards · ${totalValue.toFixed(2)} value
              </ThemedText>
            )}
          </ThemedView>
          <Pressable onPress={() => router.push('/cards/new')} style={styles.addButton}>
            <ThemedText type="defaultSemiBold">+ Add</ThemedText>
          </Pressable>
        </ThemedView>

        <ThemedView style={styles.demoBanner}>
          <ThemedText type="small" style={styles.demoBannerText}>
            🧪  Demo · shared sandbox — feel free to click around, add cards, break things.
          </ThemedText>
        </ThemedView>

        <ThemedInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search cards…"
          style={styles.search}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {filtered == null && !error && (
          <View style={{ paddingHorizontal: outerPad, gap: gutter, flexDirection: 'row', flexWrap: 'wrap' }}>
            {Array.from({ length: cols * 2 }).map((_, i) => (
              <View key={i} style={{ width: tileWidth }}>
                <Skeleton height={tileWidth / CARD_ASPECT} radius={Spacing.two} />
                <Skeleton width="70%" height={14} radius={4} style={{ marginTop: 8 }} />
                <Skeleton width="50%" height={12} radius={4} style={{ marginTop: 6 }} />
              </View>
            ))}
          </View>
        )}

        {filtered && (
          <FlatList
            key={cols}
            data={filtered}
            keyExtractor={(c) => c.id}
            numColumns={cols}
            columnWrapperStyle={{ gap: gutter }}
            contentContainerStyle={{
              paddingHorizontal: outerPad,
              paddingBottom: BOTTOM_TAB_HEIGHT + Spacing.four,
              gap: gutter,
            }}
            ListEmptyComponent={
              search
                ? <EmptyState icon="search-outline" title="No matches" hint={`Nothing in your collection matches “${search}”.`} />
                : <EmptyState icon="albums-outline" title="No cards yet" hint="Scan a card or add one manually to start tracking value." actionLabel="+ Add card" onAction={() => router.push('/cards/new')} />
            }
            renderItem={({ item }) => <CardTile card={item} width={tileWidth} />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function CardTile({ card, width }: { card: Card; width: number }) {
  const priceText =
    card.latest_price != null
      ? `${card.latest_currency === 'EUR' ? '€' : '$'}${Number(card.latest_price).toFixed(2)}`
      : '—';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/cards/[id]', params: { id: card.id } })}
      style={({ pressed, hovered }: any) => [
        { width, transitionDuration: '120ms', transitionProperty: 'transform, opacity' } as any,
        hovered && { transform: [{ translateY: -2 }] },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
      ]}>
      <ThemedView type="backgroundElement" style={styles.tile}>
        <ThemedView style={[styles.imageBox, { aspectRatio: CARD_ASPECT }]}>
          {card.image_url ? (
            <Image source={{ uri: card.image_url }} style={styles.image} contentFit="cover" />
          ) : (
            <ThemedView style={styles.placeholder}>
              <ThemedText type="small" style={{ opacity: 0.5 }}>no image</ThemedText>
            </ThemedView>
          )}
        </ThemedView>
        <ThemedView style={styles.tileMeta}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>{card.name}</ThemedText>
          <ThemedText type="small" numberOfLines={1}>
            {card.set_name ?? card.category}
          </ThemedText>
          <ThemedText type="defaultSemiBold" style={{ marginTop: 2, color: '#4a9eff' }}>{priceText}</ThemedText>
        </ThemedView>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    backgroundColor: 'transparent',
  },
  addButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  search: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    fontSize: 15,
  },
  demoBanner: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    paddingVertical: 8,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(74,158,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74,158,255,0.3)',
  },
  demoBannerText: { opacity: 0.85 },
  tile: {
    borderRadius: Spacing.three,
    padding: 6,
    gap: 6,
  },
  imageBox: {
    width: '100%',
    borderRadius: Spacing.two,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  image: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  tileMeta: { paddingHorizontal: 4, paddingBottom: 4, backgroundColor: 'transparent' },
  empty: { textAlign: 'center', marginTop: Spacing.four, opacity: 0.6 },
  error: { color: '#ff5555', textAlign: 'center', marginVertical: Spacing.three },
});
