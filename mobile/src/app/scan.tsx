import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { CARD_ASPECT, PhotoSlot } from '@/components/photo-capture';
import { ThemedInput } from '@/components/themed-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type Card, type ScanCandidate, type Variant } from '@/lib/api';

type Stage =
  | { kind: 'input' }
  | { kind: 'searching' }
  | { kind: 'candidates'; candidates: ScanCandidate[]; degraded?: boolean }
  | { kind: 'variants'; base: ScanCandidate; variants: Variant[] };

export default function ScanScreen() {
  const [category, setCategory] = useState<'pokemon' | 'sports'>('pokemon');
  const [name, setCardName] = useState('');
  const [setName, setSet] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);
  const [backPhoto, setBackPhoto] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'input' });
  const [error, setError] = useState<string | null>(null);
  // Set only when the card row was created but a photo upload failed —
  // lets us offer a way through instead of stranding the user.
  const [strandedCardId, setStrandedCardId] = useState<string | null>(null);

  async function search() {
    setError(null);
    setStage({ kind: 'searching' });
    try {
      const res = await api.scan({
        category,
        hints: { name: name || undefined, set_name: setName || undefined, card_number: cardNumber || undefined },
        image: frontPhoto ?? undefined,
      });
      setStage({ kind: 'candidates', candidates: res.candidates, degraded: res.degraded });
    } catch (e: any) {
      setError(e.message);
      setStage({ kind: 'input' });
    }
  }

  async function showVariants(base: ScanCandidate) {
    setError(null);
    setStage({ kind: 'searching' });
    try {
      const res = await api.variants({
        category: base.category,
        name: base.name,
        set_name: base.set_name ?? undefined,
        card_number: base.card_number ?? undefined,
      });
      setStage({ kind: 'variants', base, variants: res.variants });
    } catch (e: any) {
      setError(e.message);
      setStage({ kind: 'candidates', candidates: [base] });
    }
  }

  // Save a matched card, then attach whatever the user photographed.
  // Their own photos win over the catalog image: they show the actual
  // copy's condition, and they're what ends up in the eBay listing. The
  // front can be reverted from the card screen (removing it re-exposes
  // the catalog image on the next price refresh).
  async function save(fields: Partial<Card>) {
    setError(null);
    setStrandedCardId(null);
    const created = await api.createCard(fields).catch((e: any) => {
      setError(e.message);
      return null;
    });
    if (!created) return;

    const sides = [['front', frontPhoto], ['back', backPhoto]] as const;
    for (const [side, uri] of sides) {
      if (!uri) continue;
      try {
        await api.uploadCardImage(created.id, side, uri);
      } catch (e: any) {
        // The card itself is safe — don't navigate away silently, or the
        // failure disappears and the photo is quietly lost.
        setError(`Saved “${created.name}”, but the ${side} photo didn’t upload: ${e.message}`);
        setStrandedCardId(created.id);
        return;
      }
    }
    router.replace({ pathname: '/cards/[id]', params: { id: created.id } });
  }

  const saveFromCandidate = (c: ScanCandidate) =>
    save({
      category: c.category,
      name: c.name,
      set_name: c.set_name,
      card_number: c.card_number,
      year: c.year,
      external_ids: c.external_ids,
      image_url: c.image_url,
    });

  const saveFromVariant = (v: Variant) =>
    save({
      category: v.category,
      name: v.name,
      set_name: v.set_name,
      card_number: v.card_number,
      year: v.year,
      external_ids: v.external_ids,
      image_url: v.image_url,
    });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, paddingBottom: BOTTOM_TAB_HEIGHT + Spacing.four, gap: Spacing.three }}>
          {/* Header row: title + category selector, CollX-style */}
          <ThemedView style={styles.headerRow}>
            <ThemedText type="title">Scan</ThemedText>
            <ThemedView style={styles.categoryRow}>
              <Pressable
                onPress={() => setCategory('pokemon')}
                style={[styles.categoryPill, category === 'pokemon' && styles.categoryPillActive]}>
                <ThemedText type="defaultSemiBold" style={{ fontSize: 13 }}>Pokémon</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setCategory('sports')}
                style={[styles.categoryPill, category === 'sports' && styles.categoryPillActive]}>
                <ThemedText type="defaultSemiBold" style={{ fontSize: 13 }}>Sports</ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>

          {/* Capture area — front is used for matching, back is stored
              with the card (catalogs don't publish a back image). */}
          <ThemedView style={styles.captureArea}>
            <PhotoSlot title="FRONT" uri={frontPhoto} onCapture={setFrontPhoto} onClear={() => setFrontPhoto(null)} />
            <PhotoSlot title="BACK (optional)" uri={backPhoto} onCapture={setBackPhoto} onClear={() => setBackPhoto(null)} />
          </ThemedView>
          <ThemedText type="small" style={{ opacity: 0.6, textAlign: 'center' }}>
            Both photos are saved to the card and used in eBay listings.
          </ThemedText>

          {stage.kind === 'input' && category === 'sports' && (
            <ThemedView type="backgroundElement" style={styles.comingSoon}>
              <ThemedText type="defaultSemiBold">Sports scan — coming soon</ThemedText>
              <ThemedText type="small" style={{ opacity: 0.75 }}>
                Sports card recognition isn&apos;t wired up yet. Unlike Pokémon
                (which has a clean free API), sports pricing needs a data
                source decision — eBay sold-listings, Card Ladder, or
                SportsCardsPro — each with real tradeoffs.
              </ThemedText>
              <ThemedText type="small" style={{ opacity: 0.75 }}>
                Switch back to Pokémon above to try the scan flow.
              </ThemedText>
            </ThemedView>
          )}

          {stage.kind === 'input' && category === 'pokemon' && (
            <>
              <ThemedText type="small" style={{ opacity: 0.7 }}>
                Add any details you can read off the card. Even one field helps a lot.
              </ThemedText>
              <Field label="Name" value={name} onChangeText={setCardName} placeholder="Charizard" />
              <Field label="Set" value={setName} onChangeText={setSet} placeholder="Base Set" />
              <Field label="Card number" value={cardNumber} onChangeText={setCardNumber} placeholder="4/102" />

              {error && <ThemedText style={styles.error}>{error}</ThemedText>}

              <Pressable
                onPress={search}
                disabled={!name && !setName && !cardNumber}
                style={[styles.button, styles.primary, (!name && !setName && !cardNumber) && { opacity: 0.4 }]}>
                <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>Find matches</ThemedText>
              </Pressable>
            </>
          )}

          {stage.kind === 'searching' && (
            <ThemedView style={{ alignItems: 'center', padding: Spacing.four, backgroundColor: 'transparent' }}>
              <ActivityIndicator />
              <ThemedText type="small" style={{ marginTop: Spacing.two, opacity: 0.7 }}>Searching…</ThemedText>
            </ThemedView>
          )}

          {stage.kind === 'candidates' && (
            <>
              <ThemedView style={styles.stageHeader}>
                <ThemedText type="defaultSemiBold">
                  {stage.candidates.length > 0
                    ? `${stage.candidates.length} candidate${stage.candidates.length === 1 ? '' : 's'}`
                    : stage.degraded
                      ? 'Card lookup is having trouble.'
                      : 'No matches — refine your hints.'}
                </ThemedText>
                <Pressable onPress={() => (stage.degraded ? search() : setStage({ kind: 'input' }))}>
                  <ThemedText type="defaultSemiBold" style={{ color: '#4a9eff' }}>
                    {stage.degraded ? 'Try again' : 'Edit hints'}
                  </ThemedText>
                </Pressable>
              </ThemedView>

              {/* A degraded result can still contain partial matches, so say
                  so even when the list isn't empty — the missing card may be
                  the one they were looking for. */}
              {stage.degraded && (
                <ThemedText type="small" style={{ opacity: 0.7 }}>
                  The card catalog didn’t respond in full, so results may be incomplete.
                  Your hints are probably fine — try again in a moment.
                </ThemedText>
              )}

              {stage.candidates.map((c, i) => (
                <ThemedView key={i} type="backgroundElement" style={styles.candidate}>
                  <ThemedView style={styles.candidateRow}>
                    {/* Side-by-side: your scan vs match */}
                    <ThemedView style={styles.compareBox}>
                      <ThemedText type="small" style={{ opacity: 0.6, textAlign: 'center' }}>YOUR SCAN</ThemedText>
                      <ThemedView style={[styles.compareImage, { aspectRatio: CARD_ASPECT }]}>
                        {frontPhoto ? (
                          <Image source={{ uri: frontPhoto }} style={styles.image} contentFit="cover" />
                        ) : (
                          <ThemedView style={styles.placeholder}>
                            <ThemedText type="small" style={{ opacity: 0.5 }}>—</ThemedText>
                          </ThemedView>
                        )}
                      </ThemedView>
                    </ThemedView>
                    <ThemedView style={styles.compareBox}>
                      <ThemedText type="small" style={{ opacity: 0.6, textAlign: 'center' }}>MATCH</ThemedText>
                      <ThemedView style={[styles.compareImage, { aspectRatio: CARD_ASPECT }]}>
                        {c.image_url ? (
                          <Image source={{ uri: c.image_url }} style={styles.image} contentFit="cover" />
                        ) : (
                          <ThemedView style={styles.placeholder}>
                            <ThemedText type="small" style={{ opacity: 0.5 }}>no img</ThemedText>
                          </ThemedView>
                        )}
                      </ThemedView>
                    </ThemedView>
                  </ThemedView>

                  <ThemedText type="defaultSemiBold">{c.name}</ThemedText>
                  <ThemedText type="small">
                    {[c.set_name, c.card_number, c.year].filter(Boolean).join(' · ')}
                  </ThemedText>
                  <ThemedText type="small" style={{ opacity: 0.6 }}>
                    {Math.round(c.confidence * 100)}% · {c.source}
                  </ThemedText>

                  <ThemedView style={styles.candidateActions}>
                    <Pressable onPress={() => saveFromCandidate(c)} style={[styles.button, styles.primary, { flex: 1 }]}>
                      <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>Save this</ThemedText>
                    </Pressable>
                    {c.category === 'pokemon' && (
                      <Pressable onPress={() => showVariants(c)} style={[styles.button, { flex: 1 }]}>
                        <ThemedText type="defaultSemiBold">Show parallels ›</ThemedText>
                      </Pressable>
                    )}
                  </ThemedView>
                </ThemedView>
              ))}
            </>
          )}

          {stage.kind === 'variants' && (
            <>
              <ThemedView style={styles.stageHeader}>
                <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <ThemedText type="defaultSemiBold">Which printing is yours?</ThemedText>
                  <ThemedText type="small" style={{ opacity: 0.7 }}>
                    {stage.variants.length} known variants of “{stage.base.name}”
                  </ThemedText>
                </ThemedView>
                <Pressable onPress={() => setStage({ kind: 'candidates', candidates: [stage.base] })}>
                  <ThemedText type="defaultSemiBold" style={{ color: '#4a9eff' }}>‹ Back</ThemedText>
                </Pressable>
              </ThemedView>

              {stage.variants.length === 0 && (
                <ThemedText type="small" style={{ opacity: 0.7 }}>
                  No variant data. Save the original match instead.
                </ThemedText>
              )}

              {stage.variants.map((v, i) => (
                <Pressable key={i} onPress={() => saveFromVariant(v)}>
                  <ThemedView type="backgroundElement" style={styles.variant}>
                    <ThemedView style={[styles.variantImage, { aspectRatio: CARD_ASPECT }]}>
                      {v.image_url ? (
                        <Image source={{ uri: v.image_url }} style={styles.image} contentFit="cover" />
                      ) : (
                        <ThemedView style={styles.placeholder}>
                          <ThemedText type="small" style={{ opacity: 0.5 }}>—</ThemedText>
                        </ThemedView>
                      )}
                    </ThemedView>
                    <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
                      <ThemedText type="defaultSemiBold">{v.set_name ?? '(unknown set)'}</ThemedText>
                      <ThemedText type="small">
                        {[v.card_number, v.rarity, v.year].filter(Boolean).join(' · ')}
                      </ThemedText>
                      {v.market_price != null && (
                        <ThemedText type="defaultSemiBold" style={{ marginTop: 4 }}>
                          ${v.market_price.toFixed(2)}
                        </ThemedText>
                      )}
                    </ThemedView>
                  </ThemedView>
                </Pressable>
              ))}
            </>
          )}

          {error && stage.kind !== 'input' && <ThemedText style={styles.error}>{error}</ThemedText>}

          {strandedCardId && (
            <Pressable
              onPress={() => router.replace({ pathname: '/cards/[id]', params: { id: strandedCardId } })}
              style={styles.button}>
              <ThemedText type="defaultSemiBold">Open the saved card to retry the photo ›</ThemedText>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <ThemedView style={{ gap: 4, backgroundColor: 'transparent' }}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedInput {...rest} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  categoryRow: { flexDirection: 'row', gap: 6, backgroundColor: 'transparent' },
  categoryPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  categoryPillActive: { borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.15)' },
  captureArea: {
    flexDirection: 'row',
    gap: Spacing.three,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: 'transparent',
  },
  input: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  primary: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  candidate: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  candidateRow: { flexDirection: 'row', gap: Spacing.three, backgroundColor: 'transparent' },
  compareBox: { flex: 1, gap: 4, backgroundColor: 'transparent' },
  compareImage: {
    width: '100%',
    borderRadius: Spacing.two,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  candidateActions: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  variant: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  variantImage: {
    width: 60,
    borderRadius: Spacing.two,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  error: { color: '#ff5555' },
  comingSoon: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
});
