// Native stand-in for the web live viewfinder.
//
// Metro resolves `live-camera.web.tsx` on web and this file everywhere else,
// so the import in photo-capture.tsx stays platform-agnostic. A real native
// viewfinder needs expo-camera, which isn't a dependency yet — until then
// native keeps using the expo-image-picker path, and callers check
// LIVE_CAMERA_SUPPORTED rather than sniffing the platform themselves.

export const LIVE_CAMERA_SUPPORTED = false;

export function LiveCamera(_: {
  onCapture: (dataUri: string) => void;
  onCancel: () => void;
  autoCapture?: boolean;
  debug?: boolean;
}) {
  return null;
}
