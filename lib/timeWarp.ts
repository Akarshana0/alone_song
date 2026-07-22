"use client";

const ToneLib: any = typeof window !== "undefined" ? require("tone") : {};
const Tone: any = ToneLib.default || ToneLib;
const getContext = Tone.getContext;
import { wsolaTimeStretch } from "./audioEngine";
import { sliceBuffer } from "./audioEditing";

/**
 * Time Warping (elastic audio / warp markers) — distinct from the existing
 * Time Stretch tool, which applies one uniform rate across the whole clip.
 * A warp marker pins a point in the *source* audio to a point on the
 * *timeline*; between any two consecutive markers the segment is stretched
 * (via the same WSOLA engine Time Stretch already uses) at whatever local
 * rate makes the source segment fill its target timeline span. This is the
 * same idea as "warp markers" / elastic audio in commercial DAWs (Ableton's
 * Warp, Pro Tools' Elastic Audio): non-uniform, per-segment time stretch
 * anchored at user-placed points, instead of one global rate.
 *
 * Known simplification: each segment is WSOLA-stretched independently and
 * then concatenated, so there can be a very small discontinuity right at a
 * marker boundary (WSOLA's internal overlap-add window doesn't span across
 * the cut) — audible mainly as a faint click on percussive material with
 * markers placed very close together. A production elastic-audio engine
 * would run one continuous WSOLA pass with a time-varying analysis hop
 * instead of independent per-segment passes.
 */
export interface WarpMarker {
  id: string;
  sourceTime: number; // seconds, position in the original (unwarped) buffer
  timelineTime: number; // seconds, where that point should land on the timeline
}

/** A fresh two-marker default spanning the whole clip 1:1 (no warp yet) —
 *  drag the end marker's timelineTime to stretch/compress the whole thing,
 *  or add markers in between for non-uniform warping. */
export function defaultWarpMarkers(durationSec: number): WarpMarker[] {
  return [
    { id: "warp-start", sourceTime: 0, timelineTime: 0 },
    { id: "warp-end", sourceTime: durationSec, timelineTime: durationSec },
  ];
}

function concatBuffers(segments: AudioBuffer[], sampleRate: number): AudioBuffer {
  const ctx = Tone.getContext().rawContext as AudioContext;
  const numChannels = Math.max(1, ...segments.map((s) => s.numberOfChannels));
  const totalLength = segments.reduce((sum, s) => sum + s.length, 0);
  const out = ctx.createBuffer(numChannels, Math.max(1, totalLength), sampleRate);
  let offset = 0;
  for (const seg of segments) {
    for (let c = 0; c < numChannels; c++) {
      const src = seg.getChannelData(Math.min(c, seg.numberOfChannels - 1));
      out.getChannelData(c).set(src, offset);
    }
    offset += seg.length;
  }
  return out;
}

/**
 * Applies a set of warp markers to `buffer`, producing a new buffer whose
 * duration matches the last marker's timelineTime. Markers are sorted by
 * sourceTime first (drag order on the source axis doesn't have to match
 * insertion order). Requires at least 2 markers; fewer returns the buffer
 * unchanged.
 */
export function applyWarpMarkers(buffer: AudioBuffer, markers: WarpMarker[]): AudioBuffer {
  if (markers.length < 2) return buffer;
  const sorted = [...markers].sort((a, b) => a.sourceTime - b.sourceTime);

  const segments: AudioBuffer[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const sourceDur = Math.max(0.001, b.sourceTime - a.sourceTime);
    const timelineDur = Math.max(0.001, b.timelineTime - a.timelineTime);
    const segment = sliceBuffer(buffer, a.sourceTime, b.sourceTime);
    const rate = sourceDur / timelineDur; // >1 = compress (speed up), <1 = stretch
    const stretched = wsolaTimeStretch(segment, rate);
    segments.push(stretched);
  }

  return concatBuffers(segments, buffer.sampleRate);
}
