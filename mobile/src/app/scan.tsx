import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type ScanCandidate } from '@/lib/api';

const CARD_ASPECT = 5 / 7;

export default function ScanScreen() {
  const [category, setCategory] = useState<'pokemon' | 'sports'>('pokemon');
  const [name, setCardName] = useState('');
  const [setName, setSet] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [captured, setCaptured] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ScanCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    setCandidates(null);
    try {
      const res = await api.scan({
        category,
        hints: { name: name || undefined, set_name: setName || undefined, card_number: cardNumber || undefined },
        image: captured ?? undefined,
      });
      setCandidates(res.candidates);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickCandidate(c: ScanCandidate) {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createCard({
        category: c.category,
        name: c.name,
        set_name: c.set_name,
        card_number: c.card_number,
        year: c.year,
        external_ids: c.external_ids,
        image_url: c.image_url,
      });
      router.replace({ pathname: '/cards/[id]', params: { id: created.id } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, paddingBottom: BOTTOM_TAB_HEIGHT + Spacing.four, gap: Spacing.three }}>
          <ThemedText type="title">Scan a card</ThemedText>
          <ThemedText type="small" style={{ opacity: 0.7 }}>
            Snap a photo and add hints — we&apos;ll search PokémonTCG.io and let you pick the match.
            Image-based recognition (Ximilar / Vision) plugs in later.
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.captureCard}>
            {captured ? (
              <>
                <Image source={{ uri: captured }} style={styles.preview} contentFit="contain" />
                <Pressable onPress={() => setCaptured(null)} style={styles.button}>
                  <ThemedText type="defaultSemiBold">Retake</ThemedText>
                </Pressable>
              </>
            ) : (
              <CameraCapture onCapture={setCaptured} />
            )}
          </ThemedView>

          <ThemedView style={styles.row}>
            <Pressable
              style={[styles.pill, category === 'pokemon' && styles.pillActive]}
              onPress={() => setCategory('pokemon')}>
              <ThemedText type="defaultSemiBold">Pokémon</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.pill, category === 'sports' && styles.pillActive]}
              onPress={() => setCategory('sports')}>
              <ThemedText type="defaultSemiBold">Sports</ThemedText>
            </Pressable>
          </ThemedView>

          <Field label="Name" value={name} onChangeText={setCardName} placeholder="Charizard" />
          <Field label="Set" value={setName} onChangeText={setSet} placeholder="Base Set" />
          <Field label="Card number" value={cardNumber} onChangeText={setCardNumber} placeholder="4/102" />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable
            onPress={search}
            disabled={busy || (!name && !setName && !cardNumber)}
            style={[styles.button, styles.primary, (busy || (!name && !setName && !cardNumber)) && { opacity: 0.4 }]}>
            <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>
              {busy ? 'Searching…' : 'Find matches'}
            </ThemedText>
          </Pressable>

          {busy && candidates == null && <ActivityIndicator style={{ marginTop: Spacing.three }} />}

          {candidates && (
            <ThemedView style={{ gap: Spacing.three, backgroundColor: 'transparent' }}>
              <ThemedText type="defaultSemiBold">
                {candidates.length === 0
                  ? 'No matches — refine your hints.'
                  : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} — tap to save`}
              </ThemedText>
              {candidates.map((c, i) => (
                <Pressable key={i} onPress={() => pickCandidate(c)} disabled={busy}>
                  <ThemedView type="backgroundElement" style={styles.candidate}>
                    <ThemedView style={[styles.candidateImage, { aspectRatio: CARD_ASPECT }]}>
                      {c.image_url ? (
                        <Image source={{ uri: c.image_url }} style={styles.image} contentFit="cover" />
                      ) : (
                        <ThemedView style={styles.placeholder}>
                          <ThemedText type="small" style={{ opacity: 0.5 }}>no image</ThemedText>
                        </ThemedView>
                      )}
                    </ThemedView>
                    <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
                      <ThemedText type="defaultSemiBold">{c.name}</ThemedText>
                      <ThemedText type="small">
                        {[c.set_name, c.card_number, c.year].filter(Boolean).join(' · ')}
                      </ThemedText>
                      <ThemedView style={styles.confidencePill}>
                        <ThemedText type="small">
                          {Math.round(c.confidence * 100)}% · {c.source}
                        </ThemedText>
                      </ThemedView>
                    </ThemedView>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

// Cross-platform capture. Web: file input (hits phone camera if run
// in mobile browser via capture="environment"). Native: file picker
// stub for now; expo-camera / expo-image-picker slots in when we
// build the mobile app.
function CameraCapture({ onCapture }: { onCapture: (uri: string) => void }) {
  if (Platform.OS === 'web') {
    return (
      <label style={webLabelStyle}>
        <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>
          📷  Capture / choose photo
        </ThemedText>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e: any) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => onCapture(String(reader.result));
            reader.readAsDataURL(f);
          }}
        />
      </label>
    );
  }
  return (
    <ThemedText type="small" style={{ opacity: 0.6, textAlign: 'center', padding: Spacing.four }}>
      Native camera coming — install expo-image-picker and wire onCapture here.
    </ThemedText>
  );
}

const webLabelStyle: any = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 14,
  borderRadius: 12,
  backgroundColor: '#4a9eff',
  cursor: 'pointer',
};

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <ThemedView style={{ gap: 4, backgroundColor: 'transparent' }}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        {...rest}
        placeholderTextColor="#888"
        autoCapitalize={rest.autoCapitalize ?? 'none'}
        style={styles.input}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  captureCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
  },
  preview: { width: 200, height: 280, borderRadius: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  pill: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  pillActive: { borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.15)' },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: 'white',
  },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  primary: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  candidate: {
    flexDirection: 'row',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
    alignItems: 'center',
  },
  candidateImage: {
    width: 70,
    borderRadius: Spacing.two,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  confidencePill: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  error: { color: '#ff5555' },
});
