import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Tiny inline line-chart. No axes, no labels — just the shape of the trend.
// Accepts a raw series and renders a smoothed polyline into a container.
export function Sparkline({
  data,
  width,
  height,
  color = '#22c55e',
  strokeWidth = 2,
}: {
  data: number[];
  width: number;
  height: number;
  color?: string;
  strokeWidth?: number;
}) {
  if (data.length < 2) return <View style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const padY = strokeWidth;
  const usableH = height - padY * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = padY + usableH * (1 - (v - min) / span);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const d = `M ${points.join(' L ')}`;

  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
