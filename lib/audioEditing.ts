"use client";

const ToneLib: any = typeof window !== "undefined" ? require("tone") : {};
const Tone: any = ToneLib.default || ToneLib;
const getContext = Tone.getContext;

/**
 * Pure, side-effect-free AudioBuffer editing primitives used by the DAW
 * store to implement Cut / Copy / Paste / Trim / Split / Merge / Silence.
 * Every function returns a *new* AudioBuffer; nothing here touches
 * playback state or the store directly.
 */

function newBuffer(numChannels: number, length: number, sampleRate: number): AudioBuffer {
  const ctx = Tone.getContext().rawContext as AudioContext;
  return ctx.createBuffer(Math.max(1, numChannels), Math.max(1, length), sampleRate);
}

function secToSample(sec: number, sampleRate: number, maxLen: number): number {
  return Math.max(0, Math.min(maxLen, Math.round(sec * sampleRate)));
}

/** Extract the [startSec, endSec) region as a standalone buffer. */
export function sliceBuffer(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const start = secToSample(startSec, sr, buffer.length);
  const end = Math.max(start, secToSample(endSec, sr, buffer.length));
  const out = newBuffer(buffer.numberOfChannels, end - start, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c).subarray(start, end));
  }
  return out;
}

/** Remove the [startSec, endSec) region, splicing what's left back together. */
export function removeRange(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const start = secToSample(startSec, sr, buffer.length);
  const end = Math.max(start, secToSample(endSec, sr, buffer.length));
  const out = newBuffer(buffer.numberOfChannels, buffer.length - (end - start), sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, start), 0);
    dst.set(src.subarray(end), start);
  }
  return out;
}

/** Zero out the [startSec, endSec) region in place (duration unchanged). */
export function silenceRange(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const start = secToSample(startSec, sr, buffer.length);
  const end = Math.max(start, secToSample(endSec, sr, buffer.length));
  const out = newBuffer(buffer.numberOfChannels, buffer.length, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const dst = out.getChannelData(c);
    dst.set(buffer.getChannelData(c));
    dst.fill(0, start, end);
  }
  return out;
}

/** Insert `insert` into `buffer` at atSec, pushing the tail back. */
export function insertBufferAt(buffer: AudioBuffer, insert: AudioBuffer, atSec: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const at = secToSample(atSec, sr, buffer.length);
  const numChannels = Math.max(buffer.numberOfChannels, insert.numberOfChannels);
  const out = newBuffer(numChannels, buffer.length + insert.length, sr);
  for (let c = 0; c < numChannels; c++) {
    const dst = out.getChannelData(c);
    const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
    const ins = insert.getChannelData(Math.min(c, insert.numberOfChannels - 1));
    dst.set(src.subarray(0, at), 0);
    dst.set(ins, at);
    dst.set(src.subarray(at), at + insert.length);
  }
  return out;
}

/** DC Offset Removal: if a waveform's average level has drifted off the
 *  zero (center) line — common with cheap/faulty audio interfaces — this
 *  subtracts each channel's mean sample value so the waveform re-centers
 *  on 0. A per-channel running-mean high-pass (rather than a single global
 *  subtraction) is used so a slow drift across a long recording gets
 *  removed too, not just a fixed static offset. */
export function removeDcOffset(buffer: AudioBuffer): AudioBuffer {
  const sr = buffer.sampleRate;
  const out = newBuffer(buffer.numberOfChannels, buffer.length, sr);
  // ~0.05 Hz cutoff single-pole high-pass — slow enough to leave all
  // audible content untouched, fast enough to track a slowly drifting
  // offset rather than just removing one fixed mean value.
  const cutoffHz = 0.05;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sr;
  const alpha = rc / (rc + dt);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    let prevIn = src[0] ?? 0;
    let prevOut = 0;
    dst[0] = 0;
    for (let i = 1; i < src.length; i++) {
      const x = src[i];
      const y = alpha * (prevOut + x - prevIn);
      dst[i] = y;
      prevIn = x;
      prevOut = y;
    }
  }
  return out;
}

/** Divides a buffer into `count` equal-length [start, end) regions in
 *  seconds, for the MPC-style pad slicer (components/PadSlicer.tsx). Equal
 *  division is the simple, predictable default — a transient-detection
 *  slicer (snap each pad to the nearest onset) is a natural follow-up but
 *  out of scope here. */
export function sliceIntoPads(buffer: AudioBuffer, count: number): { start: number; end: number }[] {
  const n = Math.max(1, Math.round(count));
  const step = buffer.duration / n;
  const pads: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i++) {
    pads.push({ start: i * step, end: i === n - 1 ? buffer.duration : (i + 1) * step });
  }
  return pads;
}

/** Split a buffer into two independent buffers at atSec. */
export function splitBuffer(buffer: AudioBuffer, atSec: number): [AudioBuffer, AudioBuffer] {
  return [sliceBuffer(buffer, 0, atSec), sliceBuffer(buffer, atSec, buffer.duration)];
}

/** Mix two buffers down into one stereo buffer, honoring each source's
 *  linear gain (track volume, 0 if muted) and simple pan. Used for
 *  "merge down". Output is soft-clipped to [-1, 1]. */
export function mergeBuffersDown(
  a: AudioBuffer,
  aGain: number,
  aPan: number,
  b: AudioBuffer,
  bGain: number,
  bPan: number
): AudioBuffer {
  const sr = a.sampleRate;
  const numChannels = 2;
  const length = Math.max(a.length, b.length);
  const out = newBuffer(numChannels, length, sr);

  const mixIn = (buf: AudioBuffer, gain: number, pan: number) => {
    const leftGain = gain * (pan <= 0 ? 1 : 1 - pan);
    const rightGain = gain * (pan >= 0 ? 1 : 1 + pan);
    for (let c = 0; c < numChannels; c++) {
      const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
      const dst = out.getChannelData(c);
      const g = c === 0 ? leftGain : rightGain;
      for (let i = 0; i < src.length; i++) dst[i] += src[i] * g;
    }
  };

  mixIn(a, aGain, aPan);
  mixIn(b, bGain, bPan);

  for (let c = 0; c < numChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i]));
  }
  return out;
}
