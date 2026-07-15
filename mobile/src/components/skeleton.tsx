import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';

// Pulsing grey block used as a placeholder while data loads.
// Cheaper than a spinner and gives users an instant hint of the
// layout they're about to see. Works uniformly on native + web.
export function Skeleton({ width, height, radius = 8, style }: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.block,
        { width: width as any, height: height as any, borderRadius: radius, opacity },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: 'rgba(127,127,127,0.2)' },
});
