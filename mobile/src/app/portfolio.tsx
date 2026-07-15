import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { Skeleton } from '@/components/skeleton';
import { Sparkline } from '@/components/sparkline';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type PortfolioSummary } from '@/lib/api';

export default function PortfolioScreen() {
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [series, setSeries] = useState<{ date: string; value: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError(null);
      Promise.all([api.portfolio(), api.portfolioTimeseries()])
        .then(([d, s]) => {
          if (!alive) return;
          setData(d); setSeries(s);
        })
        .catch((e) => alive && setError(e.message));
      return () => { alive = false; };
    }, [])
  );

  const change = seriesChange(series);
  const sparkWidth = Math.min(width - Spacing.four * 2 - Spacing.three * 2, 260);
  const sparkColor = change?.pos === false ? '#ef4444' : '#22c55e';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.four, gap: Spacing.three, paddingBottom: BOTTOM_TAB_HEIGHT + Spacing.four }}>
          <ThemedText type="title">Portfolio</ThemedText>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {!data && !error && (
            <View style={{ gap: Spacing.three }}>
              <ThemedView type="backgroundElement" style={styles.hero}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width={100} height={12} radius={4} />
                  <Skeleton width={180} height={36} radius={6} />
                  <Skeleton width={140} height={12} radius={4} />
                </View>
                <Skeleton width={140} height={64} radius={6} />
              </ThemedView>
              {[0, 1, 2].map((i) => (
                <ThemedView key={i} type="backgroundElement" style={styles.card}>
                  <Skeleton width={100} height={14} radius={4} />
                  <Skeleton width="80%" height={12} radius={4} />
                  <Skeleton width="60%" height={12} radius={4} />
                </ThemedView>
              ))}
            </View>
          )}

          {data && (
            <>
              <ThemedView type="backgroundElement" style={styles.hero}>
                <ThemedView style={{ flex: 1, backgroundColor: 'transparent', gap: 2 }}>
                  <ThemedText type="small" style={{ opacity: 0.7 }}>Total value</ThemedText>
                  <ThemedText style={styles.bigValue}>${data.total_portfolio_value.toFixed(2)}</ThemedText>
                  {change ? (
                    <ThemedText type="small" style={{ color: change.pos ? '#22c55e' : '#ef4444' }}>
                      {change.pos ? '▲' : '▼'} ${Math.abs(change.delta).toFixed(2)} ({change.pct.toFixed(1)}%) all-time
                    </ThemedText>
                  ) : (
                    <ThemedText type="small" style={{ opacity: 0.5 }}>
                      Chart fills in as daily price snapshots accumulate.
                    </ThemedText>
                  )}
                </ThemedView>
                {series.length >= 2 && (
                  <Sparkline
                    data={series.map((p) => p.value)}
                    width={sparkWidth}
                    height={64}
                    color={sparkColor}
                  />
                )}
              </ThemedView>

              <Section title="Inventory">
                <Row label={`Active (${data.inventory.active.card_count})`} value={`$${data.inventory.active.market_value.toFixed(2)}`} />
                <Row label={`Listed (${data.inventory.listed.card_count})`} value={`$${data.inventory.listed.market_value.toFixed(2)}`} />
                <Row label={`Sold (${data.inventory.sold.card_count})`} value={`$${data.inventory.sold.market_value.toFixed(2)} at listing`} />
              </Section>

              <Section title="Sales">
                <Row label="Count" value={`${data.sales.count}`} />
                <Row label="Gross revenue" value={`$${data.sales.gross_revenue.toFixed(2)}`} />
                <Row label="Platform fees" value={`$${data.sales.platform_fees.toFixed(2)}`} />
                <Row label="Shipping cost" value={`$${data.sales.shipping_cost.toFixed(2)}`} />
                <Row label="Net proceeds" value={`$${data.sales.net_proceeds.toFixed(2)}`} bold />
                <Row label="Realized profit" value={`$${data.sales.realized_profit.toFixed(2)}`} bold />
              </Section>

              <Section title="Owned (active + listed)">
                <Row label="Market value" value={`$${data.owned.market_value.toFixed(2)}`} />
                <Row label="Cost basis" value={`$${data.owned.cost_basis.toFixed(2)}`} />
                <Row label="Unrealized profit" value={`$${data.owned.unrealized_profit.toFixed(2)}`} bold />
              </Section>

              <Pressable onPress={() => router.push('/settings')} style={styles.settingsLink}>
                <ThemedText type="defaultSemiBold">Settings & integrations ›</ThemedText>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function seriesChange(series: { value: number }[]) {
  if (series.length < 2) return null;
  const first = series[0].value;
  const last = series[series.length - 1].value;
  if (first === 0) return null;
  const delta = last - first;
  return { delta, pct: (delta / first) * 100, pos: delta >= 0 };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="defaultSemiBold">{title}</ThemedText>
      {children}
    </ThemedView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <ThemedView style={styles.row}>
      <ThemedText>{label}</ThemedText>
      <ThemedText type={bold ? 'defaultSemiBold' : 'default'}>{value}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.three },
  hero: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
  },
  bigValue: { fontSize: 32, fontWeight: '700', lineHeight: 36 },
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  error: { color: '#ff5555' },
  settingsLink: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
});
