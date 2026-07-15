import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Reusable empty-state block. Used when a list has zero rows.
// Prefer this over a plain <Text>No items</Text> — it signals
// intent and gives the user a next step.
export function EmptyState({
  icon = 'cube-outline',
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.iconRing, { borderColor: theme.backgroundElement }]}>
        <Ionicons name={icon} size={36} color={theme.textSecondary} />
      </View>
      <ThemedText type="defaultSemiBold" style={{ marginTop: Spacing.three }}>
        {title}
      </ThemedText>
      {hint && (
        <ThemedText type="small" style={{ opacity: 0.6, textAlign: 'center', marginTop: 4 }}>
          {hint}
        </ThemedText>
      )}
      {actionLabel && onAction && (
        <Pressable onPress={onAction} style={styles.action}>
          <ThemedText type="defaultSemiBold" style={{ color: 'white' }}>{actionLabel}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    backgroundColor: '#4a9eff',
  },
});
