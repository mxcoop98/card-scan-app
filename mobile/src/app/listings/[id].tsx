import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedInput } from '@/components/themed-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type Listing } from '@/lib/api';
import { confirm } from '@/lib/confirm';

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setListing(await api.getListing(id));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function del() {
    confirm('Delete listing?', 'This removes the listing (cards stay).', async () => {
      try {
        await api.deleteListing(id);
        router.back();
      } catch (e: any) {
        setError(e.message);
      }
    });
  }

  if (error) return <ErrorScreen msg={error} />;
  if (!listing) return <LoadingScreen />;

  const isSold = listing.status === 'sold';
  const totalCost = listing.cards.reduce(
    (a, c) => a + (c.cost_basis ? Number(c.cost_basis) : 0),
    0
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: listing.title ?? `Listing ${listing.id}` }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={{ gap: Spacing.three, padding: Spacing.four }}>
          <ThemedText type="title">{listing.title ?? `Listing ${listing.id}`}</ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <Row label="Status" value={listing.status} />
            <Row label="Marketplace" value={listing.marketplace} />
            {listing.ask_price != null && <Row label="Ask price" value={`$${Number(listing.ask_price).toFixed(2)}`} />}
            {isSold && listing.sold_price != null && (
              <>
                <Row label="Sold price" value={`$${Number(listing.sold_price).toFixed(2)}`} bold />
                <Row label="Platform fees" value={`$${Number(listing.platform_fees).toFixed(2)}`} />
                <Row label="Shipping cost" value={`$${Number(listing.shipping_cost).toFixed(2)}`} />
                <Row
                  label="Net proceeds"
                  value={`$${(Number(listing.sold_price) - Number(listing.platform_fees) - Number(listing.shipping_cost)).toFixed(2)}`}
                  bold
                />
                {listing.sold_at && <Row label="Sold at" value={new Date(listing.sold_at).toLocaleString()} />}
                {listing.external_listing_id && <Row label="External ID" value={listing.external_listing_id} />}
              </>
            )}
            <Row label="Cost basis (all cards)" value={totalCost ? `$${totalCost.toFixed(2)}` : 'n/a'} />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="defaultSemiBold">
              Cards ({listing.cards.length})
            </ThemedText>
            {listing.cards.map((c) => (
              <ThemedView key={c.id} style={styles.cardRow}>
                <ThemedView style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <ThemedText>{c.name}</ThemedText>
                  <ThemedText type="small">
                    {[c.set_name, c.year, c.category].filter(Boolean).join(' · ')}
                  </ThemedText>
                </ThemedView>
                {c.cost_basis && <ThemedText type="small">${Number(c.cost_basis).toFixed(2)}</ThemedText>}
              </ThemedView>
            ))}
          </ThemedView>

          {!isSold && <MarkSoldForm listing={listing} onDone={load} />}

          {listing.status === 'draft' && !listing.ebay_listing_id && (
            <PublishEbayButton listing={listing} onDone={load} />
          )}

          {listing.ebay_view_url && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="defaultSemiBold">Published to eBay</ThemedText>
              <Row label="Environment" value={listing.ebay_environment ?? '—'} />
              <Row label="eBay listing ID" value={listing.ebay_listing_id ?? '—'} />
              <Pressable
                onPress={() => { if (typeof window !== 'undefined') window.open(listing.ebay_view_url!, '_blank'); }}
                style={[styles.button, styles.primary]}>
                <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>Open in eBay</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          <Pressable onPress={del} style={[styles.button, styles.destructive]}>
            <ThemedText type="defaultSemiBold" style={{ color: '#ff5555' }}>Delete listing</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function PublishEbayButton({ listing, onDone }: { listing: Listing; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function publish() {
    setBusy(true); setErr(null);
    try {
      await api.publishToEbay(listing.id);
      await onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="defaultSemiBold">Publish to eBay</ThemedText>
      <ThemedText type="small" style={{ opacity: 0.7 }}>
        Push this draft to eBay. Requires you to have connected eBay in Settings.
        Single-card listings only for v1.
      </ThemedText>
      {err && <ThemedText style={styles.error}>{err}</ThemedText>}
      <Pressable
        onPress={publish}
        disabled={busy || !listing.ask_price || listing.cards.length !== 1}
        style={[styles.button, styles.primary, (busy || !listing.ask_price || listing.cards.length !== 1) && { opacity: 0.4 }]}>
        <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>
          {busy ? 'Publishing…' : 'Publish to eBay'}
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function MarkSoldForm({ listing, onDone }: { listing: Listing; onDone: () => Promise<void> }) {
  const [soldPrice, setSoldPrice] = useState(listing.ask_price ? String(listing.ask_price) : '');
  const [fees, setFees] = useState('');
  const [shipping, setShipping] = useState('');
  const [ext, setExt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.markSold(listing.id, {
        sold_price: Number(soldPrice),
        platform_fees: fees ? Number(fees) : undefined,
        shipping_cost: shipping ? Number(shipping) : undefined,
        external_listing_id: ext || undefined,
      });
      await onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="defaultSemiBold">Record sale</ThemedText>
      <Field label="Sold price *" value={soldPrice} onChangeText={setSoldPrice} keyboardType="decimal-pad" />
      <Field label="Platform fees" value={fees} onChangeText={setFees} keyboardType="decimal-pad" />
      <Field label="Shipping cost" value={shipping} onChangeText={setShipping} keyboardType="decimal-pad" />
      <Field label="External listing ID (eBay etc.)" value={ext} onChangeText={setExt} />

      {err && <ThemedText style={styles.error}>{err}</ThemedText>}

      <Pressable
        onPress={submit}
        disabled={busy || !soldPrice}
        style={[styles.button, styles.primary, (busy || !soldPrice) && { opacity: 0.4 }]}>
        <ThemedText type="defaultSemiBold">{busy ? 'Saving…' : 'Mark sold'}</ThemedText>
      </Pressable>
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <ThemedView style={styles.rowLine}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type={bold ? 'defaultSemiBold' : 'default'}>{value}</ThemedText>
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
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
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
  destructive: { borderColor: 'rgba(255,85,85,0.5)' },
  error: { color: '#ff5555' },
});
