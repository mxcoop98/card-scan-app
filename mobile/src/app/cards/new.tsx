import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedInput } from '@/components/themed-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

export default function NewCard() {
  const [category, setCategory] = useState<'pokemon' | 'sports'>('pokemon');
  const [name, setCardName] = useState('');
  const [setName, setSetName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [pokemonTcgId, setPokemonTcgId] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: any = {
        category,
        name,
        set_name: setName || null,
        card_number: cardNumber || null,
        cost_basis: costBasis ? Number(costBasis) : null,
        external_ids: pokemonTcgId ? { pokemontcg_io: pokemonTcgId } : {},
      };
      const created = await api.createCard(body);
      router.replace({ pathname: '/cards/[id]', params: { id: created.id } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Add card' }} />
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Add card</ThemedText>

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

        <Field label="Name *" value={name} onChangeText={setCardName} placeholder="Charizard" />
        <Field label="Set" value={setName} onChangeText={setSetName} placeholder="Base Set" />
        <Field label="Card number" value={cardNumber} onChangeText={setCardNumber} placeholder="4/102" />
        {category === 'pokemon' && (
          <Field
            label="pokemontcg.io ID"
            value={pokemonTcgId}
            onChangeText={setPokemonTcgId}
            placeholder="base1-4"
          />
        )}
        <Field
          label="Cost basis (USD)"
          value={costBasis}
          onChangeText={setCostBasis}
          placeholder="12.50"
          keyboardType="decimal-pad"
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable
          onPress={submit}
          disabled={busy || !name}
          style={[styles.submit, (busy || !name) && { opacity: 0.4 }]}>
          <ThemedText type="defaultSemiBold">
            {busy ? 'Saving…' : 'Save card'}
          </ThemedText>
        </Pressable>
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
  safeArea: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  pill: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  pillActive: { borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.15)' },
  input: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  submit: {
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    backgroundColor: '#4a9eff',
  },
  error: { color: '#ff5555' },
});
