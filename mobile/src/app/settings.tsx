import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type EbayStatus } from '@/lib/api';

export default function SettingsScreen() {
  const [ebay, setEbay] = useState<EbayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setEbay(await api.ebayStatus()); }
    catch (e: any) { setError(e.message); }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function connectEbay() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.ebayAuthorizeUrl();
      if (Platform.OS === 'web') {
        window.location.href = url;
      } else {
        await Linking.openURL(url);
      }
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
          <ThemedText type="title">Settings</ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="defaultSemiBold">eBay</ThemedText>
            {error && <ThemedText style={styles.error}>{error}</ThemedText>}
            {!ebay && !error && <ActivityIndicator />}
            {ebay && (
              <>
                <Row label="Environment" value={ebay.environment} />
                <Row label="App configured" value={ebay.configured ? 'Yes' : 'No — set EBAY_CLIENT_ID / SECRET / REDIRECT_URI in backend .env'} />
                <Row label="Connected" value={ebay.connected ? 'Yes' : 'No'} />
                {ebay.connected && ebay.access_expires_at && (
                  <Row label="Access token expires" value={new Date(ebay.access_expires_at).toLocaleString()} />
                )}
                {ebay.connected && ebay.refresh_expires_at && (
                  <Row label="Refresh token expires" value={new Date(ebay.refresh_expires_at).toLocaleDateString()} />
                )}
                {ebay.seller_username && <Row label="Seller username" value={ebay.seller_username} />}
                <Row label="Redirect URI" value={ebay.redirect_uri ?? '—'} bold />

                <Pressable
                  onPress={connectEbay}
                  disabled={busy || !ebay.configured}
                  style={[styles.button, styles.primary, (busy || !ebay.configured) && { opacity: 0.4 }]}>
                  <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>
                    {ebay.connected ? 'Reconnect eBay' : 'Connect eBay'}
                  </ThemedText>
                </Pressable>

                {ebay.connected && <SyncOrdersButton />}
                {ebay.connected && <SetupSellerButton />}

                {!ebay.configured && (
                  <ThemedText type="small" style={{ opacity: 0.7 }}>
                    Add the eBay app credentials to the backend .env, then restart the server before connecting.
                  </ThemedText>
                )}
              </>
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SyncOrdersButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  async function sync() {
    setBusy(true); setResult(null);
    try {
      const r = await api.ebaySyncOrders();
      setResult(`Checked ${r.checked} orders · marked ${r.updated.length} sold · skipped ${r.skipped.length}`);
    } catch (e: any) {
      setResult('Error: ' + e.message);
    } finally { setBusy(false); }
  }
  return (
    <>
      <Pressable onPress={sync} disabled={busy} style={[styles.button, busy && { opacity: 0.4 }]}>
        <ThemedText type="defaultSemiBold">{busy ? 'Syncing…' : 'Sync eBay orders'}</ThemedText>
      </Pressable>
      {result && <ThemedText type="small" style={{ opacity: 0.7 }}>{result}</ThemedText>}
    </>
  );
}

function SetupSellerButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  async function run() {
    setBusy(true); setResult(null);
    try {
      const r = await api.ebaySetupSandboxSeller();
      const failed = r.steps.filter((s) => s.error);
      const ok = r.steps.filter((s) => !s.error);
      setResult(`Setup done: ${ok.length} ok, ${failed.length} failed. Check backend logs for env vars.`);
    } catch (e: any) {
      setResult('Error: ' + e.message);
    } finally { setBusy(false); }
  }
  return (
    <>
      <Pressable onPress={run} disabled={busy} style={[styles.button, busy && { opacity: 0.4 }]}>
        <ThemedText type="defaultSemiBold">{busy ? 'Provisioning…' : 'Provision sandbox seller (one-time)'}</ThemedText>
      </Pressable>
      {result && <ThemedText type="small" style={{ opacity: 0.7 }}>{result}</ThemedText>}
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <ThemedView style={styles.rowLine}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type={bold ? 'defaultSemiBold' : 'default'} style={{ textAlign: 'right', maxWidth: '60%' }}>{value}</ThemedText>
    </ThemedView>
  );
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
  button: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  primary: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  error: { color: '#ff5555' },
});
