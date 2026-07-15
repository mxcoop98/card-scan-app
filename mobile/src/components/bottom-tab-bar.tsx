import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { ThemedText } from './themed-text';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Tab = {
  label: string;
  icon: IconName;
  iconActive: IconName;
  path: string;
  match: (p: string) => boolean;
};

const TABS: Tab[] = [
  { label: 'Cards',     icon: 'albums-outline',    iconActive: 'albums',    path: '/',          match: (p) => p === '/' || p.startsWith('/cards') },
  { label: 'Bundles',   icon: 'cube-outline',      iconActive: 'cube',      path: '/bundles',   match: (p) => p.startsWith('/bundles') },
  { label: 'Scan',      icon: 'scan-outline',      iconActive: 'scan',      path: '/scan',      match: (p) => p.startsWith('/scan') || p === '/cards/new' },
  { label: 'Listings',  icon: 'pricetag-outline',  iconActive: 'pricetag',  path: '/listings',  match: (p) => p.startsWith('/listings') },
  { label: 'Portfolio', icon: 'trending-up-outline', iconActive: 'trending-up', path: '/portfolio', match: (p) => p.startsWith('/portfolio') || p.startsWith('/explore') || p.startsWith('/settings') },
];

export function BottomTabBar() {
  const pathname = usePathname();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const activeColor = '#4a9eff';

  return (
    <View style={[styles.bar, { backgroundColor: colors.background, borderTopColor: colors.backgroundElement }]}>
      {TABS.map((t) => {
        const active = t.match(pathname);
        const tintColor = active ? activeColor : colors.textSecondary;
        return (
          <Pressable
            key={t.label}
            onPress={() => router.push(t.path as any)}
            style={styles.tab}>
            <Ionicons
              name={active ? t.iconActive : t.icon}
              size={22}
              color={tintColor}
            />
            <ThemedText
              type="small"
              style={{ color: tintColor, fontSize: 11, fontWeight: active ? '600' : '400' }}>
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
});
