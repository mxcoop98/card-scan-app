import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BOTTOM_TAB_HEIGHT } from '@/components/bottom-tab-bar';
import { ThemedInput } from '@/components/themed-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api, type EbayStatus } from '@/lib/api';

export default function SettingsScreen() {
  const [ebay, setEbay] = useState<EbayStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

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
        // Open consent in a NEW tab so this tab — and the paste-to-finish
        // box — stay alive. If eBay lands on its "safe to close" page
        // instead of redirecting to our callback, the user copies that
        // URL and pastes it below without losing app state.
        window.open(url, '_blank', 'noopener');
        setPasteOpen(true);
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

                <FinishConnecting open={pasteOpen} setOpen={setPasteOpen} onDone={load} />

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

// Manual completion path for the OAuth "safe to close" quirk: paste the
// URL eBay redirected to (or the bare code) and we exchange it server-side.
function FinishConnecting({
  open,
  setOpen,
  onDone,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onDone: () => Promise<void> | void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setMsg(null);
    try {
      await api.ebayCompleteAuth(value.trim());
      setMsg('Connected — eBay tokens saved.');
      setValue('');
      await onDone();
    } catch (e: any) {
      setMsg('Error: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.link}>
        <ThemedText type="small" style={{ opacity: 0.7 }}>
          eBay sent you to a “safe to close” page? Paste the URL to finish →
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <ThemedView style={styles.finishBox}>
      <ThemedText type="small" style={{ opacity: 0.8 }}>
        Paste the full URL eBay redirected you to (or just the code value):
      </ThemedText>
      <ThemedInput
        value={value}
        onChangeText={setValue}
        placeholder="https://…?code=v%5E1.1%23i%5E1…"
        multiline
        autoCorrect={false}
        style={{ minHeight: 64, textAlignVertical: 'top' }}
      />
      <Pressable
        onPress={complete}
        disabled={busy || value.trim().length === 0}
        style={[styles.button, styles.primary, (busy || value.trim().length === 0) && { opacity: 0.4 }]}>
        <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>
          {busy ? 'Finishing…' : 'Finish connecting'}
        </ThemedText>
      </Pressable>
      {msg && <ThemedText type="small" style={{ opacity: 0.7 }}>{msg}</ThemedText>}
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
  link: { marginTop: Spacing.two, paddingVertical: 4 },
  finishBox: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
});
