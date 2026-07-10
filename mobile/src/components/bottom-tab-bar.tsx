import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { ThemedText } from './themed-text';

type Tab = { label: string; icon: string; path: string; match: (p: string) => boolean };

const TABS: Tab[] = [
  { label: 'Cards',     icon: '▦', path: '/',          match: (p) => p === '/' || p.startsWith('/cards') },
  { label: 'Bundles',   icon: '⌸', path: '/bundles',   match: (p) => p.startsWith('/bundles') },
  { label: 'Scan',      icon: '◉', path: '/scan', match: (p) => p.startsWith('/scan') || p === '/cards/new' },
  { label: 'Listings',  icon: '⇄', path: '/listings',  match: (p) => p.startsWith('/listings') },
  { label: 'Portfolio', icon: '$', path: '/portfolio', match: (p) => p.startsWith('/portfolio') || p.startsWith('/explore') },
];

// A Settings link — surfaced from the Portfolio screen since we've hit
// tab-bar cap of 5. Consumers reach /settings via portfolio for now.

export function BottomTabBar() {
  const pathname = usePathname();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];

  return (
    <View style={[styles.bar, { backgroundColor: colors.background, borderTopColor: colors.backgroundElement }]}>
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Pressable
            key={t.label}
            onPress={() => router.push(t.path as any)}
            style={styles.tab}>
            <ThemedText
              style={[styles.icon, { color: active ? colors.text : colors.textSecondary }]}>
              {t.icon}
            </ThemedText>
            <ThemedText
              type="small"
              style={{ color: active ? colors.text : colors.textSecondary, fontWeight: active ? '600' : '400' }}>
              {t.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export const BOTTOM_TAB_HEIGHT = 64;

const styles = StyleSheet.create({
  bar: {
    height: BOTTOM_TAB_HEIGHT,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    gap: 2,
  },
  icon: { fontSize: 22, lineHeight: 22 },
});
