import { forwardRef } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Standard TextInput that respects light/dark mode. Every form input in
// the app should use this — hardcoded text colors were invisible on
// light mode systems.
export const ThemedInput = forwardRef<TextInput, TextInputProps>(function ThemedInput(props, ref) {
  const theme = useTheme();
  return (
    <TextInput
      ref={ref}
      {...props}
      placeholderTextColor={theme.textSecondary}
      autoCapitalize={props.autoCapitalize ?? 'none'}
      style={[
        styles.input,
        {
          color: theme.text,
          borderColor: theme.backgroundElement,
          backgroundColor: theme.background,
        },
        props.style,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
});
