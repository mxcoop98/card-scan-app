// Camera / photo-library capture, shared by the scan screen (front +
// back slots before a card exists) and the card detail screen (adding
// or replacing photos on a saved card).
//
// Both platforms hand back a base64 data URI. Native goes through
// expo-image-picker; web uses a file input with capture="environment",
// which opens the rear camera on a phone and a file dialog on desktop.

import { Image } from 'expo-image';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export const CARD_ASPECT = 5 / 7;

type CaptureProps = {
  onCapture: (dataUri: string) => void;
  label: string;
  tone?: 'primary' | 'secondary';
  disabled?: boolean;
};

export function PhotoCapture(props: CaptureProps) {
  if (Platform.OS === 'web') return <WebCapture {...props} />;
  return <NativeCapture {...props} />;
}

function WebCapture({ onCapture, label, tone = 'primary', disabled }: CaptureProps) {
  return (
    <label style={{ ...webLabelStyle, ...(tone === 'primary' ? webPrimary : webSecondary), ...(disabled ? webDisabled : null) } as any}>
      <ThemedText type="defaultSemiBold" style={tone === 'primary' ? { color: 'white' } : undefined}>
        {label}
      </ThemedText>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e: any) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onCapture(String(reader.result));
          reader.readAsDataURL(file);
          // Clear the input so picking the same file twice still fires.
          e.target.value = '';
        }}
      />
    </label>
  );
}

function NativeCapture({ onCapture, label, tone = 'primary', disabled }: CaptureProps) {
  async function pick(source: 'camera' | 'library') {
    const ImagePicker = await import('expo-image-picker');
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const options = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: true } as const;
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.[0]) return;

    const asset = res.assets[0];
    onCapture(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
  }

  return (
    <View style={styles.nativeRow}>
      <Pressable
        onPress={() => pick('camera')}
        disabled={disabled}
        style={[styles.button, tone === 'primary' && styles.primary, { flex: 1 }, disabled && styles.dim]}>
        <ThemedText type="defaultSemiBold" style={tone === 'primary' ? { color: 'white' } : undefined}>
          {label}
        </ThemedText>
      </Pressable>
      <Pressable
        onPress={() => pick('library')}
        disabled={disabled}
        style={[styles.button, { flex: 1 }, disabled && styles.dim]}>
        <ThemedText type="defaultSemiBold">Library</ThemedText>
      </Pressable>
    </View>
  );
}

// Corner brackets marking where the card edges should land. Deliberately
// card-proportioned (2.5x3.5in => CARD_ASPECT), not square: a square guide
// would train people to frame a portrait card wrong, which is exactly the
// framing a future auto-capture / recognition pass has to undo.
function AlignmentGuide() {
  const corners = [
    { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
    { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
    { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
    { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  ];
  return (
    <View style={styles.guide} pointerEvents="none">
      {corners.map((c, i) => (
        <View key={i} style={[styles.corner, c]} />
      ))}
    </View>
  );
}

// A framed preview with its own capture button. Used for the scan
// screen's side-by-side front/back slots.
export function PhotoSlot({
  title,
  uri,
  onCapture,
  onClear,
  width,
}: {
  title: string;
  uri: string | null;
  onCapture: (dataUri: string) => void;
  onClear?: () => void;
  width?: number;
}) {
  return (
    <ThemedView style={[styles.slot, width ? { width } : { flex: 1 }]}>
      <ThemedText type="small" style={{ opacity: 0.6, textAlign: 'center' }}>{title}</ThemedText>
      <ThemedView style={[styles.frame, { aspectRatio: CARD_ASPECT }, uri ? styles.frameFilled : null]}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} contentFit="cover" />
        ) : (
          <ThemedView style={styles.frameEmpty}>
            <AlignmentGuide />
            <ThemedText type="small" style={{ opacity: 0.55, textAlign: 'center' }}>
              Line the card up{'\n'}with the corners
            </ThemedText>
          </ThemedView>
        )}
      </ThemedView>
      <PhotoCapture
        onCapture={onCapture}
        label={uri ? 'Retake' : '📷  Capture'}
        tone={uri ? 'secondary' : 'primary'}
      />
      {uri && onClear && (
        <Pressable onPress={onClear} style={styles.clear}>
          <ThemedText type="small" style={{ color: '#ff5555' }}>Remove</ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

const webLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
  borderRadius: 12,
  cursor: 'pointer',
  borderWidth: 1,
  borderStyle: 'solid',
};
const webPrimary = { backgroundColor: '#4a9eff', borderColor: '#4a9eff' };
const webSecondary = { backgroundColor: 'transparent', borderColor: 'rgba(127,127,127,0.3)' };
const webDisabled = { opacity: 0.4, cursor: 'default' };

const styles = StyleSheet.create({
  nativeRow: { flexDirection: 'row', gap: Spacing.two, backgroundColor: 'transparent' },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  primary: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  dim: { opacity: 0.4 },
  slot: { gap: Spacing.two, backgroundColor: 'transparent' },
  frame: {
    width: '100%',
    borderRadius: Spacing.three,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(127,127,127,0.5)',
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
  frameFilled: { borderStyle: 'solid', borderColor: 'rgba(74,158,255,0.6)' },
  frameEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  // Inset so the brackets sit just inside the dashed frame rather than
  // doubling up on it.
  guide: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, margin: 10 },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: 'rgba(74,158,255,0.9)' },
  image: { width: '100%', height: '100%' },
  clear: { alignSelf: 'center', paddingVertical: 2 },
});
