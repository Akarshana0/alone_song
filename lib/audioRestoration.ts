"use client";

const ToneLib: any = typeof window !== "undefined" ? require("tone") : {};
const Tone: any = ToneLib.default || ToneLib;
const getContext = Tone.getContext;

/**
 * Offline "Restoration" suite: Noise Reduction, De-click, De-clip, De-reverb.
 *
 * Like Reverse and Time Stretch (see lib/audioEngine.ts), these are
 * destructive, non-real-time buffer transforms applied via an explicit
 * "Apply" action rather than a live FX-chain node — spectral analysis over
 * the whole clip isn't something you can do sample-by-sample in a live
 * Tone.js node, so the DAW store decodes the track's buffer, runs one of
 * these, and re-encodes the result (mirrors wsolaTimeStretch exactly).
 *
 * Noise Reduction and De-reverb operate in the frequency domain (STFT via
 * a radix-2 FFT + Hann analysis/synthesis windows + overlap-add). De-click
 * and De-clip operate in the time domain: detect the damaged samples, then
 * rebuild them with a cubic Hermite spline anchored to the clean audio on
 * either side.
 */

function newBuffer(numChannels: number, length: number, sampleRate: number): AudioBuffer {
  const ctx = Tone.getContext().rawContext as AudioContext;
  return ctx.createBuffer(Math.max(1, numChannels), Math.max(1, length), sampleRate);
}

// ---------------------------------------------------------------------------
// FFT (iterative radix-2 Cooley-Tukey, in place on parallel re/im arrays)
// ---------------------------------------------------------------------------

function fft(re: Float64Array, im: Float64Array, invert: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1;
      let curWi = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const ure = re[i + j];
        const uim = im[i + j];
        const vre = re[i + j + half] * curWr - im[i + j + half] * curWi;
        const vim = re[i + j + half] * curWi + im[i + j + half] * curWr;
        re[i + j] = ure + vre;
        im[i + j] = uim + vim;
        re[i + j + half] = ure - vre;
        im[i + j + half] = uim - vim;
        const nextWr = curWr * wr - curWi * wi;
        const nextWi = curWr * wi + curWi * wr;
        curWr = nextWr;
        curWi = nextWi;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  return w;
}

/** Frame start offsets (in samples) covering the whole channel, hop apart. */
function framePositions(length: number, hop: number): number[] {
  const positions: number[] = [];
  for (let start = 0; start < length; start += hop) positions.push(start);
  return positions;
}

const FRAME_SIZE = 2048;
const HOP = 512; // 75% overlap
const HALF = FRAME_SIZE / 2;

// ---------------------------------------------------------------------------
// Noise Reduction — spectral subtraction against an auto-estimated noise
// profile (built from the quietest frames in the clip, so no manual "noise
// sample" selection step is needed).
// ---------------------------------------------------------------------------

