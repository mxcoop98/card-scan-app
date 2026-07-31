// Live viewfinder with auto-capture, web only.
//
// Why this exists: the file-input path (`capture="environment"`) hands off to
// the OS camera app, so our alignment guide is only ever visible on the
// preview *after* the shot. Aiming help has to happen while you aim, which
// means owning the preview — hence getUserMedia.
//
// It also gives us the frame buffer, which is what makes auto-capture and
// cropping possible at all. The shot is cropped to the guide rectangle, so
// what gets stored is the card rather than the card plus a desk.
//
// Native (iOS/Android) still uses expo-image-picker; expo-camera isn't a
// dependency yet and can't be verified from here. `photo-capture.tsx` picks
// the platform, so dropping it in later doesn't touch this file's callers.

import { useCallback, useEffect, useRef, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { assessFrame, COACHING, THRESHOLDS, toGray, type FrameVerdict } from '@/lib/frame-analysis';

export const CARD_ASPECT = 5 / 7;

/** Checked by callers instead of sniffing Platform.OS themselves. */
export const LIVE_CAMERA_SUPPORTED =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Guide inset, as a fraction of the viewfinder. Leaves margin so the user
 *  can see the card approach the box instead of it filling edge to edge. */
const GUIDE_INSET = 0.06;
/** Analysis buffer size. Small on purpose — this runs every frame. */
const SAMPLE_W = 100;
const SAMPLE_H = Math.round(SAMPLE_W / CARD_ASPECT);
/** Analysis cadence. 15fps is well above what judging focus needs, and
 *  keeps `stableFrames` meaning the same hold time on any device. */
const ANALYSIS_INTERVAL_MS = 66;
/** Long edge of the stored photo. ~1000px is plenty for eBay and for OCR. */
const OUTPUT_H = 1008;
const OUTPUT_W = Math.round(OUTPUT_H * CARD_ASPECT);

type Props = {
  onCapture: (dataUri: string) => void;
  onCancel: () => void;
  /** Start with auto-capture armed. */
  autoCapture?: boolean;
  /** Show the live sharpness/motion/framing numbers, for threshold tuning. */
  debug?: boolean;
};

export function LiveCamera({ onCapture, onCancel, autoCapture = true, debug = false }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const prevGray = useRef<Uint8Array | null>(null);
  const streak = useRef(0);
  const capturedRef = useRef(false);

  const [status, setStatus] = useState<'starting' | 'live' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [auto, setAuto] = useState(autoCapture);
  const [verdict, setVerdict] = useState<FrameVerdict | null>(null);
  const [countdown, setCountdown] = useState(0);

  // Map the guide rectangle back to source-pixel coordinates. The video is
  // displayed object-fit:cover, so part of it is cropped off screen; without
  // undoing that the stored photo would be offset from what was framed.
  const guideSourceRect = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const cw = video.clientWidth;
    const ch = video.clientHeight;
    const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
    const ox = (video.videoWidth * scale - cw) / 2;
    const oy = (video.videoHeight * scale - ch) / 2;
    return {
      sx: (cw * GUIDE_INSET + ox) / scale,
      sy: (ch * GUIDE_INSET + oy) / scale,
      sw: (cw * (1 - 2 * GUIDE_INSET)) / scale,
      sh: (ch * (1 - 2 * GUIDE_INSET)) / scale,
    };
  }, []);

  const grabFrame = useCallback(
    (width: number, height: number) => {
      const video = videoRef.current;
      const rect = guideSourceRect();
      if (!video || !rect) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
      return { canvas, ctx };
    },
    [guideSourceRect]
  );

  const shoot = useCallback(() => {
    if (capturedRef.current) return;
    const grabbed = grabFrame(OUTPUT_W, OUTPUT_H);
    if (!grabbed) return;
    capturedRef.current = true;
    onCapture(grabbed.canvas.toDataURL('image/jpeg', 0.9));
  }, [grabFrame, onCapture]);

  // Keep the latest `auto`/`shoot` reachable from the rAF loop without
  // restarting the camera every time they change.
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const shootRef = useRef(shoot);
  shootRef.current = shoot;

  useEffect(() => {
    // Every resource this effect owns is tracked in a local, never a ref.
    // React double-invokes effects in dev, and with shared refs the
    // discarded instance's cleanup cancels the surviving instance's
    // animation frame — the loop then runs exactly once, motion never gets
    // a baseline, and auto-capture silently never fires.
    let cancelled = false;
    let rafId = 0;
    let localStream: MediaStream | null = null;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStream = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus('live');
        loop();
      } catch (err: any) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied.'
            : err?.name === 'NotFoundError'
              ? 'No camera found on this device.'
              : err?.message || 'Could not start the camera.'
        );
      }
    }

    function loop() {
      if (cancelled) return;
      // Fixed cadence rather than requestAnimationFrame. rAF ties the
      // shutter delay to the display: `stableFrames` would mean twice as
      // long a hold on a 60Hz phone as on a 120Hz one. It also stalls
      // whenever the tab stops compositing, which strands the loop with a
      // live camera and no analysis. A timer gives the same wall-clock
      // behaviour everywhere, and 15fps is ample for judging focus.
      rafId = setTimeout(loop, ANALYSIS_INTERVAL_MS) as unknown as number;

      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      if (!sampleCanvas.current) sampleCanvas.current = document.createElement('canvas');
      const canvas = sampleCanvas.current;
      canvas.width = SAMPLE_W;
      canvas.height = SAMPLE_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const rect = guideSourceRect();
      if (!ctx || !rect) return;
      ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, SAMPLE_W, SAMPLE_H);
      const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
      const { gray } = toGray(data, SAMPLE_W, SAMPLE_H);

      const v = assessFrame(gray, SAMPLE_W, SAMPLE_H, prevGray.current);
      prevGray.current = gray;
      setVerdict(v);

      streak.current = v.ready ? streak.current + 1 : 0;
      setCountdown(Math.max(0, THRESHOLDS.stableFrames - streak.current));
      if (autoRef.current && streak.current >= THRESHOLDS.stableFrames) shootRef.current();
    }

    start();
    return () => {
      cancelled = true;
      if (rafId) clearTimeout(rafId);
      localStream?.getTracks().forEach((t) => t.stop());
      if (streamRef.current === localStream) streamRef.current = null;
      // A fresh instance must not inherit the discarded one's motion
      // baseline, or the first comparison is against a stale frame.
      prevGray.current = null;
      streak.current = 0;
    };
  }, [guideSourceRect]);

  const ready = verdict?.ready ?? false;
  const guideColor = ready ? '#34c759' : 'rgba(255,255,255,0.85)';
  const coaching = verdict?.reason ? COACHING[verdict.reason] : 'Hold steady…';

  if (status === 'error') {
    return (
      <ThemedView style={{ gap: Spacing.two, backgroundColor: 'transparent' }}>
        <ThemedText type="small" style={{ color: '#ff5555', textAlign: 'center' }}>
          {errorMsg}
        </ThemedText>
        <button onClick={onCancel} style={buttonStyle}>Use a photo instead</button>
      </ThemedView>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: String(CARD_ASPECT), borderRadius: 12, overflow: 'hidden', background: '#000' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {/* Guide brackets — the whole point of owning the preview. */}
        <div style={{ position: 'absolute', inset: `${GUIDE_INSET * 100}%`, pointerEvents: 'none' }}>
          {[
            { top: 0, left: 0, borderTop: `3px solid ${guideColor}`, borderLeft: `3px solid ${guideColor}`, borderTopLeftRadius: 8 },
            { top: 0, right: 0, borderTop: `3px solid ${guideColor}`, borderRight: `3px solid ${guideColor}`, borderTopRightRadius: 8 },
            { bottom: 0, left: 0, borderBottom: `3px solid ${guideColor}`, borderLeft: `3px solid ${guideColor}`, borderBottomLeftRadius: 8 },
            { bottom: 0, right: 0, borderBottom: `3px solid ${guideColor}`, borderRight: `3px solid ${guideColor}`, borderBottomRightRadius: 8 },
          ].map((c, i) => (
            <div key={i} style={{ position: 'absolute', width: 30, height: 30, ...c }} />
          ))}
        </div>

        {status === 'live' && (
          <div style={overlayTextStyle}>
            {ready && auto ? `Capturing… ${countdown || ''}` : coaching}
          </div>
        )}
        {status === 'starting' && <div style={overlayTextStyle}>Starting camera…</div>}

        {debug && verdict && (
          <div style={{ ...overlayTextStyle, top: 8, bottom: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
            sharp {verdict.sharpness.toFixed(0)}/{THRESHOLDS.sharpness} · move {Number.isFinite(verdict.motion) ? verdict.motion.toFixed(1) : '—'}/{THRESHOLDS.motion} · frame {verdict.framing.toFixed(0)}/{THRESHOLDS.framing}
          </div>
        )}
      </div>

      {/* Two rows, not three-in-a-row: the scan screen puts two of these
          side by side, and at that width three buttons overflow the slot
          and spill onto the neighbouring card. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={() => shoot()} style={{ ...buttonStyle, background: '#4a9eff', color: '#fff', borderColor: '#4a9eff' }}>
          Capture now
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setAuto((a) => !a)} style={{ ...buttonStyle, flex: 1, minWidth: 0 }}>
            {auto ? 'Auto ✓' : 'Auto'}
          </button>
          <button onClick={onCancel} style={{ ...buttonStyle, flex: 1, minWidth: 0 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const buttonStyle: any = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

const overlayTextStyle: any = {
  position: 'absolute',
  bottom: 8,
  left: 8,
  right: 8,
  textAlign: 'center',
  color: '#fff',
  background: 'rgba(0,0,0,0.45)',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 13,
  pointerEvents: 'none',
};
