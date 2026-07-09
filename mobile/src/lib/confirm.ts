import { Alert, Platform } from 'react-native';

// Cross-platform confirm dialog. React Native's Alert.alert is a
// no-op on web, so we fall back to window.confirm there.
export function confirm(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'OK', style: 'destructive', onPress: onConfirm },
  ]);
}