export function reduceNoise(buffer: AudioBuffer, amount: number): AudioBuffer {
  const clampedAmount = Math.max(0, Math.min(1, amount));
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const analysisWindow = hannWindow(FRAME_SIZE);
  const alpha = 1 + clampedAmount * 4; // over-subtraction factor
  const floor = Math.max(0.02, 0.15 - clampedAmount * 0.13); // residual to avoid musical noise

  const out = newBuffer(numChannels, buffer.length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    const positions = framePositions(data.length, HOP);
    const dst = out.getChannelData(c);
    const weight = new Float32Array(data.length);

    // Pass A: cheap time-domain RMS per frame, no FFT, to find quiet frames.
    const frameRms = new Float64Array(positions.length);
    for (let f = 0; f < positions.length; f++) {
      const start = positions[f];
      let sum = 0;
      for (let i = 0; i < FRAME_SIZE; i++) {
        const s = data[start + i] ?? 0;
        sum += s * s;
      }
      frameRms[f] = Math.sqrt(sum / FRAME_SIZE);
    }

    // Pick the quietest ~20% of frames (bounded) as the noise reference set.
    const order = Array.from(frameRms.keys()).sort((a, b) => frameRms[a] - frameRms[b]);
    const noiseFrameCount = Math.max(3, Math.min(120, Math.ceil(order.length * 0.2)));
    const noiseFrameIdx = order.slice(0, noiseFrameCount);

    // Pass B: average magnitude spectrum of those quiet frames.
    const noiseProfile = new Float64Array(HALF + 1);
    const re = new Float64Array(FRAME_SIZE);
    const im = new Float64Array(FRAME_SIZE);
    for (const f of noiseFrameIdx) {
      const start = positions[f];
      for (let i = 0; i < FRAME_SIZE; i++) {
        re[i] = (data[start + i] ?? 0) * analysisWindow[i];
        im[i] = 0;
      }
      fft(re, im, false);
      for (let k = 0; k <= HALF; k++) {
        noiseProfile[k] += Math.hypot(re[k], im[k]);
      }
    }
    for (let k = 0; k <= HALF; k++) noiseProfile[k] /= noiseFrameIdx.length;

    // Pass C: full reconstruction, subtracting the noise profile bin-by-bin.
    for (const start of positions) {
      for (let i = 0; i < FRAME_SIZE; i++) {
        re[i] = (data[start + i] ?? 0) * analysisWindow[i];
        im[i] = 0;
      }
      fft(re, im, false);

      for (let k = 0; k <= HALF; k++) {
        const mag = Math.hypot(re[k], im[k]);
        const suppressed = mag - alpha * noiseProfile[k];
        const newMag = Math.max(suppressed, mag * floor);
        const scale = mag > 1e-12 ? newMag / mag : 0;
        re[k] *= scale;
        im[k] *= scale;
        if (k !== 0 && k !== HALF) {
          const mk = FRAME_SIZE - k;
          re[mk] *= scale;
          im[mk] *= scale;
        }
      }

      fft(re, im, true);
      for (let i = 0; i < FRAME_SIZE; i++) {
        const idx = start + i;
        if (idx >= dst.length) break;
        const w = analysisWindow[i];
        dst[idx] += re[i] * w;
        weight[idx] += w * w;
      }
    }

    for (let i = 0; i < dst.length; i++) {
      if (weight[i] > 1e-6) dst[i] /= weight[i];
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// De-reverb — approximate dereverberation via a per-bin decaying "tail"
// envelope: each bin tracks how much energy is likely still ringing from
// recent frames, and that predicted tail is subtracted from the current
// frame before it can mask the direct sound.
// ---------------------------------------------------------------------------

export function deReverb(buffer: AudioBuffer, amount: number): AudioBuffer {
  const clampedAmount = Math.max(0, Math.min(1, amount));
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const analysisWindow = hannWindow(FRAME_SIZE);
  const decayFactor = 0.8; // per-hop persistence of the estimated tail
  const strength = clampedAmount * 1.6;
  const floor = Math.max(0.05, 0.3 - clampedAmount * 0.22);

  const out = newBuffer(numChannels, buffer.length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    const positions = framePositions(data.length, HOP);
    const dst = out.getChannelData(c);
    const weight = new Float32Array(data.length);
    const tailEstimate = new Float64Array(HALF + 1);
    const re = new Float64Array(FRAME_SIZE);
    const im = new Float64Array(FRAME_SIZE);

    for (const start of positions) {
      for (let i = 0; i < FRAME_SIZE; i++) {
        re[i] = (data[start + i] ?? 0) * analysisWindow[i];
        im[i] = 0;
      }
      fft(re, im, false);

      for (let k = 0; k <= HALF; k++) {
        const mag = Math.hypot(re[k], im[k]);
        const predictedTail = tailEstimate[k] * decayFactor;
        const newMag = Math.max(mag - strength * predictedTail, mag * floor);
        tailEstimate[k] = Math.max(predictedTail, mag);

        const scale = mag > 1e-12 ? newMag / mag : 0;
        re[k] *= scale;
        im[k] *= scale;
        if (k !== 0 && k !== HALF) {
          const mk = FRAME_SIZE - k;
          re[mk] *= scale;
          im[mk] *= scale;
        }
      }

      fft(re, im, true);
      for (let i = 0; i < FRAME_SIZE; i++) {
        const idx = start + i;
        if (idx >= dst.length) break;
        const w = analysisWindow[i];
        dst[idx] += re[i] * w;
        weight[idx] += w * w;
      }
    }

    for (let i = 0; i < dst.length; i++) {
      if (weight[i] > 1e-6) dst[i] /= weight[i];
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Shared time-domain repair helper: rebuild a damaged [s, e] sample range
// with a cubic Hermite spline anchored to the clean samples just outside it,
// matching both value and local slope at the boundary so the patch doesn't
// leave an audible seam.
// ---------------------------------------------------------------------------

function hermiteFillRegion(out: Float32Array, source: Float32Array, s: number, e: number) {
  const n = source.length;
  const x0 = Math.max(0, s - 1);
  const x1 = Math.min(n - 1, e + 1);
  if (x1 <= x0) return;

  const y0 = source[x0];
  const y1 = source[x1];
  const m0 = x0 > 0 ? source[x0] - source[x0 - 1] : 0;
  const m1 = x1 < n - 1 ? source[x1 + 1] - source[x1] : 0;
  const segLen = x1 - x0;

  for (let x = s; x <= e && x < n; x++) {
    if (x < 0) continue;
    const t = (x - x0) / segLen;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const value = h00 * y0 + h10 * segLen * m0 + h01 * y1 + h11 * segLen * m1;
    out[x] = Math.max(-1, Math.min(1, value));
  }
}

/** Group individually-marked sample indices into contiguous [s, e] regions,
 *  merging marks that are within `gap` samples of each other. */
function markedIndicesToRegions(marked: boolean[], gap: number): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  let regionStart = -1;
  let lastMarked = -Infinity;
  for (let i = 0; i < marked.length; i++) {
    if (marked[i]) {
      if (regionStart === -1) regionStart = i;
      lastMarked = i;
    } else if (regionStart !== -1 && i - lastMarked > gap) {
      regions.push([regionStart, lastMarked]);
      regionStart = -1;
    }
  }
  if (regionStart !== -1) regions.push([regionStart, lastMarked]);
  return regions;
}

// ---------------------------------------------------------------------------
// De-click — detects short impulsive transients (clicks/pops) via a local,
// RMS-adaptive threshold on the first difference of the waveform, then
// patches each one with the shared Hermite reconstruction.
// ---------------------------------------------------------------------------

export function deClick(buffer: AudioBuffer, sensitivity: number): AudioBuffer {
  const clampedSensitivity = Math.max(0, Math.min(1, sensitivity));
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const out = newBuffer(numChannels, buffer.length, sampleRate);
  const blockSize = 1024;
  const thresholdFactor = 10 - clampedSensitivity * 8; // 10 (only big clicks) .. 2 (subtle clicks)

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(data);
    const n = data.length;

    const numBlocks = Math.max(1, Math.ceil(n / blockSize));
    const blockRms = new Float64Array(numBlocks);
    for (let b = 0; b < numBlocks; b++) {
      const start = b * blockSize;
      const end = Math.min(n, start + blockSize);
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i] * data[i];
      blockRms[b] = Math.sqrt(sum / Math.max(1, end - start));
    }

    const marked = new Array(n).fill(false);
    for (let i = 1; i < n; i++) {
      const localRms = blockRms[Math.floor(i / blockSize)];
      if (localRms < 1e-5) continue; // near-silence: skip to avoid false hits
      const diff = data[i] - data[i - 1];
      if (Math.abs(diff) > localRms * thresholdFactor) {
        marked[i - 1] = true;
        marked[i] = true;
      }
    }

    const regions = markedIndicesToRegions(marked, 24);
    for (const [s, e] of regions) {
      // Skip absurdly long "clicks" — that's not an impulsive artifact, it's
      // real program material, and patching it would audibly gut the track.
      if (e - s > sampleRate * 0.01) continue;
      hermiteFillRegion(dst, data, s, e);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// De-clip — detects flattened/clipped runs (consecutive samples pinned at or
// past a ceiling) and rebuilds the missing peak shape with the same Hermite
// reconstruction, using the clean waveform just outside the run to infer the
// curve's slope.
// ---------------------------------------------------------------------------

export function deClip(buffer: AudioBuffer, threshold: number): AudioBuffer {
  const ceiling = Math.max(0.5, Math.min(0.999, threshold));
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const out = newBuffer(numChannels, buffer.length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(data);
    const n = data.length;

    const marked = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (Math.abs(data[i]) >= ceiling) marked[i] = true;
    }

    // Require runs of >= 2 samples so isolated legitimate peaks aren't touched.
    const rawRegions = markedIndicesToRegions(marked, 0).filter(([s, e]) => e - s >= 1);
    for (const [s, e] of rawRegions) {
      hermiteFillRegion(dst, data, s, e);
    }
  }

  return out;
}
