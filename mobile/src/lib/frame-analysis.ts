// Frame quality analysis for auto-capture.
//
// Deliberately pure and dependency-free: every function here takes plain
// pixel buffers, so the auto-capture decision can be unit-tested without a
// camera, a DOM, or a device. The component layer does nothing but feed
// frames in and act on the verdict.
//
// The job is to answer one question per frame — "is this a shot worth
// keeping?" — which breaks into three independent signals:
//
//   sharpness  is the image in focus?          (Laplacian variance)
//   motion     is the phone being held still?  (mean abs diff vs last frame)
//   framing    is a card actually in the box?  (edge strength at the guide)
//
// All three have to pass together for several consecutive frames. Any one
// alone produces false fires: a sharp empty desk, a still blurry hand, or a
// card edge caught mid-swing.

export type FrameVerdict = {
  ready: boolean;
  /** Why we're not ready, for on-screen coaching. Null when ready. */
  reason: 'focus' | 'motion' | 'framing' | null;
  sharpness: number;
  motion: number;
  framing: number;
};

// Starting points, tuned against synthetic frames. Real-device tuning is
// expected — the camera UI exposes these numbers in a debug readout so they
// can be adjusted against actual cards under actual lighting rather than
// guessed at a second time.
export const THRESHOLDS = {
  /** Laplacian variance below this reads as out of focus. */
  sharpness: 55,
  /** Mean per-pixel change above this means the phone is still moving. */
  motion: 6,
  /** Mean gradient magnitude along the guide border. */
  framing: 18,
  /** Consecutive passing frames before the shutter fires. The camera
   *  analyses at a fixed cadence, so this is a real hold duration
   *  (8 frames at ~15fps is a little over half a second) rather than
   *  something that varies with the device's refresh rate. */
  stableFrames: 8,
};

/** RGBA bytes -> single-channel luma, downscaled by `step`. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, step = 1) {
  const w = Math.floor(width / step);
  const h = Math.floor(height / step);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y * step) * width + x * step) * 4;
      // Rec. 601 luma — cheap and good enough for gradients.
      out[y * w + x] = (rgba[src] * 299 + rgba[src + 1] * 587 + rgba[src + 2] * 114) / 1000;
    }
  }
  return { gray: out, width: w, height: h };
}

/**
 * Variance of the 4-neighbour Laplacian. The standard cheap focus metric:
 * a blurred image has little high-frequency content, so the second
 * derivative stays near zero everywhere and its variance collapses.
 */
export function laplacianVariance(gray: Uint8Array, width: number, height: number) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean absolute difference between two same-sized gray frames. */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array) {
  if (a.length === 0 || a.length !== b.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/**
 * Mean Sobel gradient magnitude in a band just inside the frame edges.
 *
 * A card sitting in the guide puts its four borders right about here, and a
 * card border against a background is the strongest, most reliable edge in
 * the shot. Sampling a band rather than the exact boundary tolerates the
 * card being slightly small, large, or off-centre — we want "a card is
 * roughly in the box", not a pixel-perfect fit.
 */
export function borderEdgeScore(gray: Uint8Array, width: number, height: number, bandFraction = 0.14) {
  if (width < 5 || height < 5) return 0;
  const bandX = Math.max(2, Math.floor(width * bandFraction));
  const bandY = Math.max(2, Math.floor(height * bandFraction));
  let total = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const inBand = x < bandX || x >= width - bandX || y < bandY || y >= height - bandY;
      if (!inBand) continue;
      const i = y * width + x;
      const gx =
        -gray[i - width - 1] + gray[i - width + 1] +
        -2 * gray[i - 1] + 2 * gray[i + 1] +
        -gray[i + width - 1] + gray[i + width + 1];
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] +
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
      total += Math.min(255, Math.hypot(gx, gy));
      n++;
    }
  }
  return n === 0 ? 0 : total / n;
}

/**
 * Score one frame. `prevGray` is the previous frame's buffer, or null for
 * the first frame (which can never be ready — we have no motion reading
 * yet, and firing on frame one would defeat the point of holding steady).
 */
export function assessFrame(
  gray: Uint8Array,
  width: number,
  height: number,
  prevGray: Uint8Array | null,
  thresholds = THRESHOLDS
): FrameVerdict {
  const sharpness = laplacianVariance(gray, width, height);
  const framing = borderEdgeScore(gray, width, height);
  const motion = prevGray ? meanAbsDiff(gray, prevGray) : Number.POSITIVE_INFINITY;

  // Order matters: report the most actionable problem first. Framing is
  // what the user controls most directly, then focus, then holding still.
  let reason: FrameVerdict['reason'] = null;
  if (framing < thresholds.framing) reason = 'framing';
  else if (sharpness < thresholds.sharpness) reason = 'focus';
  else if (motion > thresholds.motion) reason = 'motion';

  return { ready: reason === null, reason, sharpness, motion, framing };
}

export const COACHING: Record<NonNullable<FrameVerdict['reason']>, string> = {
  framing: 'Fit the card inside the corners',
  focus: 'Hold steady — focusing',
  motion: 'Hold still',
};
