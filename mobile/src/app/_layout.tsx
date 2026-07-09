import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme, View } from 'react-native';

import { BottomTabBar } from '@/components/bottom-tab-bar';

// The template's Tabs + CustomTabList + AnimatedSplashOverlay were
// replaced: they mounted a wrapper on web that swallowed click events.
// A plain Stack + our own BottomTabBar keeps nav reliable and gives us
// full control over the visual.

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false }} />
        </View>
        <BottomTabBar />
      </View>
    </ThemeProvider>
  );
}
