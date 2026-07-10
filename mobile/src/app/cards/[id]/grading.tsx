import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedInput } from '@/components/themed-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  api,
  type GradedEstimate,
  type GradeProbability,
  type GradingAnalysis,
  type GradingService,
} from '@/lib/api';

const KNOWN_GRADERS = ['PSA', 'BGS', 'CGC'];

export default function GradingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [services, setServices] = useState<GradingService[] | null>(null);
  const [estimates, setEstimates] = useState<GradedEstimate[]>([]);
  const [probabilities, setProbabilities] = useState<GradeProbability[]>([]);
  const [analysis, setAnalysis] = useState<GradingAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feeRate, setFeeRate] = useState('0.13');
  const [shipping, setShipping] = useState('10');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [svc, est, prob, an] = await Promise.all([
        api.gradingServices(),
        api.gradedEstimates(id),
        api.gradeProbabilities(id),
        api.gradingAnalysis(id, {
          selling_fee_rate: Number(feeRate) || undefined,
          shipping: Number(shipping) || undefined,
        }),
      ]);
      setServices(svc);
      setEstimates(est);
      setProbabilities(prob);
      setAnalysis(an);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id, feeRate, shipping]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorScreen msg={error} />;
  if (!services || !analysis) return <LoadingScreen />;

  if (analysis.already_graded) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Grading' }} />
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Already graded</ThemedText>
          <ThemedText>
            {analysis.already_graded.grader} {analysis.already_graded.grade}
          </ThemedText>
          <ThemedText type="small">{analysis.note}</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Grading analysis' }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={{ gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="title">Grading analysis</ThemedText>
          <ThemedText type="small">
            Raw {analysis.raw_price != null ? `$${analysis.raw_price.toFixed(2)}` : '(no price yet)'}
            {' · '}
            net raw {analysis.raw_net_after_selling_fees != null ? `$${analysis.raw_net_after_selling_fees.toFixed(2)}` : '—'}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="defaultSemiBold">Assumptions</ThemedText>
            <ThemedView style={styles.paramRow}>
              <ParamInput label="Selling fee %" value={feeRate} onChangeText={setFeeRate} />
              <ParamInput label="Shipping to grader $" value={shipping} onChangeText={setShipping} />
            </ThemedView>
          </ThemedView>

          {KNOWN_GRADERS.map((g) => (
            <GraderSection
              key={g}
              cardId={id}
              grader={g}
              estimates={estimates.filter((e) => e.grader === g)}
              probabilities={probabilities.filter((p) => p.grader === g)}
              onChange={load}
            />
          ))}

          <ThemedText type="defaultSemiBold" style={{ marginTop: Spacing.two }}>Results</ThemedText>
          {analysis.services.map((s, i) => <ServiceResult key={i} r={s} />)}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function GraderSection({
  cardId,
  grader,
  estimates,
  probabilities,
  onChange,
}: {
  cardId: string;
  grader: string;
  estimates: GradedEstimate[];
  probabilities: GradeProbability[];
  onChange: () => Promise<void>;
}) {
  const [grade, setGrade] = useState('');
  const [price, setPrice] = useState('');
  const [prob, setProb] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addBoth() {
    if (!grade) return;
    setBusy(true);
    setErr(null);
    try {
      if (price) {
        await api.addGradedEstimate(cardId, { grader, grade, estimated_price: Number(price) });
      }
      if (prob) {
        await api.addGradeProbability(cardId, { grader, grade, probability: Number(prob) });
      }
      setGrade(''); setPrice(''); setProb('');
      await onChange();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="defaultSemiBold">{grader}</ThemedText>
      {estimates.length === 0 && probabilities.length === 0 && (
        <ThemedText type="small">No data yet.</ThemedText>
      )}
      {estimates.map((e) => {
        const p = probabilities.find((x) => x.grade === e.grade);
        return (
          <ThemedView key={e.id} style={styles.gradeRow}>
            <ThemedText>{grader} {e.grade}</ThemedText>
            <ThemedText type="small">
              ${Number(e.estimated_price).toFixed(2)}
              {p ? ` · ${Math.round(Number(p.probability) * 100)}%` : ' · (no prob.)'}
            </ThemedText>
          </ThemedView>
        );
      })}
      {probabilities
        .filter((p) => !estimates.some((e) => e.grade === p.grade))
        .map((p) => (
          <ThemedView key={p.id} style={styles.gradeRow}>
            <ThemedText>{grader} {p.grade}</ThemedText>
            <ThemedText type="small">
              (no price est.) · {Math.round(Number(p.probability) * 100)}%
            </ThemedText>
          </ThemedView>
        ))}

      <ThemedView style={styles.addRow}>
        <ParamInput label="Grade" value={grade} onChangeText={setGrade} />
        <ParamInput label="Est. $" value={price} onChangeText={setPrice} />
        <ParamInput label="Prob. 0-1" value={prob} onChangeText={setProb} />
      </ThemedView>

      {err && <ThemedText style={styles.error}>{err}</ThemedText>}

      <Pressable
        onPress={addBoth}
        disabled={busy || !grade || (!price && !prob)}
        style={[styles.button, (busy || !grade || (!price && !prob)) && { opacity: 0.4 }]}>
        <ThemedText type="defaultSemiBold">{busy ? 'Adding…' : 'Add row'}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function ServiceResult({ r }: { r: import('@/lib/api').GradingServiceResult }) {
  const badge = badgeFor(r.recommendation, r.skipped);
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.serviceHeader}>
        <ThemedText type="defaultSemiBold">{r.service.grader} {r.service.tier}</ThemedText>
        <ThemedView style={[styles.badge, { backgroundColor: badge.bg }]}>
          <ThemedText type="small" style={{ color: badge.fg }}>{badge.label}</ThemedText>
        </ThemedView>
      </ThemedView>
      <ThemedText type="small">
        Fee ${r.service.fee.toFixed(2)}
        {r.service.turnaround_days != null ? ` · ${r.service.turnaround_days}d` : ''}
        {r.service.max_declared_value != null ? ` · cap $${r.service.max_declared_value.toFixed(2)}` : ''}
      </ThemedText>

      {r.skipped && <ThemedText type="small" style={{ opacity: 0.7 }}>{r.skipped}</ThemedText>}

      {r.expected_net_profit != null && (
        <>
          <ThemedText type="small">
            Expected gross ${r.expected_gross_sale?.toFixed(2)} · net ${r.expected_net_sale?.toFixed(2)}
          </ThemedText>
          <ThemedText type="defaultSemiBold">
            Expected profit ${r.expected_net_profit.toFixed(2)}
            {r.profit_vs_selling_raw != null && ` (vs raw ${r.profit_vs_selling_raw >= 0 ? '+' : ''}$${r.profit_vs_selling_raw.toFixed(2)})`}
          </ThemedText>
        </>
      )}

      {r.warnings && r.warnings.length > 0 && (
        <ThemedView style={{ backgroundColor: 'transparent' }}>
          {r.warnings.map((w, i) => (
            <ThemedText key={i} type="small" style={{ color: '#ffb020' }}>⚠ {w}</ThemedText>
          ))}
        </ThemedView>
      )}
    </ThemedView>
  );
}

function badgeFor(rec?: string, skipped?: string) {
  if (skipped) return { label: 'skipped', bg: 'rgba(127,127,127,0.3)', fg: 'white' };
  switch (rec) {
    case 'grade':      return { label: 'GRADE',        bg: '#1f8f4a', fg: 'white' };
    case 'sell_raw':   return { label: 'sell raw',     bg: '#666', fg: 'white' };
    case 'ineligible': return { label: 'ineligible',   bg: '#8f1f1f', fg: 'white' };
    default:           return { label: rec ?? 'n/a',   bg: '#666', fg: 'white' };
  }
}

function ParamInput({ label, value, onChangeText }: { label: string; value: string; onChangeText: (s: string) => void }) {
  return (
    <ThemedView style={{ flex: 1, minWidth: 80, gap: 4, backgroundColor: 'transparent' }}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        style={styles.input}
      />
    </ThemedView>
  );
}

function LoadingScreen() {
  return <ThemedView style={styles.container}><ActivityIndicator style={{ marginTop: 40 }} /></ThemedView>;
}
function ErrorScreen({ msg }: { msg: string }) {
  return <ThemedView style={styles.container}><ThemedText style={[styles.error, { padding: 20 }]}>{msg}</ThemedText></ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  paramRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, backgroundColor: 'transparent' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, backgroundColor: 'transparent' },
  gradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  input: { paddingHorizontal: Spacing.two, paddingVertical: 6, fontSize: 14 },
  button: {
    padding: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  error: { color: '#ff5555' },
});
