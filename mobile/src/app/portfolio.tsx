import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { api, type PortfolioSummary } from '@/lib/api';

export default function PortfolioScreen() {
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError(null);
      api.portfolio()
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e.message));
      return () => { alive = false; };
    }, [])
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Portfolio</ThemedText>
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {!data && !error && <ActivityIndicator />}
        {data && (
          <ScrollView contentContainerStyle={{ gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.four }}>
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="defaultSemiBold">Total value</ThemedText>
              <ThemedText type="title">${data.total_portfolio_value.toFixed(2)}</ThemedText>
              <ThemedText type="small">market value of owned + net sales</ThemedText>
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
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
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
  card: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  error: { color: '#ff5555' },
});
