import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();
  // Card-shaped surfaces get a subtle elevation — turns flat text into
  // real cards without heavy styling per screen.
  const elevated = type === 'backgroundElement';
  return (
    <View
      style={[
        { backgroundColor: theme[type ?? 'background'] },
        elevated && cardElevation,
        style,
      ]}
      {...otherProps}
    />
  );
}

const cardElevation = StyleSheet.create({
  x: Platform.select({
    web: {
      // @ts-expect-error — boxShadow is a valid web style but not in RN types
      boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
    },
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
    },
    android: {
      elevation: 2,
    },
    default: {},
  }),
}).x;
