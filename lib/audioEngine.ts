"use client";

// Named imports from tone — bypasses ESM/CJS namespace interop issues
// that cause "Tone.Meter is not a constructor" in production builds.
import {
  Meter, Gain, Panner, Compressor, Limiter, Filter, Distortion,
  BitCrusher, Chorus, Phaser, Tremolo, Vibrato, PitchShift,
  FeedbackDelay, Reverb, EQ3, Gate, Chebyshev, Player, PolySynth,
  Synth, Analyser, Split, Recorder, Panner3D, LFO, AutoFilter,
  Follower, Scale, Delay, OmniOscillator, Oscillator, PulseOscillator,
  Transport, Destination, start as toneStart, getContext, now as toneNow,
  ToneAudioBuffer, Offline, Draw,
  context as toneCtxAccessor,
} from "tone";
import type * as ToneImport from "tone";

// Build a Tone-like namespace object from the named imports so every
// existing `Tone.XYZ` / `new Tone.XYZ(...)` reference keeps working
// without touching 200+ call sites.
const Tone: Record<string, any> = {
  Meter, Gain, Panner, Compressor, Limiter, Filter, Distortion,
  BitCrusher, Chorus, Phaser, Tremolo, Vibrato, PitchShift,
  FeedbackDelay, Reverb, EQ3, Gate, Chebyshev, Player, PolySynth,
  Synth, Analyser, Split, Recorder, Panner3D, LFO, AutoFilter,
  Follower, Scale, Delay, OmniOscillator, Oscillator, PulseOscillator,
  Transport, Destination, ToneAudioBuffer, Draw,
  start: toneStart,
  getContext,
  now: toneNow,
  Offline,
  context: toneCtxAccessor,
};

/**
 * AudioEngine centralizes all Web Audio / Tone.js routing for ALONE SONG.
 *
 * Per-track signal chain:
 *   Player -> Gate -> EQ3 -> Filter -> Compressor -> Limiter -> Distortion
 *   -> BitCrusher -> Chorus -> Flanger(custom) -> Phaser -> Tremolo -> Vibrato
 *   -> PitchShift -> AutoTuneShift -> DeEsser(parallel split) -> Delay -> Reverb
 *   -> Harmonizer(dry + 2 pitched voices, summed) -> Vocoder(dry/wet, 8-band)
 *   -> Panner -> Gain -> Meter -> Master Bus
 *
 * Master bus:
 *   masterGain -> Compressor -> Limiter -> Meter -> Destination
 *   Limiter also feeds (in parallel, read-only): an FFT Analyser for the
 *   Spectrum view, and a Split -> L/R waveform Analyser pair that powers the
 *   Phase Correlation, Goniometer, True Peak, and Tuner meters.
 *
 * Design note on bypass: most nodes stay permanently wired in the chain to
 * avoid runtime rewiring bugs. "Disabling" an effect sets it to a neutral /
 * transparent state (wet = 0, or neutral gain/threshold) instead of
 * physically removing the node. This keeps the graph static and stable.
 *
 * Time Stretch is the one exception: like Reverse, it's a destructive,
 * offline buffer transform (WSOLA) applied via reload rather than a live
 * node, since the chain is built around a static Player buffer.
 *
 * Auto-Tune works by continuously analyzing each enabled track's own
 * waveform (autocorrelation pitch detection, ~20x/sec) and steering a
 * dedicated PitchShift node toward the nearest note in the chosen
 * key/scale. This is a detection-and-shift approximation, not a
 * formant-preserving PSOLA correction — fast bends can be less snappy
 * than a dedicated commercial pitch corrector.
 */

export type FilterType = "lowpass" | "highpass" | "bandpass" | "notch";

/** Chain parameters the free-assignable Mod LFO (below) can be routed to.
 *  "off" means the LFO runs but is disconnected from everything. */
export type ModLfoTarget = "off" | "filterCutoff" | "pan" | "volume" | "delayTime";
export type ModLfoShape = "sine" | "triangle" | "square" | "sawtooth";

export interface TrackEffectsSettings {
  reversed: boolean;
  fadeIn: number; // seconds
  fadeOut: number; // seconds

  /** Phase Inversion / Polarity Flip: flips the signal 180° (multiplies by
   *  -1). The classic use is fixing phase cancellation when a source was
   *  captured on two mics at different distances — flipping one mic's
   *  polarity can restore the low end that would otherwise partially
   *  cancel when summed. Implemented as a unity/-1 Tone.Gain sitting right
   *  after the player, before any other processing (see `polarity` in
   *  TrackNodes / AudioEngine.setPolarity) rather than a destructive buffer
   *  edit, so it can be flipped back with zero quality loss. */
  polarityInverted: boolean;

  /** Spatial Audio / 3D positioning: places this track at a point in a
   *  listener-centered 3D space and renders it through the browser's
   *  native HRTF binaural panner (Tone.Panner3D / Web Audio PannerNode),
   *  the same underlying technique object-based formats like Dolby Atmos
   *  use for headphone/stereo rendering. `x` is left(-)/right(+), `y` is
   *  down(-)/up(+), `z` is behind(+)/in front of(-) the listener (Web
   *  Audio's convention: the listener faces -Z by default). Distance from
   *  the origin also naturally attenuates the source (see refDistance/
   *  rolloffFactor in AudioEngine.setSpatial). See "Known limitation" note
   *  on true multichannel 5.1/7.1 output in the FXRack/README docs — real
   *  discrete multichannel output depends on OS/audio-interface support
   *  that a browser tab can't reliably guarantee, so this binaural
   *  approach (full 3D imaging over any stereo output) is the practical,
   *  always-works substitute. */
  spatial: { enabled: boolean; x: number; y: number; z: number };

  gate: { enabled: boolean; threshold: number }; // dB
  eq: { low: number; mid: number; high: number }; // dB, -20..20
  filter: { enabled: boolean; type: FilterType; frequency: number; q: number };
  compressor: {
    enabled: boolean;
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    knee: number;
  };
  limiter: { enabled: boolean; threshold: number };
  expander: { enabled: boolean; threshold: number; ratio: number };
  deEsser: { enabled: boolean; frequency: number; reduction: number };

  distortion: { enabled: boolean; amount: number };
  saturation: { enabled: boolean; amount: number };
  bitcrusher: { enabled: boolean; bits: number };

  chorus: { enabled: boolean; frequency: number; depth: number; wet: number };
  flanger: { enabled: boolean; rate: number; depth: number; feedback: number; wet: number };

  /** Free-assignable modulation LFO for sound design. The engine already
   *  runs an internal Tone.LFO hardwired into the Flanger's delay time
   *  (see `flangerLFO` in audioEngine.ts) — this is a second, independent
   *  LFO instance the user can route to a chain parameter of their choice
   *  (filter cutoff, pan, volume, or delay time) instead of it being
   *  locked to one effect. */
  modLfo: { enabled: boolean; target: ModLfoTarget; shape: ModLfoShape; rate: number; depth: number };
  phaser: { enabled: boolean; frequency: number; octaves: number; baseFrequency: number; wet: number };
  tremolo: { enabled: boolean; frequency: number; depth: number; wet: number };
  vibrato: { enabled: boolean; frequency: number; depth: number; wet: number };
  pitchShift: { enabled: boolean; semitones: number; wet: number };
  delay: { enabled: boolean; time: number; feedback: number; wet: number };
  reverb: { enabled: boolean; decay: number; wet: number };

  /** Offline WSOLA time-stretch (duration change, pitch preserved). Applied
   *  via an explicit "Apply" action (like Reverse), not a live wet mix. */
  timeStretch: { rate: number }; // 0.5 (2x longer) .. 2 (2x shorter)

  /** Restoration suite: spectral/time-domain repair tools, each applied
   *  destructively via its own "Apply" action (see lib/audioRestoration.ts) —
   *  same offline pattern as Time Stretch, since these need to analyze the
   *  whole clip rather than process it live sample-by-sample. */
  restoration: {
    noiseReduction: { amount: number }; // 0..1
    deClick: { sensitivity: number }; // 0..1
    deClip: { threshold: number }; // 0..1, ceiling level a sample must hit to count as clipped
    deReverb: { amount: number }; // 0..1
  };

  /** Pitch correction: detects the track's own pitch and steers it toward
   *  the nearest note in `key`/`scale`. `key` is 0-11 (0 = C). */
  autoTune: {
    enabled: boolean;
    key: number;
    scale: "chromatic" | "major" | "minor";
    retune: number; // 0..1, how fast correction snaps to the target note
    wet: number;
  };

  /** Two extra pitch-shifted voices mixed under the dry signal. */
  harmonizer: {
    enabled: boolean;
    voice1: number; // semitones
    voice1Wet: number;
    voice2: number; // semitones
    voice2Wet: number;
  };

  /** Classic 8-band vocoder: track audio modulates band-pass filtered
   *  bands of an internal carrier oscillator. */
  vocoder: { enabled: boolean; carrier: "sawtooth" | "square" | "pulse"; carrierNote: number; wet: number };

  /** Sidechain ducking: an envelope follower reads `sourceTrackId`'s output
   *  and pulls this track's gain down in proportion to `amount` whenever the
   *  source is loud (classic "pump" effect — e.g. bass ducking under a kick).
   *  Web Audio's native DynamicsCompressorNode has no external key input, so
   *  this is implemented as follower -> scale -> gain-param modulation
   *  (see AudioEngine.setSidechain) rather than a true keyed compressor. */
  sidechain: { enabled: boolean; sourceTrackId: string | null; amount: number };

  /** Dynamic EQ: three bands (low/mid/high), each an independent
   *  Tone.Compressor sitting behind its own band-split filter — the band
   *  only gets gain-reduced when *that band's own level* crosses its
   *  threshold, unlike the static EQ (fixed cut/boost) or the single-band
   *  Compressor (whole-signal level). Deliberately a different tool from a
   *  "multiband compressor": each band here also has its own frequency
   *  control, so it behaves like an EQ that reacts to level rather than a
   *  level tool split by frequency. See AudioEngine.setDynamicEq. */
  dynamicEq: {
    enabled: boolean;
    low: { freq: number; threshold: number; ratio: number };
    mid: { freqLow: number; freqHigh: number; threshold: number; ratio: number };
    high: { freq: number; threshold: number; ratio: number };
    wet: number;
  };

  /** Tape Stop / Tape Start: a live, triggered playback-rate ramp (not a
   *  continuous wet effect like the others) — see AudioEngine.triggerTapeStop
   *  / triggerTapeStart. `curve` shapes the deceleration/acceleration; real
   *  tape motors slow roughly exponentially, not linearly. */
  tapeStop: { stopDuration: number; startDuration: number; curve: "exponential" | "linear" };

  /** Fade/Crossfade shape. Tone.Source only natively supports "linear" and
   *  "exponential" fade curves; "equalPower" is mapped to "exponential"
   *  (the closer of the two to a true equal-power crossfade curve). */
  fadeInCurve: FadeCurve;
  fadeOutCurve: FadeCurve;

  /** Multiband Compressor: 3 independent bands (low/mid/high), each with
   *  its own threshold/ratio/makeup, always summed back together — a true
   *  dynamics tool, unlike `dynamicEq` above (which blends dry/wet). */
  multibandCompressor: {
    enabled: boolean;
    lowFreq: number; // low/mid crossover, Hz
    highFreq: number; // mid/high crossover, Hz
    low: { threshold: number; ratio: number; makeup: number };
    mid: { threshold: number; ratio: number; makeup: number };
    high: { threshold: number; ratio: number; makeup: number };
  };

  /** Transient Shaper: a fast follower (attack) and slow follower (sustain)
   *  each drive a VCA blended against the dry signal — boosts or softens
   *  the "punch" and "tail" independent of overall level. See
   *  AudioEngine.setTransientShaper. */
  transientShaper: { enabled: boolean; attack: number; sustain: number }; // -1..1 each

  /** Stereo Imager / Widener (Tone.StereoWidener): 0 = mono, 0.5 = neutral
   *  (unprocessed width), 1 = maximally wide. */
  stereoImager: { enabled: boolean; width: number };

  /** Exciter / Enhancer: adds harmonic saturation to a high-frequency tap
   *  and blends it back in, adding "air"/presence without the level jump
   *  a straight EQ boost would cause. */
  exciter: { enabled: boolean; frequency: number; amount: number; wet: number };

  /** Formant Shifting: pitch-shifts a band-limited (vocal-formant-range)
   *  copy of the signal and blends it back in. An approximation — a true
   *  formant shift needs LPC/PSOLA spectral-envelope manipulation, which
   *  is out of reach of a live Web Audio graph (same caveat as Auto-Tune). */
  formantShift: { enabled: boolean; shift: number; wet: number }; // shift in semitones

  /** Convolution Reverb: Tone.Convolver against a synthesized impulse
   *  response — a distinct tool from the algorithmic `reverb` above, which
   *  offers a space "type" instead of a decay-time knob. */
  convolutionReverb: { enabled: boolean; irType: "room" | "hall" | "plate" | "cathedral"; wet: number };

  /** Ring Modulation: multiplies the signal by a carrier oscillator
   *  (true audio-rate ring mod via a Gain node's gain param), producing
   *  bell-like/robotic sum-and-difference tones. */
  ringMod: { enabled: boolean; frequency: number; wet: number };
}

export type FadeCurve = "linear" | "equalPower" | "exponential";

export function defaultTrackEffects(): TrackEffectsSettings {
  return {
    reversed: false,
    fadeIn: 0,
    fadeOut: 0,
    polarityInverted: false,
    spatial: { enabled: false, x: 0, y: 0, z: -2 },
    gate: { enabled: false, threshold: -50 },
    eq: { low: 0, mid: 0, high: 0 },
    filter: { enabled: false, type: "lowpass", frequency: 20000, q: 1 },
    compressor: { enabled: false, threshold: -24, ratio: 3, attack: 0.02, release: 0.25, knee: 6 },
    limiter: { enabled: false, threshold: -1 },
    expander: { enabled: false, threshold: -40, ratio: 2 },
    deEsser: { enabled: false, frequency: 6000, reduction: 6 },
    distortion: { enabled: false, amount: 0.2 },
    saturation: { enabled: false, amount: 0.3 },
    bitcrusher: { enabled: false, bits: 8 },
    chorus: { enabled: false, frequency: 1.5, depth: 0.7, wet: 0.5 },
    flanger: { enabled: false, rate: 0.25, depth: 0.5, feedback: 0.4, wet: 0.5 },
    modLfo: { enabled: false, target: "off", shape: "sine", rate: 2, depth: 0.5 },
    phaser: { enabled: false, frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0.5 },
    tremolo: { enabled: false, frequency: 4, depth: 0.6, wet: 1 },
    vibrato: { enabled: false, frequency: 5, depth: 0.3, wet: 1 },
    pitchShift: { enabled: false, semitones: 0, wet: 1 },
    delay: { enabled: false, time: 0.25, feedback: 0.3, wet: 0.3 },
    reverb: { enabled: false, decay: 2.5, wet: 0.3 },
    timeStretch: { rate: 1 },
    restoration: {
      noiseReduction: { amount: 0.5 },
      deClick: { sensitivity: 0.5 },
      deClip: { threshold: 0.98 },
      deReverb: { amount: 0.5 },
    },
    autoTune: { enabled: false, key: 0, scale: "chromatic", retune: 0.35, wet: 1 },
    harmonizer: { enabled: false, voice1: 4, voice1Wet: 0.6, voice2: 7, voice2Wet: 0.5 },
    vocoder: { enabled: false, carrier: "sawtooth", carrierNote: 55, wet: 1 },
    sidechain: { enabled: false, sourceTrackId: null, amount: 0.6 },
    dynamicEq: {
      enabled: false,
      low: { freq: 200, threshold: -24, ratio: 3 },
      mid: { freqLow: 200, freqHigh: 3000, threshold: -24, ratio: 3 },
      high: { freq: 3000, threshold: -24, ratio: 3 },
      wet: 1,
    },
    tapeStop: { stopDuration: 1.2, startDuration: 1.2, curve: "exponential" },
    fadeInCurve: "linear",
    fadeOutCurve: "linear",
    multibandCompressor: {
      enabled: false,
      lowFreq: 200,
      highFreq: 3000,
      low: { threshold: -24, ratio: 3, makeup: 1 },
      mid: { threshold: -24, ratio: 3, makeup: 1 },
      high: { threshold: -24, ratio: 3, makeup: 1 },
    },
    transientShaper: { enabled: false, attack: 0, sustain: 0 },
    stereoImager: { enabled: false, width: 0.5 },
    exciter: { enabled: false, frequency: 3000, amount: 0.3, wet: 0.3 },
    formantShift: { enabled: false, shift: 0, wet: 0.5 },
    convolutionReverb: { enabled: false, irType: "hall", wet: 0.3 },
    ringMod: { enabled: false, frequency: 30, wet: 0.5 },
  };
}

/** Internal, non-UI envelope shaping: a very gentle always-on amplitude
 *  smoother (fast attack, medium release, low ratio) sitting right after
 *  the Gate. Defaults are deliberately transparent (ratio 1 = no-op) so it
 *  never audibly changes existing projects; it exists as an engine-level
 *  capability (see AudioEngine.setEnvelopeShape) that presets/automation
 *  can drive later without needing a dedicated FX-rack control. */
export interface EnvelopeShapeSettings {
  attack: number;
  release: number;
  ratio: number; // 1 = neutral/no-op
}

export function defaultEnvelopeShape(): EnvelopeShapeSettings {
  return { attack: 0.003, release: 0.15, ratio: 1 };
}

// ---------------------------------------------------------------------------
// Automation (category 6: Mixing & Automation — automation lines/curves)
// ---------------------------------------------------------------------------

export type AutomationParam = "volume" | "pan";

export interface AutomationPoint {
  id: string;
  time: number; // seconds, absolute position on the timeline
  value: number; // volume: 0..1.2 gain, pan: -1(L)..1(R)
}

export interface AutomationLane {
  enabled: boolean;
  points: AutomationPoint[];
}

export interface TrackAutomation {
  volume: AutomationLane;
  pan: AutomationLane;
}

export function defaultAutomation(): TrackAutomation {
  return {
    volume: { enabled: false, points: [] },
    pan: { enabled: false, points: [] },
  };
}

/** Linear-interpolates an automation lane's value at time `t` (seconds).
 *  Returns `fallback` (the plain fader/pan value) when the lane is off,
 *  empty, or `t` sits before the first / after the last point isn't the
 *  right mental model — instead it clamps to the nearest endpoint, which is
 *  standard DAW automation behavior (a curve "holds" past its last point). */
export function automationValueAt(lane: AutomationLane, t: number, fallback: number): number {
  if (!lane.enabled || lane.points.length === 0) return fallback;
  const pts = [...lane.points].sort((a, b) => a.time - b.time);
  if (t <= pts[0].time) return pts[0].value;
  if (t >= pts[pts.length - 1].time) return pts[pts.length - 1].value;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const frac = span <= 0 ? 0 : (t - a.time) / span;
      return a.value + (b.value - a.value) * frac;
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Category 8 additions: MIDI (piano roll + quantize), VST/plugin hosting
// (Web Audio Modules), and offline rendering/export.
// ---------------------------------------------------------------------------

/** A single MIDI note event on a MIDI track's piano roll. Times are stored
 *  in absolute seconds from the start of the track (like an audio track's
 *  buffer), not musical beats — this keeps the model simple and consistent
 *  with how audio-track selections already work, at the cost of notes not
 *  auto-shifting if the project bpm changes after they're placed. */
export interface MidiNote {
  id: string;
  pitch: number; // MIDI note number, 0-127 (60 = C4)
  start: number; // seconds
  duration: number; // seconds
  velocity: number; // 0-1
}

/** Oscillator shape for the built-in MIDI synth engine (Tone.PolySynth).
 *  Real VST/sample-based instruments are out of scope here — see the WAM
 *  plugin host below for hosting real external plugins instead. */
export type SynthWaveform = "sine" | "square" | "sawtooth" | "triangle";

/** Which synthesis engine a MIDI track's built-in instrument uses.
 *  - "subtractive": the original oscillator + PolySynth (SynthWaveform above).
 *  - "wavetable": a PolySynth whose oscillator is a "custom" periodic wave
 *    built by morphing between a few fixed harmonic tables (see
 *    WAVETABLE_FRAMES / buildWavetablePartials below) at `wavetablePosition`.
 *  - "granular": a small pool of Tone.GrainPlayers reading a loaded sample
 *    buffer, pitched per note by playbackRate and re-triggered as grains —
 *    see AudioEngine.loadGranularSample / triggerGranularNote. */
export type InstrumentEngine = "subtractive" | "wavetable" | "granular";

export interface WavetableSettings {
  /** 0..1, morphs across the fixed frame set below. */
  position: number;
}

export interface GranularSettings {
  /** URL of the sample used as the grain source (loaded like an audio
   *  track's fileUrl). Null until the user loads one. */
  sampleUrl: string | null;
  /** MIDI note the sample is considered to be recorded at (playbackRate 1). */
  baseNote: number;
  grainSize: number; // seconds, 0.01 - 0.5
  density: number; // grains/sec, 1 - 60
  spread: number; // 0..1, random start-position jitter within the sample
}

export function defaultWavetableSettings(): WavetableSettings {
  return { position: 0 };
}

export function defaultGranularSettings(): GranularSettings {
  return { sampleUrl: null, baseNote: 60, grainSize: 0.08, density: 20, spread: 0.1 };
}

/** A handful of fixed harmonic-amplitude tables (as Tone.js oscillator
 *  `partials` arrays) to morph between for the Wavetable engine. Real
 *  wavetable synths ship dozens of single-cycle frames sampled from actual
 *  waveforms; this is a compact stand-in built from harmonic series so it
 *  needs no extra assets, spanning "hollow/sine-ish" to "buzzy/square-ish". */
const WAVETABLE_FRAMES: number[][] = [
  [1], // pure sine
  [1, 0, 0.3, 0, 0.15, 0, 0.1], // hollow, odd harmonics (clarinet-ish)
  [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.125], // sawtooth-ish, full harmonic falloff
  [1, 0, 1, 0, 0.6, 0, 0.4, 0, 0.3], // buzzy, strong odd harmonics (square-ish)
];

/** Morphs across WAVETABLE_FRAMES at `position` (0..1) by linearly
 *  interpolating amplitudes between the two nearest frames. */
export function buildWavetablePartials(position: number): number[] {
  const p = Math.max(0, Math.min(1, position));
  const frames = WAVETABLE_FRAMES;
  const span = (frames.length - 1) * p;
  const i = Math.min(frames.length - 2, Math.floor(span));
  const t = span - i;
  const a = frames[i];
  const b = frames[i + 1];
  const len = Math.max(a.length, b.length);
  const out: number[] = [];
  for (let h = 0; h < len; h++) {
    const av = a[h] ?? 0;
    const bv = b[h] ?? 0;
    out.push(av + (bv - av) * t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arpeggiator (MIDI tracks) — a pure note-transform applied before the
// notes are scheduled into the Tone.Part, so it composes cleanly with
// Quantize and doesn't need any engine-side state of its own.
// ---------------------------------------------------------------------------

export type ArpPattern = "up" | "down" | "updown" | "random" | "asPlayed";
export type ArpRate = "1/4" | "1/8" | "1/16" | "1/8t" | "1/16t";

export interface ArpeggiatorSettings {
  enabled: boolean;
  pattern: ArpPattern;
  rate: ArpRate;
  /** How many octaves upward the held chord's notes are duplicated across. */
  octaves: number;
  /** 0..1, each stepped note's duration as a fraction of one step. */
  gate: number;
}

export function defaultArpeggiator(): ArpeggiatorSettings {
  return { enabled: false, pattern: "up", rate: "1/16", octaves: 1, gate: 0.8 };
}

function arpStepSeconds(bpm: number, rate: ArpRate): number {
  const quarter = 60 / Math.max(1, bpm);
  const map: Record<ArpRate, number> = {
    "1/4": quarter,
    "1/8": quarter / 2,
    "1/16": quarter / 4,
    "1/8t": quarter / 3,
    "1/16t": quarter / 6,
  };
  return map[rate];
}

/** Groups notes whose [start, start+duration) spans overlap into "chords" —
 *  a chord is any maximal run of mutually-overlapping notes, closely
 *  mirroring how a player physically holding several keys down would look
 *  on the piano roll. */
function groupIntoChords(notes: MidiNote[]): MidiNote[][] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const chords: MidiNote[][] = [];
  let current: MidiNote[] = [];
  let currentEnd = -Infinity;
  for (const n of sorted) {
    if (current.length > 0 && n.start < currentEnd) {
      current.push(n);
      currentEnd = Math.max(currentEnd, n.start + n.duration);
    } else {
      if (current.length > 0) chords.push(current);
      current = [n];
      currentEnd = n.start + n.duration;
    }
  }
  if (current.length > 0) chords.push(current);
  return chords;
}

/** Expands each held chord into a stepped single-note sequence for the
 *  chosen pattern/rate/octaves, spanning the chord's own held duration
 *  (from the earliest note's start to the latest note's end). Chords of a
 *  single note still get arpeggiated (repeated across octaves/steps) so
 *  turning the arp on always audibly does something, even on a monophonic
 *  part. Pure function — the caller decides whether/when to use the result. */
export function applyArpeggiator(notes: MidiNote[], bpm: number, settings: ArpeggiatorSettings): MidiNote[] {
  if (!settings.enabled || notes.length === 0) return notes;
  const step = Math.max(0.02, arpStepSeconds(bpm, settings.rate));
  const octaves = Math.max(1, Math.min(4, Math.round(settings.octaves)));
  const gate = Math.max(0.05, Math.min(1, settings.gate));

  const out: MidiNote[] = [];
  let idCounter = 0;

  for (const chord of groupIntoChords(notes)) {
    const chordStart = Math.min(...chord.map((n) => n.start));
    const chordEnd = Math.max(...chord.map((n) => n.start + n.duration));
    const avgVelocity = chord.reduce((s, n) => s + n.velocity, 0) / chord.length;

    // Build the pool of pitches to step through: the chord's notes,
    // duplicated up an octave at a time, ordered by the chosen pattern.
    const asPlayedOrder = [...chord].sort((a, b) => a.start - b.start).map((n) => n.pitch);
    const ascending = [...new Set(chord.map((n) => n.pitch))].sort((a, b) => a - b);
    let basePitches: number[];
    switch (settings.pattern) {
      case "up":
        basePitches = ascending;
        break;
      case "down":
        basePitches = [...ascending].reverse();
        break;
      case "updown":
        basePitches = [...ascending, ...[...ascending].reverse().slice(1, -1)];
        break;
      case "asPlayed":
        basePitches = asPlayedOrder;
        break;
      case "random":
      default:
        basePitches = ascending;
        break;
    }
    if (basePitches.length === 0) continue;

    const pool: number[] = [];
    for (let o = 0; o < octaves; o++) {
      for (const p of basePitches) pool.push(Math.min(127, p + o * 12));
    }

    let stepIndex = 0;
    for (let t = chordStart; t < chordEnd - 1e-6; t += step) {
      const pitch =
        settings.pattern === "random"
          ? pool[Math.floor(Math.random() * pool.length)]
          : pool[stepIndex % pool.length];
      const dur = Math.min(step * gate, chordEnd - t);
      out.push({
        id: `arp-${idCounter++}-${t.toFixed(4)}`,
        pitch,
        start: t,
        duration: Math.max(0.02, dur),
        velocity: avgVelocity,
      });
      stepIndex++;
    }
  }

  return out;
}

/** Grid subdivisions offered by the piano roll's Quantize action. */
export type QuantizeGrid = "1/4" | "1/8" | "1/16" | "1/8t" | "1/16t";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI note number -> display name, e.g. 60 -> "C4". Used by the piano roll's key column. */
export function midiToNoteName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${octave}`;
}

/** Snaps every note's start time to the nearest step of the chosen grid
 *  subdivision, given the project's current bpm. Pure/synchronous — the
 *  store calls this and pushes an undo step, mirroring how the other
 *  destructive editing tools (Trim, Split, etc.) already work. */
export function quantizeMidiNotes(notes: MidiNote[], bpm: number, grid: QuantizeGrid): MidiNote[] {
  const quarter = 60 / Math.max(1, bpm);
  const stepSeconds: Record<QuantizeGrid, number> = {
    "1/4": quarter,
    "1/8": quarter / 2,
    "1/16": quarter / 4,
    "1/8t": quarter / 3,
    "1/16t": quarter / 6,
  };
  const step = stepSeconds[grid];
  return notes.map((n) => ({ ...n, start: Math.max(0, Math.round(n.start / step) * step) }));
}

// ---------------------------------------------------------------------------
// Scale Highlighting & Snapping — a project-wide "current scale" used by the
// piano roll to (a) dim out-of-scale rows and (b) optionally pull a newly
// placed note's pitch to the nearest in-scale pitch. Pure data + pure
// functions here; the store just holds root/type, the piano roll does the
// rendering.
// ---------------------------------------------------------------------------

export type ScaleType =
  | "major"
  | "naturalMinor"
  | "harmonicMinor"
  | "melodicMinor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "majorPentatonic"
  | "minorPentatonic"
  | "blues"
  | "chromatic";

/** Semitone offsets from the root, one octave. */
export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_LABELS: Record<ScaleType, string> = {
  major: "Major (Ionian)",
  naturalMinor: "Natural Minor",
  harmonicMinor: "Harmonic Minor",
  melodicMinor: "Melodic Minor",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  locrian: "Locrian",
  majorPentatonic: "Major Pentatonic",
  minorPentatonic: "Minor Pentatonic",
  blues: "Blues",
  chromatic: "Chromatic",
};

/** True if a MIDI pitch's pitch-class belongs to the given root/scale. */
export function isPitchInScale(pitch: number, root: number, scaleType: ScaleType): boolean {
  const pc = ((pitch - root) % 12 + 12) % 12;
  return SCALE_INTERVALS[scaleType].includes(pc);
}

/** Pulls a pitch to the nearest in-scale pitch (ties resolve upward). */
export function nearestScalePitch(pitch: number, root: number, scaleType: ScaleType): number {
  if (isPitchInScale(pitch, root, scaleType)) return pitch;
  for (let d = 1; d <= 6; d++) {
    if (isPitchInScale(pitch + d, root, scaleType)) return pitch + d;
    if (isPitchInScale(pitch - d, root, scaleType)) return pitch - d;
  }
  return pitch;
}

// ---------------------------------------------------------------------------
// Chord Track — purely descriptive markers (root + quality) placed on the
// timeline. No audio is generated from them; they're a reference lane the
// player reads while arranging/soloing over the song, same spirit as the
// Marker lane above.
// ---------------------------------------------------------------------------

export type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "maj7"
  | "min7"
  | "dom7"
  | "sus2"
  | "sus4";

export const CHORD_QUALITY_LABELS: Record<ChordQuality, string> = {
  maj: "",
  min: "m",
  dim: "dim",
  aug: "aug",
  maj7: "maj7",
  min7: "m7",
  dom7: "7",
  sus2: "sus2",
  sus4: "sus4",
};

const CHORD_ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Formats a chord event's root/quality as a short label, e.g. "F#m7". */
export function formatChordLabel(root: number, quality: ChordQuality): string {
  return `${CHORD_ROOT_NAMES[((root % 12) + 12) % 12]}${CHORD_QUALITY_LABELS[quality]}`;
}

// ---------------------------------------------------------------------------
// MIDI Humanize — the inverse of Quantize: nudges each note's start time and
// velocity by a small bounded random amount so a mechanically even part
// feels like it was actually played. Pure function; the store pushes an
// undo step around it like the other note transforms.
// ---------------------------------------------------------------------------

export function humanizeMidiNotes(notes: MidiNote[], timingMs: number, velocityAmount: number): MidiNote[] {
  const timingSec = Math.max(0, timingMs) / 1000;
  const velAmt = Math.max(0, Math.min(1, velocityAmount));
  return notes.map((n) => {
    const jitterTime = (Math.random() * 2 - 1) * timingSec;
    const jitterVel = (Math.random() * 2 - 1) * velAmt;
    return {
      ...n,
      start: Math.max(0, n.start + jitterTime),
      velocity: Math.max(0.05, Math.min(1, n.velocity + jitterVel)),
    };
  });
}

// ---------------------------------------------------------------------------
// Groove Extraction — captures the timing/velocity "feel" of one MIDI
// track relative to its own quantize grid (average offset + velocity per
// step-within-bar position), then re-applies that feel to another track's
// notes at a blendable amount. This is the inverse operation of Quantize:
// where Quantize erases timing deviation, a groove template captures and
// redistributes it.
// ---------------------------------------------------------------------------

export interface GrooveStep {
  /** Average seconds this step's notes sat off the grid (+ late, - early). */
  offset: number;
  /** Average velocity (0-1) of notes landing on this step. */
  velocity: number;
  /** How many source notes contributed to this step (for weighting/debug). */
  count: number;
}

export interface GrooveTemplate {
  grid: QuantizeGrid;
  /** One entry per grid step within a 4-beat bar (length = steps per bar). */
  steps: GrooveStep[];
}

function quantizeStepSeconds(bpm: number, grid: QuantizeGrid): number {
  const quarter = 60 / Math.max(1, bpm);
  const map: Record<QuantizeGrid, number> = {
    "1/4": quarter,
    "1/8": quarter / 2,
    "1/16": quarter / 4,
    "1/8t": quarter / 3,
    "1/16t": quarter / 6,
  };
  return map[grid];
}

/** Extracts a groove template from `notes` at the given grid/bpm: every note
 *  is assigned to its nearest grid step, bucketed by position-within-bar, and
 *  each bucket's average timing offset + velocity is kept. */
export function extractGroove(notes: MidiNote[], bpm: number, grid: QuantizeGrid): GrooveTemplate {
  const step = Math.max(0.001, quantizeStepSeconds(bpm, grid));
  const stepsPerBar = Math.max(1, Math.round((60 / Math.max(1, bpm)) * 4 / step));
  const buckets: { offsetSum: number; velSum: number; count: number }[] = Array.from(
    { length: stepsPerBar },
    () => ({ offsetSum: 0, velSum: 0, count: 0 })
  );

  for (const n of notes) {
    const gridIndex = Math.round(n.start / step);
    const nearestGridTime = gridIndex * step;
    const offset = n.start - nearestGridTime;
    const bucketIndex = ((gridIndex % stepsPerBar) + stepsPerBar) % stepsPerBar;
    const b = buckets[bucketIndex];
    b.offsetSum += offset;
    b.velSum += n.velocity;
    b.count += 1;
  }

  const steps: GrooveStep[] = buckets.map((b) => ({
    offset: b.count > 0 ? b.offsetSum / b.count : 0,
    velocity: b.count > 0 ? b.velSum / b.count : 0.85,
    count: b.count,
  }));

  return { grid, steps };
}

/** Re-applies a previously extracted groove template to `notes`: each note
 *  is snapped to its nearest grid step (same as Quantize) and then offset by
 *  the template's timing/velocity for that step-within-bar position, scaled
 *  by `amount` (0 = no change, 1 = full groove). bpm/grid should normally
 *  match what the template was extracted with, but any bpm works since the
 *  template is in seconds-per-step-relative terms. */
export function applyGroove(
  notes: MidiNote[],
  template: GrooveTemplate,
  bpm: number,
  grid: QuantizeGrid,
  amount: number
): MidiNote[] {
  const amt = Math.max(0, Math.min(1, amount));
  const step = Math.max(0.001, quantizeStepSeconds(bpm, grid));
  const stepsPerBar = template.steps.length || 1;

  return notes.map((n) => {
    const gridIndex = Math.round(n.start / step);
    const nearestGridTime = gridIndex * step;
    const bucketIndex = ((gridIndex % stepsPerBar) + stepsPerBar) % stepsPerBar;
    const groove = template.steps[bucketIndex];
    if (!groove || groove.count === 0) return { ...n, start: nearestGridTime };
    const targetStart = nearestGridTime + groove.offset * amt;
    const targetVelocity = n.velocity * (1 - amt) + groove.velocity * amt;
    return {
      ...n,
      start: Math.max(0, targetStart),
      velocity: Math.max(0.05, Math.min(1, targetVelocity)),
    };
  });
}

/** A single hosted Web Audio Modules (WAM) plugin instance, kept as plain
 *  serializable data in the store — the engine (below) owns the actual
 *  loaded module/audio node, looked up by `id`. */
export interface PluginSlot {
  id: string;
  name: string;
  url: string;
  bypassed: boolean;
  status: "loading" | "ready" | "error";
  error?: string;
}

/** A track shape minimal enough for offline rendering — deliberately a
 *  subset of the store's `Track` so `renderProjectOffline` doesn't need to
 *  import the store (that would be circular; the store already imports
 *  from this file). Any object with at least these fields can be passed. */
export interface RenderableTrack {
  id: string;
  kind: "audio" | "midi";
  fileUrl?: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  notes: MidiNote[];
  instrument: SynthWaveform;
}

/**
 * Bounces the whole project to a single stereo WAV file using Tone.Offline
 * (a real OfflineAudioContext under the hood, not real-time capture).
 *
 * Known limitation (documented the same way as this file's other offline
 * transforms): this is a plain mixdown of each track's volume/pan/mute/solo.
 * It does not replay the live per-track FX rack, buses, automation curves,
 * or WAM plugin chain — those all live on the real-time `Tone.Context`
 * nodes created in `loadTrack`, which Tone.Offline can't reuse since it
 * runs the callback against a temporary offline context. Bouncing the full
 * per-track chain would mean rebuilding that entire node graph a second
 * time inside the offline callback; flagged here as a follow-up rather than
 * attempted half-correctly.
 */
export async function renderProjectOffline(
  tracks: RenderableTrack[],
  bpm: number,
  onProgress?: (p: number) => void
): Promise<Blob> {
  const anySolo = tracks.some((t) => t.solo);
  const audible = tracks.filter((t) => (anySolo ? t.solo : !t.muted));

  const bufferCache = new Map<string, AudioBuffer>();
  let duration = 4;
  for (const t of audible) {
    if (t.kind === "audio" && t.fileUrl) {
      const buf = await urlToAudioBuffer(t.fileUrl);
      bufferCache.set(t.id, buf);
      duration = Math.max(duration, buf.duration);
    } else if (t.kind === "midi") {
      const end = t.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
      duration = Math.max(duration, end);
    }
  }
  duration += 1.5; // tail for the last note/sample to ring out

  onProgress?.(0.1);

  const rendered = await Tone.Offline(({ transport }: any) => {
    transport.bpm.value = bpm;
    audible.forEach((t) => {
      const panner = new Tone.Panner(t.pan).toDestination();
      const gain = new Tone.Gain(t.volume).connect(panner);
      if (t.kind === "audio") {
        const buf = bufferCache.get(t.id);
        if (!buf) return;
        const player = new Tone.Player(buf).connect(gain);
        player.start(0);
      } else {
        const synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: t.instrument },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.3 },
        }).connect(gain);
        t.notes.forEach((n) => {
          synth.triggerAttackRelease(
            Tone.Frequency(n.pitch, "midi").toFrequency(),
            n.duration,
            n.start,
            n.velocity
          );
        });
      }
    });
    transport.start(0);
  }, duration);

  onProgress?.(0.9);
  const wav = audioBufferToWav(rendered.get() as unknown as AudioBuffer);
  onProgress?.(1);
  return wav;
}

interface TrackNodes {
  player: ToneImport.Player;
  gate: ToneImport.Gate;
  eq: ToneImport.EQ3;
  /** Dynamic EQ: 3-band split, each behind its own Tone.Compressor, summed
   *  back and blended against a dry tap by `wet` (see setDynamicEq). Sits
   *  between the static EQ3 and Filter in the chain. */
  dynEqIn: ToneImport.Gain;
  dynEqDry: ToneImport.Gain;
  dynEqLowFilter: ToneImport.Filter;
  dynEqLowComp: ToneImport.Compressor;
  dynEqMidFilterHP: ToneImport.Filter;
  dynEqMidFilterLP: ToneImport.Filter;
  dynEqMidComp: ToneImport.Compressor;
  dynEqHighFilter: ToneImport.Filter;
  dynEqHighComp: ToneImport.Compressor;
  dynEqWetSum: ToneImport.Gain;
  dynEqOut: ToneImport.Gain;
  filter: ToneImport.Filter;
  compressor: ToneImport.Compressor;
  limiter: ToneImport.Limiter;
  distortion: ToneImport.Distortion;
  saturation: ToneImport.Chebyshev;
  bitcrusher: ToneImport.BitCrusher;
  chorus: ToneImport.Chorus;
  flangerDelay: ToneImport.Delay;
  flangerLFO: ToneImport.LFO;
  flangerFeedback: ToneImport.Gain;
  flangerWetGain: ToneImport.Gain;
  flangerDryGain: ToneImport.Gain;
  flangerSum: ToneImport.Gain;
  /** Free-assignable modulation LFO (see ModLfoTarget) — built but left
   *  disconnected until setModLfo() routes it to a target param. */
  modLfo: ToneImport.LFO;
  phaser: ToneImport.Phaser;
  tremolo: ToneImport.Tremolo;
  vibrato: ToneImport.Vibrato;
  pitchShift: ToneImport.PitchShift;
  autoTuneAnalyser: ToneImport.Analyser;
  autoTuneShift: ToneImport.PitchShift;
  deEsserSplitHigh: ToneImport.Filter;
  deEsserSplitLow: ToneImport.Filter;
  deEsserComp: ToneImport.Compressor;
  deEsserSum: ToneImport.Gain;
  delay: ToneImport.FeedbackDelay;
  reverb: ToneImport.Reverb;
  harmVoice1Shift: ToneImport.PitchShift;
  harmVoice1Gain: ToneImport.Gain;
  harmVoice2Shift: ToneImport.PitchShift;
  harmVoice2Gain: ToneImport.Gain;
  harmSum: ToneImport.Gain;
  vocoderCarrier: ToneImport.OmniOscillator<ToneImport.Oscillator | ToneImport.PulseOscillator>;
  vocoderDry: ToneImport.Gain;
  vocoderWetSum: ToneImport.Gain;
  vocoderOut: ToneImport.Gain;
  vocoderBands: VocoderBandNodes[];
  /** Envelope Shaping (internal, no UI — see EnvelopeShapeSettings). */
  envShape: ToneImport.Compressor;
  /** Multiband Compressor nodes (see setMultibandCompressor). */
  mbcIn: ToneImport.Gain;
  mbcDry: ToneImport.Gain;
  mbcLowFilter: ToneImport.Filter;
  mbcLowComp: ToneImport.Compressor;
  mbcLowMakeup: ToneImport.Gain;
  mbcMidFilterHP: ToneImport.Filter;
  mbcMidFilterLP: ToneImport.Filter;
  mbcMidComp: ToneImport.Compressor;
  mbcMidMakeup: ToneImport.Gain;
  mbcHighFilter: ToneImport.Filter;
  mbcHighComp: ToneImport.Compressor;
  mbcHighMakeup: ToneImport.Gain;
  mbcWetSum: ToneImport.Gain;
  mbcOut: ToneImport.Gain;
  /** Transient Shaper nodes (see setTransientShaper). */
  tsIn: ToneImport.Gain;
  tsDry: ToneImport.Gain;
  tsAttackDetector: ToneImport.Compressor;
  tsAttackTap: ToneImport.Gain;
  tsSustainDetector: ToneImport.Compressor;
  tsSustainTap: ToneImport.Gain;
  tsOut: ToneImport.Gain;
  /** Exciter / Enhancer nodes (see setExciter). */
  exciterHP: ToneImport.Filter;
  exciterSaturate: ToneImport.Chebyshev;
  exciterWet: ToneImport.Gain;
  exciterDry: ToneImport.Gain;
  exciterOut: ToneImport.Gain;
  /** Formant Shifting nodes (see setFormantShift). */
  formantShiftNode: ToneImport.PitchShift;
  formantFilter: ToneImport.Filter;
  formantWet: ToneImport.Gain;
  formantDry: ToneImport.Gain;
  formantOut: ToneImport.Gain;
  /** Convolution Reverb nodes (see setConvolutionReverb). */
  convolver: ToneImport.Convolver;
  convolverWet: ToneImport.Gain;
  convolverDry: ToneImport.Gain;
  convolverOut: ToneImport.Gain;
  /** Ring Modulation nodes (see setRingMod). */
  ringModCarrier: ToneImport.Oscillator;
  ringModVCA: ToneImport.Gain;
  ringModWet: ToneImport.Gain;
  ringModDry: ToneImport.Gain;
  ringModOut: ToneImport.Gain;
  /** Stereo Imager / Widener (see setStereoImager). */
  stereoWidener: ToneImport.StereoWidener;
  /** Phase Inversion / Polarity Flip: a plain unity/-1 Gain right after the
   *  player (see setPolarity). Sits before every other processing stage so
   *  it flips the raw source, not some already-processed version of it. */
  polarity: ToneImport.Gain;
  /** Spatial Audio / 3D positioning (see setSpatial). `spatialPanner` is a
   *  real HRTF PannerNode; `spatialDry`/`spatialWet` crossfade between the
   *  plain (pre-existing) stereo pan path and the 3D-positioned path so
   *  enabling/disabling it doesn't require rewiring the graph. */
  spatialIn: ToneImport.Gain;
  spatialDry: ToneImport.Gain;
  spatialPanner: ToneImport.Panner3D;
  spatialWet: ToneImport.Gain;
  spatialOut: ToneImport.Gain;
  /** WAM plugin-chain insertion point, spliced in right before the panner.
   *  Plain native GainNodes (not Tone-wrapped) since hosted WAM plugins
   *  expose raw Web Audio `AudioNode`s — see `loadPlugin`/`rebuildPluginChain`. */
  pluginsIn: GainNode;
  pluginsOut: GainNode;
  panner: ToneImport.Panner;
  /** Sidechain-ducking VCA, spliced between panner and gain. Sits at unity
   *  (1) when no sidechain is active; see AudioEngine.setSidechain. */
  duckGain: ToneImport.Gain;
  gain: ToneImport.Gain;
  meter: ToneImport.Meter;
  url: string;
}

/** One loaded Web Audio Modules plugin instance for a track's plugin chain. */
interface LoadedPlugin {
  id: string;
  node: AudioNode;
  instance: { destroy?: () => void; audioNode?: AudioNode; [k: string]: unknown };
}

/** Engine-side state for a MIDI track: a PolySynth driven by a Tone.Part
 *  built from the store's note array, routed through its own panner/gain
 *  so mute/solo/volume/pan work exactly like an audio track. */
/** One voice in the granular engine's small round-robin pool. Each note
 *  triggers grains from `sampleBuffer` at a playbackRate derived from the
 *  requested pitch vs. the sample's declared base note. */
interface GranularVoice {
  player: ToneImport.GrainPlayer;
  gain: ToneImport.Gain;
  busy: boolean;
  stopHandle: ReturnType<typeof setTimeout> | null;
}

interface MidiTrackNodes {
  synth: ToneImport.PolySynth;
  panner: ToneImport.Panner;
  gain: ToneImport.Gain;
  meter: ToneImport.Meter;
  part: ToneImport.Part | null;
  /** Which engine is currently live for this track (subtractive/wavetable
   *  share `synth`; granular uses `granularVoices` instead). */
  engine: InstrumentEngine;
  granularSampleBuffer: AudioBuffer | null;
  granularVoices: GranularVoice[];
}

interface VocoderBandNodes {
  modFilter: ToneImport.Filter;
  rectifier: ToneImport.WaveShaper;
  envelope: ToneImport.Filter;
  carrierFilter: ToneImport.Filter;
  vca: ToneImport.Gain;
}

/** A bus is a lightweight submix group: N tracks route their post-fader
 *  signal into one shared gain/pan/meter, which then feeds the master bus.
 *  Kept simpler than the per-track chain (no full FX rack) — grouping +
 *  shared trim/pan is the 80% use case ("Drums" bus, "Vocals" bus, etc). */
interface BusNodes {
  gain: ToneImport.Gain;
  panner: ToneImport.Panner;
  meter: ToneImport.Meter;
}

const VOCODER_BAND_COUNT = 8;
const VOCODER_MIN_HZ = 150;
const VOCODER_MAX_HZ = 6000;

/** Synthesizes a stereo impulse response for Convolution Reverb: filtered
 *  white noise shaped by an exponential decay envelope. Each "space" preset
 *  picks a duration/decay/tone that approximates the room type — this is a
 *  procedural IR (no sample library shipped), same spirit as the app's
 *  synthesized vocoder carrier. */
async function generateImpulseResponse(
  irType: "room" | "hall" | "plate" | "cathedral"
): Promise<AudioBuffer | null> {
  if (typeof window === "undefined") return null;
  const ctx = Tone.getContext().rawContext as unknown as AudioContext;
  const presets = {
    room: { duration: 0.6, decay: 3.5, damping: 0.3 },
    hall: { duration: 2.2, decay: 2.2, damping: 0.15 },
    plate: { duration: 1.4, decay: 4, damping: 0.05 },
    cathedral: { duration: 4.5, decay: 1.6, damping: 0.35 },
  } as const;
  const { duration, decay, damping } = presets[irType];
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const envelope = Math.pow(1 - t, decay);
      const noise = Math.random() * 2 - 1;
      lp = lp + (noise - lp) * (1 - damping); // gentle lowpass so tail isn't harsh white noise
      data[i] = lp * envelope;
    }
  }
  return buffer;
}

/** Log-spaced band center frequencies covering the vocal formant range. */
function vocoderBandFrequencies(): number[] {
  const bands: number[] = [];
  for (let i = 0; i < VOCODER_BAND_COUNT; i++) {
    const t = i / (VOCODER_BAND_COUNT - 1);
    bands.push(VOCODER_MIN_HZ * Math.pow(VOCODER_MAX_HZ / VOCODER_MIN_HZ, t));
  }
  return bands;
}

class AudioEngine {
  private trackNodes: Map<string, TrackNodes> = new Map();
  private metronome: ToneImport.Synth | null = null;
  private metronomeLoop: ToneImport.Loop | null = null;

  private masterGain!: ToneImport.Gain;
  private masterCompressor!: ToneImport.Compressor;
  private masterLimiter!: ToneImport.Limiter;
  private masterMeter!: ToneImport.Meter;
  private masterAnalyser!: ToneImport.Analyser;

  // --- Metering suite taps (Phase Correlation / Goniometer / True Peak / Tuner) ---
  // All passive parallel taps off the post-limiter bus, same pattern as masterAnalyser:
  // Split -> a waveform Analyser per channel, so the UI can read real L/R sample
  // buffers every frame without adding anything to the actual signal path.
  private masterSplit!: ToneImport.Split;
  private masterWaveformL!: ToneImport.Analyser;
  private masterWaveformR!: ToneImport.Analyser;

  private started = false;
  private soloedTrackIds: Set<string> = new Set();

  // --- Buses (submix groups) ---
  private busNodes: Map<string, BusNodes> = new Map();
  // Persisted across track reloads (disposeTrack/loadTrack), so a bus
  // assignment survives things like Reverse/Time-Stretch which rebuild nodes.
  private trackBusId: Map<string, string | null> = new Map();

  // --- Automation ---
  private trackLastVolume: Map<string, number> = new Map();
  private trackLastPan: Map<string, number> = new Map();
  private convolutionIrType: Map<string, "room" | "hall" | "plate" | "cathedral"> = new Map();
  private trackAutomation: Map<string, TrackAutomation> = new Map();
  private automationEventIds: Map<string, number[]> = new Map();

  // --- WAM plugin hosting (per audio track) ---
  private pluginChains: Map<string, LoadedPlugin[]> = new Map();
  private pluginBypassed: Map<string, Set<string>> = new Map();

  // --- MIDI tracks (separate parallel engine, mixed through the same master bus) ---
  private midiNodes: Map<string, MidiTrackNodes> = new Map();


  // Auto-Tune: a single shared, throttled detection loop serves every
  // enabled track (pitch detection is too costly to run every rAF frame).
  private autoTuneLoopId: ReturnType<typeof setInterval> | null = null;
  private autoTuneParams: Map<
    string,
    { key: number; scale: "chromatic" | "major" | "minor"; retune: number }
  > = new Map();
  private autoTuneCurrentSemitones: Map<string, number> = new Map();

  // --- Workflow: Nudge — per-track playback offset in seconds (+ = later,
  // - = earlier), applied without touching the underlying buffer. ---
  private trackNudge: Map<string, number> = new Map();

  // --- Workflow: Sidechaining — fake-keyed ducking via envelope follower,
  // since Web Audio's compressor has no external key input. ---
  private sidechainSettings: Map<string, { enabled: boolean; sourceTrackId: string | null; amount: number }> = new Map();
  private sidechainNodes: Map<string, { follower: ToneImport.Follower; scale: ToneImport.Scale; sourceTrackId: string }> = new Map();

  // --- Free-assignable Mod LFO: which param each track's modLfo node is
  // currently wired into (or "off"), so setModLfo can tell when it needs
  // to disconnect from the old target before connecting to a new one. ---
  private modLfoTarget: Map<string, ModLfoTarget> = new Map();

  // --- Workflow: Input Monitoring / Punch / Loop Comping — a single shared
  // mic stream + Tone.Recorder, reused by whichever feature needs to capture. ---
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micRecorder: ToneImport.Recorder | null = null;
  private monitorGain!: ToneImport.Gain;

  constructor() {
    // Next.js prerenders pages (including "use client" ones) once on the
    // server to produce the initial HTML. This module is imported eagerly
    // (export const audioEngine = new AudioEngine() below), so that server
    // pass would otherwise run this constructor in Node.js, which has no
    // real Web Audio API. Tone.js falls back to an internal dummy context
    // in that case, and building real nodes against it throws deep inside
    // Tone's own Param validation. Every real call into this engine comes
    // from browser-only event handlers/effects, so it's safe to just skip
    // building the node graph here — it gets built for real the first time
    // this runs in an actual browser.
    if (typeof window === "undefined") return;

    this.masterMeter = new Tone.Meter({ normalRange: false, smoothing: 0.8 });
    // FFT analyser tapped in parallel off the limiter (post-dynamics, pre-destination)
    // so the spectrum view reflects exactly what's audible, without sitting in the
    // signal path itself (Tone.Analyser is a passive tap, not a processing node).
    this.masterAnalyser = new Tone.Analyser({ type: "fft", size: 1024, smoothing: 0.75 });
    this.masterLimiter = new Tone.Limiter(-0.3).connect(this.masterMeter);
    this.masterLimiter.connect(this.masterAnalyser);
    this.masterLimiter.toDestination();

    // Stereo taps for the metering suite: split post-limiter L/R into their
    // own waveform analysers. Passive (Split doesn't affect what reaches
    // the destination), so this is purely a UI read-out path.
    this.masterSplit = new Tone.Split();
    this.masterLimiter.connect(this.masterSplit);
    this.masterWaveformL = new Tone.Analyser({ type: "waveform", size: 2048 });
    this.masterWaveformR = new Tone.Analyser({ type: "waveform", size: 2048 });
    this.masterSplit.connect(this.masterWaveformL, 0, 0);
    this.masterSplit.connect(this.masterWaveformR, 1, 0);
    this.masterCompressor = new Tone.Compressor({
      threshold: -12,
      ratio: 4,
      attack: 0.01,
      release: 0.2,
    }).connect(this.masterLimiter);
    this.masterGain = new Tone.Gain(1).connect(this.masterCompressor);

    // Workflow: Input Monitoring — live mic passthrough, muted (gain 0)
    // until a track is both armed and monitor-enabled (see setMonitorActive).
    this.monitorGain = new Tone.Gain(0).connect(this.masterGain);

    // Workflow: Loop — when the transport wraps back to loopStart, every
    // track's Player needs to be re-triggered at the new position since
    // they're one-shot-scheduled (not natively transport-synced).
    Tone.Transport.on("loop", () => {
      if (Tone.Transport.state === "started") this.startTrackPlayers();
    });
  }

  async start() {
    if (this.started) return;
    await Tone.start();
    this.started = true;
  }

  isStarted() {
    return this.started;
  }

  setMasterVolume(v: number) {
    this.masterGain.gain.rampTo(v, 0.05);
  }

  /** LUFS-style level readouts (approximated from Tone.Meter's RMS in dB). */
  getMasterLevelDb() {
    const v = this.masterMeter.getValue();
    return typeof v === "number" ? v : v[0];
  }

  getTrackLevelDb(trackId: string) {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return -Infinity;
    const v = nodes.meter.getValue();
    return typeof v === "number" ? v : v[0];
  }

  /** Master-bus FFT bins in dB (length = analyser size / 2), for the Spectrum Analyzer UI. */
  getMasterSpectrum(): Float32Array {
    const v = this.masterAnalyser.getValue();
    return (typeof v === "number" ? new Float32Array([v]) : (v as Float32Array));
  }

  /** Raw post-limiter L/R sample buffers, shared by the Goniometer, Phase
   *  Correlation, and True Peak meters (and downmixed for the Tuner). */
  getMasterStereoWaveforms(): { left: Float32Array; right: Float32Array } {
    const l = this.masterWaveformL.getValue();
    const r = this.masterWaveformR.getValue();
    return {
      left: typeof l === "number" ? new Float32Array([l]) : (l as Float32Array),
      right: typeof r === "number" ? new Float32Array([r]) : (r as Float32Array),
    };
  }

  /** Per-channel RMS in dB, for stereo LUFS-style bar meters (the overall
   *  program readout stays on getMasterLevelDb(), tapped from Tone.Meter). */
  getMasterChannelLevelsDb(): { left: number; right: number } {
    const { left, right } = this.getMasterStereoWaveforms();
    return { left: rmsDb(left), right: rmsDb(right) };
  }

  /** Phase correlation of the stereo image: +1 = perfectly in-phase (mono-
   *  compatible), 0 = uncorrelated, -1 = fully out-of-phase (will cancel to
   *  silence in mono). Computed directly from the L/R waveform buffers. */
  getPhaseCorrelation(): number {
    const { left, right } = this.getMasterStereoWaveforms();
    const n = Math.min(left.length, right.length);
    if (n === 0) return 1;
    let sumLR = 0;
    let sumLL = 0;
    let sumRR = 0;
    for (let i = 0; i < n; i++) {
      sumLR += left[i] * right[i];
      sumLL += left[i] * left[i];
      sumRR += right[i] * right[i];
    }
    const denom = Math.sqrt(sumLL * sumRR);
    if (denom < 1e-9) return 1; // silence: nothing to decorrelate, treat as safe
    return Math.max(-1, Math.min(1, sumLR / denom));
  }

  /** True-peak estimate in dBTP for each channel: 4x-oversamples the waveform
   *  buffer (linear interpolation between samples) so inter-sample peaks that
   *  a plain sample-peak reading would miss still show up. This is a light
   *  approximation of ITU-R BS.1770 true-peak metering, not a full polyphase
   *  filter implementation, but it catches the same class of clipping. */
  getMasterTruePeakDb(): { left: number; right: number } {
    const { left, right } = this.getMasterStereoWaveforms();
    return {
      left: linearToDb(estimateTruePeakLinear(left)),
      right: linearToDb(estimateTruePeakLinear(right)),
    };
  }

  /** Detected fundamental frequency (Hz) of the current master mix, or -1 if
   *  no confident pitch is found (silence, noise, or a dense/chordal mix).
   *  Reuses the same autocorrelation detector as Auto-Tune, on a mono
   *  downmix of the L/R taps — works best on monophonic material soloed
   *  through the master (a single vocal, guitar, or bass track). */
  getTunerPitch(): number {
    const { left, right } = this.getMasterStereoWaveforms();
    const n = Math.min(left.length, right.length);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) / 2;
    return detectPitch(mono, Tone.getContext().sampleRate);
  }

  /** Register / load an audio file into a track's full effect chain. */
  async loadTrack(trackId: string, url: string, reversed = false) {
    this.disposeTrack(trackId);

    let finalUrl = url;
    if (reversed) {
      finalUrl = await this.buildReversedUrl(url);
    }

    // --- Build all nodes ---
    const gate = new Tone.Gate({ threshold: -60 });
    // Envelope Shaping (internal, no UI control — see EnvelopeShapeSettings /
    // defaultEnvelopeShape). Ratio 1 = neutral no-op by default.
    const envShape = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.003, release: 0.15 });
    const eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 });

    // Dynamic EQ: split into low/mid/high bands, each behind its own
    // Compressor so that band only ducks when its own level crosses
    // threshold; bands sum back and blend against a dry tap by `wet`.
    const dynEqIn = new Tone.Gain(1);
    const dynEqDry = new Tone.Gain(1);
    const dynEqLowFilter = new Tone.Filter({ type: "lowpass", frequency: 200, Q: 0.7 });
    const dynEqLowComp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.2 });
    const dynEqMidFilterHP = new Tone.Filter({ type: "highpass", frequency: 200, Q: 0.7 });
    const dynEqMidFilterLP = new Tone.Filter({ type: "lowpass", frequency: 3000, Q: 0.7 });
    const dynEqMidComp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.2 });
    const dynEqHighFilter = new Tone.Filter({ type: "highpass", frequency: 3000, Q: 0.7 });
    const dynEqHighComp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.2 });
    const dynEqWetSum = new Tone.Gain(1);
    const dynEqOut = new Tone.Gain(1);
    dynEqIn.connect(dynEqDry);
    dynEqIn.connect(dynEqLowFilter);
    dynEqIn.connect(dynEqMidFilterHP);
    dynEqIn.connect(dynEqHighFilter);
    dynEqLowFilter.connect(dynEqLowComp);
    dynEqLowComp.connect(dynEqWetSum);
    dynEqMidFilterHP.connect(dynEqMidFilterLP);
    dynEqMidFilterLP.connect(dynEqMidComp);
    dynEqMidComp.connect(dynEqWetSum);
    dynEqHighFilter.connect(dynEqHighComp);
    dynEqHighComp.connect(dynEqWetSum);
    dynEqDry.connect(dynEqOut);
    dynEqWetSum.connect(dynEqOut);
    // starts disabled: dry=1, wet=0 (see setDynamicEq)
    dynEqDry.gain.value = 1;
    dynEqWetSum.gain.value = 0;

    const filter = new Tone.Filter({ type: "lowpass", frequency: 20000, Q: 1 });
    const compressor = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.02, release: 0.25 });
    const limiter = new Tone.Limiter(0);
    const distortion = new Tone.Distortion({ distortion: 0, wet: 0 });
    const saturation = new Tone.Chebyshev({ order: 1, wet: 0 });
    const bitcrusher = new Tone.BitCrusher({ bits: 16 });
    bitcrusher.wet.value = 0;
    const chorus = new Tone.Chorus({ frequency: 1.5, depth: 0.7, wet: 0 }).start();
    const phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0 });
    const tremolo = new Tone.Tremolo({ frequency: 4, depth: 0.6, wet: 0 }).start();
    const vibrato = new Tone.Vibrato({ frequency: 5, depth: 0.3, wet: 0 });
    const pitchShift = new Tone.PitchShift({ pitch: 0, wet: 0 });
    const autoTuneAnalyser = new Tone.Analyser({ type: "waveform", size: 2048 });
    const autoTuneShift = new Tone.PitchShift({ pitch: 0, wet: 0 });
    const delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.3, wet: 0 });
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0 });
    const panner = new Tone.Panner(0);
    const duckGain = new Tone.Gain(1);
    const gain = new Tone.Gain(0.85);
    const meter = new Tone.Meter({ normalRange: false, smoothing: 0.8 });

    // Harmonizer: two extra pitch-shifted voices, mixed under the always-on
    // dry path. Both voice gains default to 0 (bypassed) until enabled.
    const harmVoice1Shift = new Tone.PitchShift({ pitch: 4, wet: 1 });
    const harmVoice1Gain = new Tone.Gain(0);
    const harmVoice2Shift = new Tone.PitchShift({ pitch: 7, wet: 1 });
    const harmVoice2Gain = new Tone.Gain(0);
    const harmSum = new Tone.Gain(1);

    // Classic multiband vocoder: modulator (this track's own signal) is
    // split into bands, each band's envelope (rectify + lowpass) drives a
    // Gain acting as a VCA on the same band of the carrier oscillator.
    // Bands sum into vocoderWetSum; vocoderOut mixes that against the dry
    // signal by `wet`.
    const vocoderCarrier = new Tone.OmniOscillator({ type: "sawtooth", frequency: 110 }).start();
    const vocoderDry = new Tone.Gain(1);
    const vocoderWetSum = new Tone.Gain(0);
    const vocoderOut = new Tone.Gain(1);
    const vocoderBands: VocoderBandNodes[] = vocoderBandFrequencies().map((freq) => {
      const modFilter = new Tone.Filter({ type: "bandpass", frequency: freq, Q: 4 });
      const rectifier = new Tone.WaveShaper((x: any) => Math.abs(x), 1024);
      const envelope = new Tone.Filter({ type: "lowpass", frequency: 20, Q: 0.5 });
      const carrierFilter = new Tone.Filter({ type: "bandpass", frequency: freq, Q: 4 });
      const vca = new Tone.Gain(0);
      modFilter.connect(rectifier);
      rectifier.connect(envelope);
      envelope.connect(vca.gain);
      vocoderCarrier.connect(carrierFilter);
      carrierFilter.connect(vca);
      vca.connect(vocoderWetSum);
      return { modFilter, rectifier, envelope, carrierFilter, vca };
    });

    // Custom flanger built from a modulated short delay line + feedback.
    const flangerDelay = new Tone.Delay(0.005, 0.02);
    const flangerLFO = new Tone.LFO({ frequency: 0.25, min: 0.001, max: 0.008 }).start();
    const flangerFeedback = new Tone.Gain(0.4);
    const flangerWetGain = new Tone.Gain(0);
    const flangerDryGain = new Tone.Gain(1);
    const flangerSum = new Tone.Gain(1);
    flangerLFO.connect(flangerDelay.delayTime);
    flangerDelay.connect(flangerFeedback);
    flangerFeedback.connect(flangerDelay);
    flangerDelay.connect(flangerWetGain);
    flangerWetGain.connect(flangerSum);
    flangerDryGain.connect(flangerSum);

    // Free-assignable modulation LFO: same kind of node as flangerLFO above,
    // but general-purpose — it starts running and disconnected, and
    // setModLfo() wires it into whichever chain param the user picks.
    const modLfo = new Tone.LFO({ frequency: 2, type: "sine", min: -1, max: 1 }).start();

    // De-esser: split into a high band (sibilance) that gets compressed hard,
    // and a low band that passes through untouched, then sum them back.
    const deEsserSplitHigh = new Tone.Filter({ type: "highpass", frequency: 6000, Q: 0.7 });
    const deEsserSplitLow = new Tone.Filter({ type: "lowpass", frequency: 6000, Q: 0.7 });
    const deEsserComp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.001, release: 0.05 });
    const deEsserSum = new Tone.Gain(1);
    deEsserSplitHigh.connect(deEsserComp);
    deEsserComp.connect(deEsserSum);
    deEsserSplitLow.connect(deEsserSum);

    const player = new Tone.Player({ url: finalUrl });
    // Phase Inversion / Polarity Flip: unity by default (1), flips to -1
    // when enabled (see setPolarity). Sits first, ahead of every other node.
    const polarity = new Tone.Gain(1);

    // -------------------------------------------------------------------
    // New inserts, spliced after the Vocoder and before the WAM plugin
    // chain: Multiband Compressor -> Transient Shaper -> Exciter ->
    // Formant Shift -> Convolution Reverb -> Ring Modulation -> Stereo
    // Imager. Each follows the same enabled-dry/wet-blend pattern already
    // used above so a disabled effect is a transparent passthrough.
    // -------------------------------------------------------------------

    // Multiband Compressor: 3-band split, each band independently
    // compressed + made-up, then always summed (no dry blend needed for
    // the "enabled" band mix — see mbcDry/mbcWetSum for the bypass toggle).
    const mbcIn = new Tone.Gain(1);
    const mbcDry = new Tone.Gain(1);
    const mbcLowFilter = new Tone.Filter({ type: "lowpass", frequency: 200, Q: 0.7 });
    const mbcLowComp = new Tone.Compressor({ threshold: -24, ratio: 3, attack: 0.01, release: 0.2 });
    const mbcLowMakeup = new Tone.Gain(1);
    const mbcMidFilterHP = new Tone.Filter({ type: "highpass", frequency: 200, Q: 0.7 });
    const mbcMidFilterLP = new Tone.Filter({ type: "lowpass", frequency: 3000, Q: 0.7 });
    const mbcMidComp = new Tone.Compressor({ threshold: -24, ratio: 3, attack: 0.01, release: 0.2 });
    const mbcMidMakeup = new Tone.Gain(1);
    const mbcHighFilter = new Tone.Filter({ type: "highpass", frequency: 3000, Q: 0.7 });
    const mbcHighComp = new Tone.Compressor({ threshold: -24, ratio: 3, attack: 0.01, release: 0.2 });
    const mbcHighMakeup = new Tone.Gain(1);
    const mbcWetSum = new Tone.Gain(0);
    const mbcOut = new Tone.Gain(1);
    mbcIn.connect(mbcDry);
    mbcIn.connect(mbcLowFilter);
    mbcIn.connect(mbcMidFilterHP);
    mbcIn.connect(mbcHighFilter);
    mbcLowFilter.connect(mbcLowComp);
    mbcLowComp.connect(mbcLowMakeup);
    mbcLowMakeup.connect(mbcWetSum);
    mbcMidFilterHP.connect(mbcMidFilterLP);
    mbcMidFilterLP.connect(mbcMidComp);
    mbcMidComp.connect(mbcMidMakeup);
    mbcMidMakeup.connect(mbcWetSum);
    mbcHighFilter.connect(mbcHighComp);
    mbcHighComp.connect(mbcHighMakeup);
    mbcHighMakeup.connect(mbcWetSum);
    mbcDry.connect(mbcOut);
    mbcWetSum.connect(mbcOut);
    // starts disabled: dry=1, wet=0 (see setMultibandCompressor)

    // Transient Shaper: a slow-attack/fast-release "attack detector" and a
    // fast-attack/slow-release "sustain detector" each tap the signal;
    // their outputs are blended back against the dry path with signed
    // gains (positive = boost that part, negative = soften it).
    const tsIn = new Tone.Gain(1);
    const tsDry = new Tone.Gain(1);
    const tsAttackDetector = new Tone.Compressor({ threshold: -24, ratio: 6, attack: 0.03, release: 0.15 });
    const tsAttackTap = new Tone.Gain(0);
    const tsSustainDetector = new Tone.Compressor({ threshold: -24, ratio: 6, attack: 0.001, release: 0.4 });
    const tsSustainTap = new Tone.Gain(0);
    const tsOut = new Tone.Gain(1);
    tsIn.connect(tsDry);
    tsDry.connect(tsOut);
    tsIn.connect(tsAttackDetector);
    tsAttackDetector.connect(tsAttackTap);
    tsAttackTap.connect(tsOut);
    tsIn.connect(tsSustainDetector);
    tsSustainDetector.connect(tsSustainTap);
    tsSustainTap.connect(tsOut);

    // Exciter / Enhancer: harmonic saturation on a high-frequency tap,
    // blended back in to add "air" without an overall level jump.
    const exciterHP = new Tone.Filter({ type: "highpass", frequency: 3000, Q: 0.7 });
    const exciterSaturate = new Tone.Chebyshev({ order: 2, wet: 1 });
    const exciterWet = new Tone.Gain(0);
    const exciterDry = new Tone.Gain(1);
    const exciterOut = new Tone.Gain(1);
    exciterDry.connect(exciterOut);
    exciterHP.connect(exciterSaturate);
    exciterSaturate.connect(exciterWet);
    exciterWet.connect(exciterOut);

    // Formant Shifting: pitch-shifts a band-limited (vocal-formant-range)
    // copy and blends it back — an approximation (see field doc comment).
    const formantShiftNode = new Tone.PitchShift({ pitch: 0, wet: 1 });
    const formantFilter = new Tone.Filter({ type: "bandpass", frequency: 1500, Q: 0.6 });
    const formantWet = new Tone.Gain(0);
    const formantDry = new Tone.Gain(1);
    const formantOut = new Tone.Gain(1);
    formantDry.connect(formantOut);
    formantShiftNode.connect(formantFilter);
    formantFilter.connect(formantWet);
    formantWet.connect(formantOut);

    // Convolution Reverb: Tone.Convolver against a synthesized impulse
    // response (see AudioEngine.setConvolutionReverb / generateImpulse).
    const convolver = new Tone.Convolver();
    const convolverWet = new Tone.Gain(0);
    const convolverDry = new Tone.Gain(1);
    const convolverOut = new Tone.Gain(1);
    convolverDry.connect(convolverOut);
    convolver.connect(convolverWet);
    convolverWet.connect(convolverOut);
    generateImpulseResponse("hall").then((buf) => {
      if (buf) convolver.buffer = new Tone.ToneAudioBuffer(buf);
    });

    // Ring Modulation: true audio-rate multiply — the carrier oscillator
    // drives ringModVCA's gain param directly (intrinsic gain 0, so the
    // node's output is literally input * carrier(t)).
    const ringModCarrier = new Tone.Oscillator({ type: "sine", frequency: 30 }).start();
    const ringModVCA = new Tone.Gain(0);
    const ringModWet = new Tone.Gain(0);
    const ringModDry = new Tone.Gain(1);
    const ringModOut = new Tone.Gain(1);
    ringModCarrier.connect(ringModVCA.gain);
    ringModVCA.connect(ringModWet);
    ringModWet.connect(ringModOut);
    ringModDry.connect(ringModOut);

    // Stereo Imager / Widener.
    const stereoWidener = new Tone.StereoWidener(0.5);

    // Spatial Audio / 3D positioning: a dry/wet split around a real HRTF
    // PannerNode (Tone.Panner3D). Disabled by default (dry=1, wet=0),
    // matching the bypass-by-neutral-state pattern used throughout this
    // chain — see setSpatial.
    const spatialIn = new Tone.Gain(1);
    const spatialDry = new Tone.Gain(1);
    const spatialPanner = new Tone.Panner3D({
      panningModel: "HRTF",
      distanceModel: "inverse",
      positionX: 0,
      positionY: 0,
      positionZ: -2,
      refDistance: 1,
      maxDistance: 20,
      rolloffFactor: 1,
    });
    const spatialWet = new Tone.Gain(0);
    const spatialOut = new Tone.Gain(1);
    spatialIn.connect(spatialDry);
    spatialDry.connect(spatialOut);
    spatialIn.connect(spatialPanner);
    spatialPanner.connect(spatialWet);
    spatialWet.connect(spatialOut);

    // --- Wire the serial chain ---
    player.connect(polarity);
    polarity.connect(gate);
    gate.connect(envShape);
    envShape.connect(eq);
    gate.connect(autoTuneAnalyser); // passive tap for pitch detection, dry/early in the chain

    eq.connect(dynEqIn);
    dynEqOut.connect(filter);
    filter.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(distortion);
    distortion.connect(saturation);
    saturation.connect(bitcrusher);
    bitcrusher.connect(chorus);

    // flanger tap: feed both dry and modulated-delay paths
    chorus.connect(flangerDryGain);
    chorus.connect(flangerDelay);
    flangerSum.connect(phaser);

    phaser.connect(tremolo);
    tremolo.connect(vibrato);
    vibrato.connect(pitchShift);
    pitchShift.connect(autoTuneShift);

    // de-esser tap
    autoTuneShift.connect(deEsserSplitHigh);
    autoTuneShift.connect(deEsserSplitLow);
    deEsserSum.connect(delay);

    delay.connect(reverb);

    // Harmonizer: dry path plus two pitched voices, summed.
    reverb.connect(harmSum);
    reverb.connect(harmVoice1Shift);
    harmVoice1Shift.connect(harmVoice1Gain);
    harmVoice1Gain.connect(harmSum);
    reverb.connect(harmVoice2Shift);
    harmVoice2Shift.connect(harmVoice2Gain);
    harmVoice2Gain.connect(harmSum);

    // Vocoder: harmonizer output feeds both the dry path and every band's
    // modulator input; the carrier-derived bands sum in parallel.
    harmSum.connect(vocoderDry);
    vocoderBands.forEach((band) => harmSum.connect(band.modFilter));
    vocoderDry.connect(vocoderOut);
    vocoderWetSum.connect(vocoderOut);

    // New inserts: Multiband Compressor -> Transient Shaper -> Exciter ->
    // Formant Shift -> Convolution Reverb -> Ring Modulation -> Stereo
    // Imager, each a transparent passthrough until enabled.
    vocoderOut.connect(mbcIn);
    mbcOut.connect(tsIn);
    tsOut.connect(exciterDry);
    tsOut.connect(exciterHP);
    exciterOut.connect(formantDry);
    exciterOut.connect(formantShiftNode);
    formantOut.connect(convolverDry);
    formantOut.connect(convolver);
    convolverOut.connect(ringModDry);
    convolverOut.connect(ringModVCA);
    ringModOut.connect(stereoWidener);

    // WAM plugin-chain insertion point: a pair of native GainNodes spliced
    // in between the vocoder output and the panner. With no plugins loaded
    // it's a straight passthrough; `rebuildPluginChain` rewires it whenever
    // a plugin is added/removed/bypassed (see loadPlugin below).
    const rawCtx = Tone.getContext().rawContext as unknown as AudioContext;
    const pluginsIn = rawCtx.createGain();
    const pluginsOut = rawCtx.createGain();
    stereoWidener.connect(pluginsIn);
    pluginsIn.connect(pluginsOut);
    pluginsOut.connect(spatialIn.input as unknown as AudioNode);
    spatialOut.connect(panner);
    panner.connect(duckGain);
    duckGain.connect(gain);
    gain.connect(meter);
    gain.connect(this.masterGain);

    this.trackNodes.set(trackId, {
      player, gate, envShape, eq,
      dynEqIn, dynEqDry, dynEqLowFilter, dynEqLowComp, dynEqMidFilterHP, dynEqMidFilterLP,
      dynEqMidComp, dynEqHighFilter, dynEqHighComp, dynEqWetSum, dynEqOut,
      filter, compressor, limiter, distortion, saturation,
      bitcrusher, chorus, flangerDelay, flangerLFO, flangerFeedback,
      flangerWetGain, flangerDryGain, flangerSum, modLfo, phaser, tremolo, vibrato,
      pitchShift, autoTuneAnalyser, autoTuneShift,
      deEsserSplitHigh, deEsserSplitLow, deEsserComp, deEsserSum,
      delay, reverb,
      harmVoice1Shift, harmVoice1Gain, harmVoice2Shift, harmVoice2Gain, harmSum,
      vocoderCarrier, vocoderDry, vocoderWetSum, vocoderOut, vocoderBands,
      mbcIn, mbcDry, mbcLowFilter, mbcLowComp, mbcLowMakeup, mbcMidFilterHP, mbcMidFilterLP,
      mbcMidComp, mbcMidMakeup, mbcHighFilter, mbcHighComp, mbcHighMakeup, mbcWetSum, mbcOut,
      tsIn, tsDry, tsAttackDetector, tsAttackTap, tsSustainDetector, tsSustainTap, tsOut,
      exciterHP, exciterSaturate, exciterWet, exciterDry, exciterOut,
      formantShiftNode, formantFilter, formantWet, formantDry, formantOut,
      convolver, convolverWet, convolverDry, convolverOut,
      ringModCarrier, ringModVCA, ringModWet, ringModDry, ringModOut,
      stereoWidener,
      polarity,
      spatialIn, spatialDry, spatialPanner, spatialWet, spatialOut,
      pluginsIn, pluginsOut,
      panner, duckGain, gain, meter, url: finalUrl,
    });

    // The freshly-built modLfo node starts disconnected regardless of what
    // it was routed to before this rebuild (e.g. Reverse / Time-Stretch),
    // so clear the tracked target — the next setModLfo call will then see
    // a "change" and actually (re)connect it instead of assuming it's
    // already wired.
    this.modLfoTarget.delete(trackId);

    // A track that was already assigned to a bus (e.g. before Reverse or
    // Time-Stretch rebuilt this track's nodes) needs its new `gain` node
    // re-wired into that bus instead of the default straight-to-master path.
    const existingBus = this.trackBusId.get(trackId);
    if (existingBus !== undefined) this.routeTrackToBus(trackId, existingBus);

    // Likewise, any WAM plugins already loaded for this track (persisted in
    // `pluginChains`, keyed off trackId rather than the node bundle) need
    // their connections re-spliced into the freshly-built pluginsIn/Out pair.
    this.rebuildPluginChain(trackId);

    // Sidechain: reapply any persisted config where this track is either the
    // target (its duckGain node was just rebuilt) or the source (other
    // tracks' followers need to re-tap this track's fresh `gain` node).
    this.sidechainSettings.forEach((cfg, id) => {
      if (id === trackId || cfg.sourceTrackId === trackId) {
        this.setSidechain(id, cfg.enabled, cfg.sourceTrackId, cfg.amount);
      }
    });

    // Nudge (Workflow: Nudge) persists across reloads the same way.
    if (Tone.Transport.state === "started") this.startTrackPlayers();

    await Tone.loaded();
    return player.buffer.duration;
  }

  disposeTrack(trackId: string) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    const ramp = this.tapeRampHandles.get(trackId);
    if (ramp != null) {
      cancelAnimationFrame(ramp);
      this.tapeRampHandles.delete(trackId);
    }
    // Any other track sidechained off this one loses its live follower —
    // it's restored automatically if/when this track reloads (see loadTrack).
    this.sidechainNodes.forEach((node, id) => {
      if (node.sourceTrackId === trackId) this.disposeSidechain(id);
    });
    this.disposeSidechain(trackId);
    n.pluginsIn.disconnect();
    n.pluginsOut.disconnect();
    n.vocoderBands.forEach((band) => {
      band.modFilter.dispose();
      band.rectifier.dispose();
      band.envelope.dispose();
      band.carrierFilter.dispose();
      band.vca.dispose();
    });
    Object.values(n).forEach((node) => {
      if (node && typeof (node as any).dispose === "function") {
        try {
          (node as any).dispose();
        } catch {
          /* noop */
        }
      }
    });
    this.trackNodes.delete(trackId);
    this.autoTuneParams.delete(trackId);
    this.autoTuneCurrentSemitones.delete(trackId);
    this.modLfoTarget.delete(trackId);
    this.stopAutoTuneLoopIfIdle();
  }

  // ---- WAM plugin hosting ----
  // Web Audio Modules (https://www.webaudiomodules.org) ship as a plain ES
  // module — no bundler-time dependency needed to host one, just a runtime
  // `import()` of its published bundle URL. This is a generic host: it
  // works with any WAM 2.0-compatible plugin that exposes a static
  // `createInstance(groupId, audioContext)` returning `{ audioNode }`.
  private rebuildPluginChain(trackId: string) {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    const chain = this.pluginChains.get(trackId) ?? [];
    const bypassed = this.pluginBypassed.get(trackId) ?? new Set<string>();
    nodes.pluginsIn.disconnect();
    chain.forEach((p) => {
      try {
        p.node.disconnect();
      } catch {
        /* already disconnected */
      }
    });
    const active = chain.filter((p) => !bypassed.has(p.id));
    if (active.length === 0) {
      nodes.pluginsIn.connect(nodes.pluginsOut);
      return;
    }
    nodes.pluginsIn.connect(active[0].node);
    for (let i = 0; i < active.length - 1; i++) active[i].node.connect(active[i + 1].node);
    active[active.length - 1].node.connect(nodes.pluginsOut);
  }

  async loadPlugin(trackId: string, pluginId: string, url: string) {
    await this.start();
    const rawCtx = Tone.getContext().rawContext as unknown as AudioContext;
    const mod: any = await import(/* webpackIgnore: true */ url);
    const WamClass = mod?.default ?? mod;
    if (!WamClass?.createInstance) {
      throw new Error("URL did not export a WAM-compatible module (missing createInstance)");
    }
    const instance = await WamClass.createInstance(`alone-song-${trackId}`, rawCtx);
    const node: AudioNode | undefined = instance?.audioNode;
    if (!node) throw new Error("Plugin instance has no audioNode to connect");
    const list = this.pluginChains.get(trackId) ?? [];
    list.push({ id: pluginId, node, instance });
    this.pluginChains.set(trackId, list);
    this.rebuildPluginChain(trackId);
  }

  unloadPlugin(trackId: string, pluginId: string) {
    const list = this.pluginChains.get(trackId) ?? [];
    const found = list.find((p) => p.id === pluginId);
    try {
      found?.instance?.destroy?.();
    } catch {
      /* noop */
    }
    this.pluginChains.set(trackId, list.filter((p) => p.id !== pluginId));
    const bypassed = this.pluginBypassed.get(trackId);
    bypassed?.delete(pluginId);
    this.rebuildPluginChain(trackId);
  }

  setPluginBypass(trackId: string, pluginId: string, bypassed: boolean) {
    const set = this.pluginBypassed.get(trackId) ?? new Set<string>();
    if (bypassed) set.add(pluginId);
    else set.delete(pluginId);
    this.pluginBypassed.set(trackId, set);
    this.rebuildPluginChain(trackId);
  }

  // ---- MIDI engine (piano roll playback) ----
  loadMidiTrack(trackId: string, waveform: SynthWaveform, engine: InstrumentEngine = "subtractive") {
    this.disposeMidiTrack(trackId);
    const panner = new Tone.Panner(0);
    const gain = new Tone.Gain(0.85);
    const meter = new Tone.Meter({ normalRange: false, smoothing: 0.8 });
    panner.connect(gain);
    gain.connect(meter);
    gain.connect(this.masterGain);
    const oscillator =
      engine === "wavetable"
        ? ({ type: "custom", partials: buildWavetablePartials(0) } as any)
        : { type: waveform };
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator,
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.3 },
    }).connect(panner);
    this.midiNodes.set(trackId, {
      synth, panner, gain, meter, part: null, engine,
      granularSampleBuffer: null, granularVoices: [],
    });
  }

  disposeMidiTrack(trackId: string) {
    const n = this.midiNodes.get(trackId);
    if (!n) return;
    n.part?.dispose();
    n.synth.dispose();
    n.panner.dispose();
    n.gain.dispose();
    n.meter.dispose();
    n.granularVoices.forEach((v) => {
      if (v.stopHandle) clearTimeout(v.stopHandle);
      v.player.dispose();
      v.gain.dispose();
    });
    this.midiNodes.delete(trackId);
  }

  setMidiInstrument(trackId: string, waveform: SynthWaveform) {
    const n = this.midiNodes.get(trackId);
    if (!n || n.engine !== "subtractive") return;
    n.synth.set({ oscillator: { type: waveform } as any });
  }

  /** Wavetable engine: re-morphs the PolySynth's custom periodic wave to
   *  the frame mix at `position` (0..1). Cheap enough to call live as the
   *  user drags a "wavetable position" slider. */
  setWavetablePosition(trackId: string, position: number) {
    const n = this.midiNodes.get(trackId);
    if (!n || n.engine !== "wavetable") return;
    n.synth.set({ oscillator: { type: "custom", partials: buildWavetablePartials(position) } as any });
  }

  /** Loads (or replaces) the sample buffer the granular engine reads
   *  grains from, and (re)builds a small round-robin voice pool sized for
   *  light polyphony. Each voice is an independent Tone.GrainPlayer so
   *  overlapping notes don't have to share one grain-read position. */
  async loadGranularSample(trackId: string, url: string, poolSize = 6) {
    const n = this.midiNodes.get(trackId);
    if (!n) return;
    const buffer = await urlToAudioBuffer(url);
    n.granularVoices.forEach((v) => {
      if (v.stopHandle) clearTimeout(v.stopHandle);
      v.player.dispose();
      v.gain.dispose();
    });
    n.granularVoices = [];
    for (let i = 0; i < poolSize; i++) {
      const player = new Tone.GrainPlayer({ url: buffer, loop: false });
      const g = new Tone.Gain(0);
      player.connect(g);
      g.connect(n.panner);
      n.granularVoices.push({ player, gain: g, busy: false, stopHandle: null });
    }
    n.granularSampleBuffer = buffer;
  }

  /** Fires one grain-engine note: grabs a free (or the oldest busy) voice,
   *  sets grain size/density/pitch/start-jitter from the track's granular
   *  settings, and starts it for `duration` seconds. */
  triggerGranularNote(
    trackId: string,
    pitch: number,
    velocity: number,
    duration: number,
    startTime: number,
    settings: GranularSettings
  ) {
    const n = this.midiNodes.get(trackId);
    if (!n || !n.granularSampleBuffer || n.granularVoices.length === 0) return;
    const voice = n.granularVoices.find((v) => !v.busy) ?? n.granularVoices[0];
    voice.busy = true;
    if (voice.stopHandle) clearTimeout(voice.stopHandle);

    const rate = Math.pow(2, (pitch - settings.baseNote) / 12);
    voice.player.playbackRate = rate;
    voice.player.grainSize = Math.max(0.01, Math.min(0.5, settings.grainSize));
    voice.player.overlap = Math.max(0.01, Math.min(voice.player.grainSize - 0.005, 0.05));
    // "density" (grains/sec) has no direct Tone.GrainPlayer knob — the
    // closest live analogue is how sparsely we re-seed the loop start
    // point, approximated here via the loopStart/spread jitter below and
    // grainSize itself (denser = smaller grains, more overlap-ready).
    const dur = Math.max(0.05, duration);
    const jitter = settings.spread * n.granularSampleBuffer.duration * Math.random();
    voice.gain.gain.value = velocity;
    try {
      voice.player.start(startTime, jitter, dur);
    } catch {
      /* Tone.Transport may already be past startTime for very short notes */
    }
    voice.stopHandle = setTimeout(() => {
      voice.busy = false;
    }, dur * 1000 + 20);
  }

  /** Rebuilds the Tone.Part driving this MIDI track's synth from the store's
   *  current note array. Notes are absolute seconds from song start, and
   *  the part is started at transport position 0, so it plays correctly
   *  whether playback begins at the top of the song or mid-way through.
   *  For the granular engine, each note fires triggerGranularNote instead
   *  of the PolySynth. */
  scheduleMidiTrack(trackId: string, notes: MidiNote[], granularSettings?: GranularSettings) {
    const n = this.midiNodes.get(trackId);
    if (!n) return;
    n.part?.dispose();
    const part = new Tone.Part((time: any, ev: MidiNote) => {
      if (n.engine === "granular" && granularSettings) {
        this.triggerGranularNote(trackId, ev.pitch, ev.velocity, ev.duration, time, granularSettings);
        return;
      }
      n.synth.triggerAttackRelease(
        Tone.Frequency(ev.pitch, "midi").toFrequency(),
        ev.duration,
        time,
        ev.velocity
      );
    }, notes.map((ev) => ({ time: ev.start, ...ev })));
    part.start(0);
    n.part = part;
  }

  getMidiLevelDb(trackId: string) {
    const v = this.midiNodes.get(trackId)?.meter.getValue();
    if (v == null) return -Infinity;
    return typeof v === "number" ? v : v[0];
  }

  // ---- Mix basics ----
  setVolume(trackId: string, volume: number) {
    this.trackLastVolume.set(trackId, volume);
    this.trackNodes.get(trackId)?.gain.gain.rampTo(volume, 0.05);
    this.midiNodes.get(trackId)?.gain.gain.rampTo(volume, 0.05);
  }

  setPan(trackId: string, pan: number) {
    this.trackLastPan.set(trackId, pan);
    this.trackNodes.get(trackId)?.panner.pan.rampTo(pan, 0.05);
    this.midiNodes.get(trackId)?.panner.pan.rampTo(pan, 0.05);
  }

  setMute(trackId: string, muted: boolean, storeVolume: number) {
    const n = this.trackNodes.get(trackId);
    if (n) n.gain.gain.rampTo(muted ? 0 : storeVolume, 0.02);
  }

  /** Recomputes audible tracks: if any track is soloed, only soloed tracks play. */
  applySoloState(allTrackIds: string[], soloedIds: string[], muted: Record<string, boolean>, volumes: Record<string, number>) {
    this.soloedTrackIds = new Set(soloedIds);
    const anySolo = this.soloedTrackIds.size > 0;
    allTrackIds.forEach((id) => {
      const audible = !muted[id] && (!anySolo || this.soloedTrackIds.has(id));
      const targetVolume = audible ? volumes[id] ?? 0.85 : 0;
      this.trackNodes.get(id)?.gain.gain.rampTo(targetVolume, 0.02);
      this.midiNodes.get(id)?.gain.gain.rampTo(targetVolume, 0.02);
    });
  }

  // ---- Buses (submix groups: several tracks -> shared volume/pan/mute -> master) ----
  createBus(busId: string) {
    if (this.busNodes.has(busId)) return;
    const gain = new Tone.Gain(0.85);
    const panner = new Tone.Panner(0);
    const meter = new Tone.Meter({ normalRange: false, smoothing: 0.8 });
    gain.connect(panner);
    panner.connect(meter);
    panner.connect(this.masterGain);
    this.busNodes.set(busId, { gain, panner, meter });
    // Re-route any tracks that were already flagged for this bus id.
    this.trackBusId.forEach((assignedBus, trackId) => {
      if (assignedBus === busId) this.routeTrackToBus(trackId, busId);
    });
  }

  disposeBus(busId: string) {
    const b = this.busNodes.get(busId);
    if (!b) return;
    // Any track still routed here falls back to straight-to-master.
    this.trackBusId.forEach((assignedBus, trackId) => {
      if (assignedBus === busId) this.routeTrackToBus(trackId, null);
    });
    b.gain.dispose();
    b.panner.dispose();
    b.meter.dispose();
    this.busNodes.delete(busId);
  }

  getBusIds(): string[] {
    return Array.from(this.busNodes.keys());
  }

  setBusVolume(busId: string, volume: number) {
    this.busNodes.get(busId)?.gain.gain.rampTo(volume, 0.05);
  }

  setBusPan(busId: string, pan: number) {
    this.busNodes.get(busId)?.panner.pan.rampTo(pan, 0.05);
  }

  getBusLevelDb(busId: string) {
    const b = this.busNodes.get(busId);
    if (!b) return -Infinity;
    const v = b.meter.getValue();
    return typeof v === "number" ? v : v[0];
  }

  /** Recomputes audible buses: if any bus is soloed, only soloed buses play
   *  (mirrors applySoloState, one level up in the routing graph). */
  applyBusSoloState(allBusIds: string[], soloedIds: string[], muted: Record<string, boolean>, volumes: Record<string, number>) {
    const anySolo = soloedIds.length > 0;
    allBusIds.forEach((id) => {
      const b = this.busNodes.get(id);
      if (!b) return;
      const audible = !muted[id] && (!anySolo || soloedIds.includes(id));
      b.gain.gain.rampTo(audible ? volumes[id] ?? 0.85 : 0, 0.02);
    });
  }

  /** Routes a track's post-fader signal into a bus's input instead of
   *  straight to the master bus (or back to master when `busId` is null /
   *  not a currently-loaded bus). Safe to call before the track or bus
   *  nodes exist — the assignment is remembered and applied once they are. */
  routeTrackToBus(trackId: string, busId: string | null) {
    this.trackBusId.set(trackId, busId);
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    try {
      n.gain.disconnect(this.masterGain);
    } catch {
      /* wasn't connected there */
    }
    this.busNodes.forEach((b) => {
      try {
        n.gain.disconnect(b.gain);
      } catch {
        /* wasn't connected there */
      }
    });
    const target = busId ? this.busNodes.get(busId) : null;
    if (target) {
      n.gain.connect(target.gain);
    } else {
      n.gain.connect(this.masterGain);
    }
  }

  // ---- Automation (per-track volume/pan envelopes) ----
  /** Stores/refreshes a track's automation lanes. Cheap — actual scheduling
   *  against Tone.Transport only happens in scheduleAllAutomation() on play. */
  setTrackAutomation(trackId: string, automation: TrackAutomation) {
    this.trackAutomation.set(trackId, automation);
  }

  private clearTrackAutomationEvents(trackId: string) {
    const ids = this.automationEventIds.get(trackId);
    if (ids) ids.forEach((id) => Tone.Transport.clear(id));
    this.automationEventIds.delete(trackId);
  }

  /** Schedules every enabled automation lane from the current Transport
   *  position forward, so playback (even starting mid-song) snaps straight
   *  to the interpolated curve value and then rides the curve from there.
   *
   *  Known limitation: each ramp is scheduled as a native AudioParam
   *  automation event anchored to real AudioContext time, so it keeps
   *  running on its own clock once scheduled — pausing Tone.Transport
   *  mid-ramp doesn't freeze it. pauseAll()/stopAll() explicitly cancel and
   *  snap params back to compensate (same "documented approximation"
   *  approach the rest of this engine already uses for the de-esser /
   *  expander / auto-tune). */
  private scheduleAllAutomation() {
    const startPos = Tone.Transport.seconds;
    this.trackAutomation.forEach((automation, trackId) => {
      const n = this.trackNodes.get(trackId);
      if (!n) return;
      this.clearTrackAutomationEvents(trackId);
      const ids: number[] = [];
      (["volume", "pan"] as AutomationParam[]).forEach((paramKey) => {
        const lane = automation[paramKey];
        if (!lane.enabled || lane.points.length === 0) return;
        const param = paramKey === "volume" ? n.gain.gain : n.panner.pan;
        const sorted = [...lane.points].sort((a, b) => a.time - b.time);
        const fallback =
          paramKey === "volume"
            ? this.trackLastVolume.get(trackId) ?? 0.85
            : this.trackLastPan.get(trackId) ?? 0;
        const initial = automationValueAt(lane, startPos, fallback);
        param.cancelScheduledValues(Tone.now());
        param.setValueAtTime(initial, Tone.now());
        sorted
          .filter((p) => p.time > startPos)
          .forEach((p) => {
            const id = Tone.Transport.schedule((time: any) => {
              param.linearRampToValueAtTime(p.value, time);
            }, p.time);
            ids.push(id);
          });
      });
      this.automationEventIds.set(trackId, ids);
    });
  }

  /** Cancels any in-flight automation ramps and snaps params back to their
   *  plain (non-automated) fader/pan value — called on pause/stop. */
  private resetAllAutomation() {
    this.trackAutomation.forEach((_automation, trackId) => {
      this.clearTrackAutomationEvents(trackId);
      const n = this.trackNodes.get(trackId);
      if (!n) return;
      const now = Tone.now();
      n.gain.gain.cancelScheduledValues(now);
      n.panner.pan.cancelScheduledValues(now);
      n.gain.gain.setValueAtTime(this.trackLastVolume.get(trackId) ?? n.gain.gain.value, now);
      n.panner.pan.setValueAtTime(this.trackLastPan.get(trackId) ?? n.panner.pan.value, now);
    });
  }

  // ---- Dynamics ----
  setGate(trackId: string, enabled: boolean, threshold: number) {
    const n = this.trackNodes.get(trackId);
    if (n) n.gate.threshold = enabled ? threshold : -100;
  }

  setEQ(trackId: string, low: number, mid: number, high: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.eq.low.value = low;
    n.eq.mid.value = mid;
    n.eq.high.value = high;
  }

  /** Dynamic EQ: pushes band frequencies/thresholds/ratios to the three
   *  parallel Compressor+Filter branches built in loadTrack, and crossfades
   *  the wet (band-processed) sum against the dry tap by `wet`. Disabled ->
   *  wet fully closed, dry fully open, so bypass is phase/response-clean. */
  setDynamicEq(
    trackId: string,
    enabled: boolean,
    low: { freq: number; threshold: number; ratio: number },
    mid: { freqLow: number; freqHigh: number; threshold: number; ratio: number },
    high: { freq: number; threshold: number; ratio: number },
    wet: number
  ) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.dynEqLowFilter.frequency.value = low.freq;
    n.dynEqLowComp.threshold.value = low.threshold;
    n.dynEqLowComp.ratio.value = low.ratio;
    n.dynEqMidFilterHP.frequency.value = mid.freqLow;
    n.dynEqMidFilterLP.frequency.value = mid.freqHigh;
    n.dynEqMidComp.threshold.value = mid.threshold;
    n.dynEqMidComp.ratio.value = mid.ratio;
    n.dynEqHighFilter.frequency.value = high.freq;
    n.dynEqHighComp.threshold.value = high.threshold;
    n.dynEqHighComp.ratio.value = high.ratio;
    const w = enabled ? Math.max(0, Math.min(1, wet)) : 0;
    n.dynEqWetSum.gain.rampTo(w, 0.05);
    n.dynEqDry.gain.rampTo(1 - w, 0.05);
  }

  /** Tape Stop: ramps this track's Player.playbackRate down toward
   *  (near-)zero over `durationSec`, using rAF steps rather than a Tone
   *  signal ramp since Tone.Player's playbackRate is a plain number
   *  property (not an automatable Param on this Tone.js version) —
   *  documented the same way as the rest of this file's honest-limitation
   *  notes. `curve` "exponential" mimics a real tape motor's deceleration
   *  (fast at first, crawling near the end); "linear" is a steady ramp. */
  triggerTapeStop(trackId: string, durationSec: number, curve: "exponential" | "linear" = "exponential") {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    this.runPlaybackRateRamp(trackId, n.player.playbackRate as number, 0.02, durationSec, curve, () => {
      try {
        n.player.stop();
      } catch {
        /* already stopped */
      }
      n.player.playbackRate = 1;
    });
  }

  /** Tape Start: the inverse — ramps playbackRate up from (near-)zero to 1
   *  over `durationSec`. Expects the player to already be playing (e.g.
   *  triggered right as the track/transport starts) at a near-zero rate. */
  triggerTapeStart(trackId: string, durationSec: number, curve: "exponential" | "linear" = "exponential") {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.player.playbackRate = 0.02;
    this.runPlaybackRateRamp(trackId, 0.02, 1, durationSec, curve);
  }

  /** Shared rAF-driven playbackRate ramp used by triggerTapeStop/Start.
   *  Cancels any ramp already running for this track before starting a new
   *  one, so rapid re-triggers don't fight each other. */
  private tapeRampHandles = new Map<string, number>();
  private runPlaybackRateRamp(
    trackId: string,
    from: number,
    to: number,
    durationSec: number,
    curve: "exponential" | "linear",
    onDone?: () => void
  ) {
    const existing = this.tapeRampHandles.get(trackId);
    if (existing != null) cancelAnimationFrame(existing);
    const start = performance.now();
    const dur = Math.max(0.05, durationSec) * 1000;
    const step = () => {
      const n = this.trackNodes.get(trackId);
      if (!n) return;
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / dur);
      const eased = curve === "exponential" ? 1 - Math.pow(1 - t, 3) : t;
      const rate = from + (to - from) * eased;
      n.player.playbackRate = Math.max(0.01, rate);
      if (t < 1) {
        this.tapeRampHandles.set(trackId, requestAnimationFrame(step));
      } else {
        this.tapeRampHandles.delete(trackId);
        onDone?.();
      }
    };
    this.tapeRampHandles.set(trackId, requestAnimationFrame(step));
  }

  setFilter(trackId: string, enabled: boolean, type: FilterType, frequency: number, q: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    if (!enabled) {
      n.filter.type = "allpass";
      return;
    }
    n.filter.type = type === "notch" ? "notch" : type;
    n.filter.frequency.value = frequency;
    n.filter.Q.value = q;
  }

  setCompressor(trackId: string, enabled: boolean, threshold: number, ratio: number, attack: number, release: number, knee = 6) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.compressor.threshold.value = enabled ? threshold : 0;
    n.compressor.ratio.value = enabled ? ratio : 1;
    n.compressor.attack.value = attack;
    n.compressor.release.value = release;
    n.compressor.knee.value = knee;
  }

  setLimiter(trackId: string, enabled: boolean, threshold: number) {
    const n = this.trackNodes.get(trackId);
    if (n) n.limiter.threshold.value = enabled ? threshold : 0;
  }

  /**
   * Expander approximation: Tone.js has no native expander node, so this
   * uses the same Gate node with a soft threshold to reduce low-level
   * signal rather than hard-muting it. It approximates, not replicates,
   * true multi-ratio expansion.
   */
  setExpander(trackId: string, enabled: boolean, threshold: number) {
    const n = this.trackNodes.get(trackId);
    if (n) n.gate.threshold = enabled ? threshold : -100;
  }

  setDeEsser(trackId: string, enabled: boolean, frequency: number, reductionDb: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.deEsserSplitHigh.frequency.value = frequency;
    n.deEsserSplitLow.frequency.value = frequency;
    n.deEsserComp.threshold.value = enabled ? -Math.abs(reductionDb) - 10 : 0;
    n.deEsserComp.ratio.value = enabled ? 8 : 1;
  }

  /** Normalize: analyzes the loaded buffer's peak and applies a trim gain via player.volume (dB). */
  normalize(trackId: string, targetPeakDb = -1) {
    const n = this.trackNodes.get(trackId);
    if (!n || !n.player.buffer.loaded) return;
    const data = n.player.buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    if (peak === 0) return;
    const currentPeakDb = 20 * Math.log10(peak);
    const gainDb = targetPeakDb - currentPeakDb;
    n.player.volume.value = gainDb;
  }

  // ---- Distortion / Bitcrush ----
  setDistortion(trackId: string, enabled: boolean, amount: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.distortion.distortion = amount;
    n.distortion.wet.value = enabled ? 1 : 0;
  }

  setSaturation(trackId: string, enabled: boolean, amount: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.saturation.order = Math.max(1, Math.round(1 + amount * 49));
    n.saturation.wet.value = enabled ? 1 : 0;
  }

  setBitcrusher(trackId: string, enabled: boolean, bits: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.bitcrusher.bits.value = bits as any;
    n.bitcrusher.wet.value = enabled ? 1 : 0;
  }

  // ---- Modulation FX ----
  setChorus(trackId: string, enabled: boolean, frequency: number, depth: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.chorus.frequency.value = frequency;
    n.chorus.depth = depth;
    n.chorus.wet.value = enabled ? wet : 0;
  }

  setFlanger(trackId: string, enabled: boolean, rate: number, depth: number, feedback: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.flangerLFO.frequency.value = rate;
    n.flangerLFO.min = 0.001;
    n.flangerLFO.max = 0.001 + depth * 0.009;
    n.flangerFeedback.gain.value = feedback;
    n.flangerWetGain.gain.rampTo(enabled ? wet : 0, 0.05);
    n.flangerDryGain.gain.rampTo(enabled ? 1 - wet : 1, 0.05);
  }

  /** Free-assignable modulation LFO: routes an independent Tone.LFO to one
   *  of a few chain params. Since a Web Audio param connection is additive
   *  (the connected signal's output sums on top of whatever the param's
   *  own `.value` already holds), `min`/`max` here are a signed excursion
   *  around zero rather than the target's absolute range — same trick the
   *  internal flangerLFO above uses on `flangerDelay.delayTime`. That keeps
   *  this LFO from fighting whatever the target's own knob (Filter cutoff,
   *  the track's Pan/Volume, Delay time) is already set to.
   */
  setModLfo(trackId: string, enabled: boolean, target: ModLfoTarget, shape: ModLfoShape, rate: number, depth: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;

    n.modLfo.type = shape;
    n.modLfo.frequency.value = rate;

    const desired: ModLfoTarget = enabled ? target : "off";
    const previous = this.modLfoTarget.get(trackId) ?? "off";
    if (previous !== desired) {
      n.modLfo.disconnect();
      this.modLfoTarget.set(trackId, desired);
      const param = this.modLfoParam(n, desired);
      if (param) n.modLfo.connect(param);
    }

    if (desired === "off") return;
    const [deltaMin, deltaMax] = this.modLfoRange(n, desired, depth);
    n.modLfo.min = deltaMin;
    n.modLfo.max = deltaMax;
  }

  private modLfoParam(n: TrackNodes, target: ModLfoTarget): any {
    switch (target) {
      case "filterCutoff":
        return n.filter.frequency;
      case "pan":
        return n.panner.pan;
      case "volume":
        return n.gain.gain;
      case "delayTime":
        return n.delay.delayTime;
      default:
        return null;
    }
  }

  /** Signed [min, max] excursion (delta, not absolute) for a given target
   *  and depth (0..1), sized to something musically useful for that
   *  param's typical range. */
  private modLfoRange(n: TrackNodes, target: ModLfoTarget, depth: number): [number, number] {
    const d = Math.max(0, Math.min(1, depth));
    switch (target) {
      case "filterCutoff": {
        // Proportional to the filter's own current cutoff so the wobble
        // feels similar whether the base cutoff is low or high.
        const base = Math.max(40, n.filter.frequency.value as number);
        const swing = d * base * 2.5;
        return [-swing, swing];
      }
      case "pan":
        return [-d, d];
      case "volume":
        return [-d * 0.5, d * 0.5];
      case "delayTime":
        return [-d * 0.05, d * 0.05];
      default:
        return [0, 0];
    }
  }

  setPhaser(trackId: string, enabled: boolean, frequency: number, octaves: number, baseFrequency: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.phaser.frequency.value = frequency;
    n.phaser.octaves = octaves;
    n.phaser.baseFrequency = baseFrequency;
    n.phaser.wet.value = enabled ? wet : 0;
  }

  setTremolo(trackId: string, enabled: boolean, frequency: number, depth: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.tremolo.frequency.value = frequency;
    n.tremolo.depth.value = depth;
    n.tremolo.wet.value = enabled ? wet : 0;
  }

  setVibrato(trackId: string, enabled: boolean, frequency: number, depth: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.vibrato.frequency.value = frequency;
    n.vibrato.depth.value = depth;
    n.vibrato.wet.value = enabled ? wet : 0;
  }

  setPitchShift(trackId: string, enabled: boolean, semitones: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.pitchShift.pitch = semitones;
    n.pitchShift.wet.value = enabled ? wet : 0;
  }

  // ---- Auto-Tune (pitch detection + correction) ----
  setAutoTune(
    trackId: string,
    enabled: boolean,
    key: number,
    scale: "chromatic" | "major" | "minor",
    retune: number,
    wet: number
  ) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.autoTuneShift.wet.value = enabled ? wet : 0;
    if (enabled) {
      this.autoTuneParams.set(trackId, { key, scale, retune });
      this.startAutoTuneLoopIfNeeded();
    } else {
      this.autoTuneParams.delete(trackId);
      n.autoTuneShift.pitch = 0;
      this.autoTuneCurrentSemitones.delete(trackId);
      this.stopAutoTuneLoopIfIdle();
    }
  }

  private startAutoTuneLoopIfNeeded() {
    if (this.autoTuneLoopId) return;
    // Throttled to ~20Hz: autocorrelation pitch detection is too costly to
    // run every animation frame across multiple tracks.
    this.autoTuneLoopId = setInterval(() => this.runAutoTuneDetection(), 50);
  }

  private stopAutoTuneLoopIfIdle() {
    if (this.autoTuneParams.size === 0 && this.autoTuneLoopId) {
      clearInterval(this.autoTuneLoopId);
      this.autoTuneLoopId = null;
    }
  }

  private runAutoTuneDetection() {
    const sampleRate = Tone.getContext().sampleRate;
    this.autoTuneParams.forEach((params, trackId) => {
      const n = this.trackNodes.get(trackId);
      if (!n) return;
      const waveform = n.autoTuneAnalyser.getValue();
      if (typeof waveform === "number") return;
      const freq = detectPitch(waveform as Float32Array, sampleRate);
      const prev = this.autoTuneCurrentSemitones.get(trackId) ?? 0;
      let target = 0;
      if (freq > 0) {
        target = nearestScaleCorrection(freq, params.key, params.scale);
      } else {
        target = prev; // no confident pitch this frame (silence/noise) — hold
      }
      // Exponential smoothing toward the target correction; `retune` sets
      // how much of the gap closes per detection tick (snappy vs. gentle).
      const next = prev + (target - prev) * Math.max(0.02, Math.min(1, params.retune));
      this.autoTuneCurrentSemitones.set(trackId, next);
      n.autoTuneShift.pitch = next;
    });
  }

  // ---- Harmonizer ----
  setHarmonizer(trackId: string, enabled: boolean, voice1: number, voice1Wet: number, voice2: number, voice2Wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.harmVoice1Shift.pitch = voice1;
    n.harmVoice2Shift.pitch = voice2;
    n.harmVoice1Gain.gain.rampTo(enabled ? voice1Wet : 0, 0.05);
    n.harmVoice2Gain.gain.rampTo(enabled ? voice2Wet : 0, 0.05);
  }

  // ---- Vocoder ----
  setVocoder(trackId: string, enabled: boolean, carrier: "sawtooth" | "square" | "pulse", carrierNote: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.vocoderCarrier.type = carrier;
    n.vocoderCarrier.frequency.value = carrierNote;
    n.vocoderWetSum.gain.rampTo(enabled ? wet : 0, 0.05);
    n.vocoderDry.gain.rampTo(enabled ? 1 - wet : 1, 0.05);
  }

  setDelay(trackId: string, enabled: boolean, time: number, feedback: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.delay.delayTime.value = time;
    n.delay.feedback.value = feedback;
    n.delay.wet.value = enabled ? wet : 0;
  }

  setReverb(trackId: string, enabled: boolean, decay: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    if (n.reverb.decay !== decay) {
      n.reverb.decay = decay;
      n.reverb.generate();
    }
    n.reverb.wet.value = enabled ? wet : 0;
  }

  // ---- Fades / reverse (via reload since chain uses a static Player buffer) ----
  setFades(trackId: string, fadeIn: number, fadeOut: number, fadeInCurve: FadeCurve = "linear", fadeOutCurve: FadeCurve = "linear") {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.player.fadeIn = fadeIn;
    n.player.fadeOut = fadeOut;
    // Tone.Player does not expose a fade-curve control (its internal
    // ToneBufferSource always applies a linear fade and Player never
    // forwards a curve option to it), so fadeInCurve/fadeOutCurve can't
    // currently be honored at the engine level. Accepted here so the UI/
    // caller contract stays stable if a manual gain-envelope implementation
    // is added later.
    void fadeInCurve;
    void fadeOutCurve;
  }

  /** Multiband Compressor (see TrackEffectsSettings.multibandCompressor). */
  setMultibandCompressor(
    trackId: string,
    enabled: boolean,
    lowFreq: number,
    highFreq: number,
    low: { threshold: number; ratio: number; makeup: number },
    mid: { threshold: number; ratio: number; makeup: number },
    high: { threshold: number; ratio: number; makeup: number }
  ) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.mbcLowFilter.frequency.value = lowFreq;
    n.mbcMidFilterHP.frequency.value = lowFreq;
    n.mbcMidFilterLP.frequency.value = highFreq;
    n.mbcHighFilter.frequency.value = highFreq;
    n.mbcLowComp.threshold.value = low.threshold;
    n.mbcLowComp.ratio.value = low.ratio;
    n.mbcLowMakeup.gain.value = low.makeup;
    n.mbcMidComp.threshold.value = mid.threshold;
    n.mbcMidComp.ratio.value = mid.ratio;
    n.mbcMidMakeup.gain.value = mid.makeup;
    n.mbcHighComp.threshold.value = high.threshold;
    n.mbcHighComp.ratio.value = high.ratio;
    n.mbcHighMakeup.gain.value = high.makeup;
    n.mbcDry.gain.value = enabled ? 0 : 1;
    n.mbcWetSum.gain.value = enabled ? 1 : 0;
  }

  /** Transient Shaper (see TrackEffectsSettings.transientShaper). */
  setTransientShaper(trackId: string, enabled: boolean, attack: number, sustain: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.tsAttackTap.gain.value = enabled ? attack : 0;
    n.tsSustainTap.gain.value = enabled ? sustain : 0;
  }

  /** Stereo Imager / Widener (see TrackEffectsSettings.stereoImager). */
  setStereoImager(trackId: string, enabled: boolean, width: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.stereoWidener.width.value = enabled ? width : 0.5; // 0.5 = neutral/unprocessed
  }

  /** Phase Inversion / Polarity Flip (see TrackEffectsSettings.polarityInverted). */
  setPolarity(trackId: string, inverted: boolean) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.polarity.gain.value = inverted ? -1 : 1;
  }

  /** Spatial Audio / 3D positioning (see TrackEffectsSettings.spatial). Moves
   *  the real HRTF PannerNode to (x, y, z) and crossfades the signal into
   *  it when enabled; crossfades back to the plain stereo pan path when
   *  disabled so turning it off is a true bypass, not just "centered". */
  setSpatial(trackId: string, spatial: { enabled: boolean; x: number; y: number; z: number }) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    const p = n.spatialPanner;
    // positionX/Y/Z are AudioParams on the underlying native PannerNode in
    // browsers that support it; fall back to setPosition() (deprecated but
    // still broadly supported) if the param-based API isn't there.
    if (p.positionX) {
      p.positionX.value = spatial.x;
      p.positionY.value = spatial.y;
      p.positionZ.value = spatial.z;
    } else if (typeof (p as unknown as { setPosition?: (x: number, y: number, z: number) => void }).setPosition === "function") {
      (p as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(spatial.x, spatial.y, spatial.z);
    }
    n.spatialDry.gain.value = spatial.enabled ? 0 : 1;
    n.spatialWet.gain.value = spatial.enabled ? 1 : 0;
  }

  /** Exciter / Enhancer (see TrackEffectsSettings.exciter). */
  setExciter(trackId: string, enabled: boolean, frequency: number, amount: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.exciterHP.frequency.value = frequency;
    n.exciterSaturate.order = Math.max(1, Math.round(1 + amount * 4));
    n.exciterWet.gain.value = enabled ? wet : 0;
    n.exciterDry.gain.value = 1;
  }

  /** Formant Shifting (see TrackEffectsSettings.formantShift). */
  setFormantShift(trackId: string, enabled: boolean, shift: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.formantShiftNode.pitch = shift;
    n.formantWet.gain.value = enabled ? wet : 0;
    n.formantDry.gain.value = 1;
  }

  /** Convolution Reverb (see TrackEffectsSettings.convolutionReverb). */
  setConvolutionReverb(
    trackId: string,
    enabled: boolean,
    irType: "room" | "hall" | "plate" | "cathedral",
    wet: number
  ) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    if (this.convolutionIrType.get(trackId) !== irType) {
      this.convolutionIrType.set(trackId, irType);
      generateImpulseResponse(irType).then((buf) => {
        if (buf && this.trackNodes.get(trackId) === n) n.convolver.buffer = new Tone.ToneAudioBuffer(buf);
      });
    }
    n.convolverWet.gain.value = enabled ? wet : 0;
    n.convolverDry.gain.value = 1;
  }

  /** Ring Modulation (see TrackEffectsSettings.ringMod). */
  setRingMod(trackId: string, enabled: boolean, frequency: number, wet: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.ringModCarrier.frequency.value = frequency;
    n.ringModWet.gain.value = enabled ? wet : 0;
    n.ringModDry.gain.value = enabled ? 1 - wet : 1;
  }

  /** Envelope Shaping — internal only, no UI control (see
   *  EnvelopeShapeSettings). Not wired to the store; callable directly
   *  (e.g. from a future preset system) without exposing FX-rack sliders. */
  setEnvelopeShape(trackId: string, attack: number, release: number, ratio: number) {
    const n = this.trackNodes.get(trackId);
    if (!n) return;
    n.envShape.attack.value = attack;
    n.envShape.release.value = release;
    n.envShape.ratio.value = ratio;
  }

  /** Track Freeze / Bounce to Audio: records this track's fully-processed
   *  output (post-FX, pre-master — i.e. exactly what the listener hears
   *  from this track) in real time for `durationSec`, and resolves to an
   *  object URL for the rendered take. The caller (store) is responsible
   *  for swapping the track over to the frozen audio and resetting its
   *  live effects so the render isn't double-processed. */
  async freezeTrack(trackId: string, durationSec: number): Promise<string | null> {
    const n = this.trackNodes.get(trackId);
    if (!n || durationSec <= 0) return null;
    const rec = new Tone.Recorder();
    n.gain.connect(rec);
    rec.start();
    const wasStarted = Tone.Transport.state === "started";
    const prevPos = Tone.Transport.seconds;
    Tone.Transport.seconds = 0;
    this.startTrackPlayers();
    if (!wasStarted) Tone.Transport.start();
    await new Promise((resolve) => setTimeout(resolve, (durationSec + 0.25) * 1000));
    const recording = await rec.stop();
    n.gain.disconnect(rec);
    rec.dispose();
    if (!wasStarted) Tone.Transport.stop();
    Tone.Transport.seconds = prevPos;
    this.startTrackPlayers();
    return URL.createObjectURL(recording);
  }

  /** Bounce a MIDI track's synth/sampler output to audio the same way
   *  (see freezeTrack) — used by the store to convert a MIDI track into a
   *  frozen audio track. */
  async bounceMidiTrack(trackId: string, durationSec: number): Promise<string | null> {
    const n = this.midiNodes.get(trackId);
    if (!n || durationSec <= 0) return null;
    const rec = new Tone.Recorder();
    n.gain.connect(rec);
    rec.start();
    const wasStarted = Tone.Transport.state === "started";
    const prevPos = Tone.Transport.seconds;
    Tone.Transport.seconds = 0;
    if (!wasStarted) Tone.Transport.start();
    await new Promise((resolve) => setTimeout(resolve, (durationSec + 0.25) * 1000));
    const recording = await rec.stop();
    n.gain.disconnect(rec);
    rec.dispose();
    if (!wasStarted) Tone.Transport.stop();
    Tone.Transport.seconds = prevPos;
    return URL.createObjectURL(recording);
  }

  /** Pre-roll: counts in `bars` bars of metronome clicks before playback
   *  actually starts, giving a performer time to get ready — reuses the
   *  existing metronome infra (see setMetronomeEnabled/metronomeLoop). */
  async playWithPreRoll(bars: number, startPlayback: () => void) {
    if (bars <= 0) {
      startPlayback();
      return;
    }
    const beatSec = 60 / Math.max(1, Tone.Transport.bpm.value);
    const beats = bars * 4;
    const synth = new Tone.Synth({ oscillator: { type: "square" }, volume: -6 }).toDestination();
    const now = Tone.now();
    for (let i = 0; i < beats; i++) {
      synth.triggerAttackRelease(i % 4 === 0 ? "C6" : "C5", 0.05, now + i * beatSec);
    }
    await new Promise((resolve) => setTimeout(resolve, beats * beatSec * 1000));
    synth.dispose();
    startPlayback();
  }

  private async buildReversedUrl(url: string): Promise<string> {
    const ctx = Tone.getContext().rawContext as AudioContext;
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channels = audioBuffer.numberOfChannels;
    const reversed = ctx.createBuffer(channels, audioBuffer.length, audioBuffer.sampleRate);
    for (let c = 0; c < channels; c++) {
      const src = audioBuffer.getChannelData(c);
      const dst = reversed.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    }
    const wavBlob = audioBufferToWav(reversed);
    return URL.createObjectURL(wavBlob);
  }

  // ---- Transport ----
  /** (Re)starts every loaded track's Player at the transport's current
   *  position, honoring each track's nudge offset (Workflow: Nudge). Shared
   *  by playAll(), the loop-wrap listener (Workflow: Loop), and seekTo(). */
  private startTrackPlayers() {
    const base = Tone.Transport.seconds;
    this.trackNodes.forEach((nodes, id) => {
      if (!nodes.player.loaded) return;
      try {
        nodes.player.stop();
      } catch {
        /* wasn't started */
      }
      const nudge = this.trackNudge.get(id) ?? 0;
      const virtual = base - nudge;
      try {
        if (virtual >= 0) {
          nodes.player.start(undefined, virtual);
        } else {
          // Nudged later than the current position — schedule its start a
          // little in the future instead of jumping into the buffer.
          nodes.player.start(`+${(-virtual).toFixed(3)}`, 0);
        }
      } catch {
        /* scheduling conflict, safe to ignore */
      }
    });
  }

  playAll() {
    Tone.Transport.start();
    this.scheduleAllAutomation();
    this.startTrackPlayers();
  }

  pauseAll() {
    this.resetAllAutomation();
    Tone.Transport.pause();
    this.trackNodes.forEach((nodes) => {
      try {
        nodes.player.stop();
      } catch {
        /* wasn't started */
      }
    });
    this.midiNodes.forEach((nodes) => nodes.synth.releaseAll());
  }

  stopAll() {
    this.resetAllAutomation();
    Tone.Transport.stop();
    this.trackNodes.forEach((nodes) => {
      try {
        nodes.player.stop();
      } catch {
        /* wasn't started */
      }
    });
    this.midiNodes.forEach((nodes) => nodes.synth.releaseAll());
  }

  /** Workflow: Snapping / Markers — moves the playhead without going through
   *  play/pause, re-triggering players at the new spot if already playing. */
  seekTo(seconds: number, isPlaying: boolean) {
    const target = Math.max(0, seconds);
    this.trackNodes.forEach((nodes) => {
      try {
        nodes.player.stop();
      } catch {
        /* wasn't started */
      }
    });
    Tone.Transport.seconds = target;
    if (isPlaying) this.startTrackPlayers();
  }

  /** Workflow: Nudge — shift a track's playback earlier/later without
   *  touching its buffer. Re-triggers immediately if transport is running. */
  setTrackNudge(trackId: string, nudgeSeconds: number) {
    this.trackNudge.set(trackId, nudgeSeconds);
    if (Tone.Transport.state === "started") this.startTrackPlayers();
  }

  /** Workflow: Loop Comping — toggles native Transport looping over a region. */
  setTransportLoop(enabled: boolean, startSec: number, endSec: number) {
    const start = Math.max(0, startSec);
    Tone.Transport.loop = enabled;
    Tone.Transport.loopStart = start;
    Tone.Transport.loopEnd = Math.max(start + 0.05, endSec);
  }

  /** Workflow: Punch-in/out — fire a one-off callback at an absolute
   *  transport time (seconds), returning an id for clearTransportEvent(). */
  onTransportTime(seconds: number, cb: () => void): number {
    return Tone.Transport.scheduleOnce(() => cb(), Math.max(0, seconds));
  }

  clearTransportEvent(id: number) {
    Tone.Transport.clear(id);
  }

  // ---- Sidechaining (Workflow: Sidechaining) ----
  // Web Audio's DynamicsCompressorNode has no external key/sidechain input,
  // so this fakes the classic "ducking" effect: an envelope follower reads
  // the source track's post-fader signal, and its (inverted, scaled) output
  // drives the target track's duckGain — a plain VCA spliced between its
  // panner and fader (see loadTrack). Persisted per-track like bus routing,
  // so it survives node rebuilds from Reverse / Time-Stretch / etc.
  setSidechain(trackId: string, enabled: boolean, sourceTrackId: string | null, amount: number) {
    this.disposeSidechain(trackId);
    this.sidechainSettings.set(trackId, { enabled, sourceTrackId, amount });
    if (!enabled || !sourceTrackId || sourceTrackId === trackId) return;
    const source = this.trackNodes.get(sourceTrackId);
    const target = this.trackNodes.get(trackId);
    if (!source || !target) return;
    const follower = new Tone.Follower(0.15);
    const scale = new Tone.Scale(1, Math.max(0, 1 - amount));
    source.gain.connect(follower);
    follower.connect(scale);
    scale.connect(target.duckGain.gain);
    this.sidechainNodes.set(trackId, { follower, scale, sourceTrackId });
  }

  private disposeSidechain(trackId: string) {
    const n = this.sidechainNodes.get(trackId);
    if (n) {
      try {
        n.follower.dispose();
      } catch {
        /* noop */
      }
      try {
        n.scale.dispose();
      } catch {
        /* noop */
      }
      this.sidechainNodes.delete(trackId);
    }
    const target = this.trackNodes.get(trackId);
    if (target) target.duckGain.gain.value = 1;
  }

  // ---- Input Monitoring / mic capture (Workflow: Input Monitoring, Punch-in/out, Loop Comping) ----
  private async openMic(): Promise<boolean> {
    if (this.micStream) return true;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false;
    }
    const rawCtx = Tone.getContext().rawContext as unknown as AudioContext;
    this.micSourceNode = rawCtx.createMediaStreamSource(this.micStream);
    this.micSourceNode.connect(this.monitorGain.input as unknown as AudioNode);
    return true;
  }

  private closeMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    try {
      this.micSourceNode?.disconnect();
    } catch {
      /* noop */
    }
    this.micSourceNode = null;
  }

  /** Live mic -> master passthrough, so an armed + monitor-enabled track can
   *  be heard while recording. Opens the mic lazily on first use. */
  async setMonitorActive(active: boolean) {
    if (active) {
      const ok = await this.openMic();
      this.monitorGain.gain.value = ok ? 1 : 0;
    } else {
      this.monitorGain.gain.value = 0;
    }
  }

  /** Starts capturing the mic into a fresh Tone.Recorder. Used directly for
   *  free-form recording, and by the store for Punch-in/out and Loop Comping,
   *  which slice/splice the resulting buffer after the fact. */
  async startCapture(): Promise<boolean> {
    const ok = await this.openMic();
    if (!ok || !this.micSourceNode) return false;
    this.micRecorder?.dispose();
    const recorder = new Tone.Recorder();
    this.micRecorder = recorder;
    this.micSourceNode.connect(recorder.input as unknown as AudioNode);
    recorder.start();
    return true;
  }

  async stopCapture(): Promise<Blob | null> {
    if (!this.micRecorder) return null;
    const blob = await this.micRecorder.stop();
    try {
      this.micSourceNode?.disconnect(this.micRecorder.input as unknown as AudioNode);
    } catch {
      /* noop */
    }
    this.micRecorder.dispose();
    this.micRecorder = null;
    return blob;
  }

  setBpm(bpm: number) {
    Tone.Transport.bpm.value = bpm;
  }

  /** Tempo Track: schedules a Tone.Transport.bpm step change at each event's
   *  time (cancelling any previously scheduled ones first), so playback
   *  actually speeds up/slows down where the tempo map says it should. Time
   *  signature is applied from whichever event is currently active when
   *  this is called — Tone.Transport only tracks one "current" signature,
   *  it isn't schedulable per-timestamp the way bpm is. */
  applyTempoMap(events: { time: number; bpm: number; numerator: number; denominator: number }[], fallbackBpm: number) {
    Tone.Transport.bpm.cancelScheduledValues(0);
    const sorted = [...events].sort((a, b) => a.time - b.time);
    if (sorted.length === 0) {
      Tone.Transport.bpm.value = fallbackBpm;
      return;
    }
    // Anchor the very first value at t=0 so playback starting mid-timeline
    // still picks up the right bpm immediately, then step-schedule the rest.
    Tone.Transport.bpm.setValueAtTime(sorted[0].bpm, 0);
    for (const ev of sorted) {
      Tone.Transport.bpm.setValueAtTime(ev.bpm, ev.time);
    }
    const active = [...sorted].reverse().find((e) => e.time <= Tone.Transport.seconds) ?? sorted[0];
    Tone.Transport.timeSignature = [active.numerator, active.denominator];
  }

  toggleMetronome(on: boolean) {
    if (on) {
      if (!this.metronome) {
        this.metronome = new Tone.Synth({
          oscillator: { type: "square" },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
        }).toDestination();
      }
      if (!this.metronomeLoop) {
        this.metronomeLoop = new Tone.Loop((time: any) => {
          this.metronome?.triggerAttackRelease("C6", "32n", time);
        }, "4n").start(0);
      }
    } else {
      this.metronomeLoop?.stop();
      this.metronomeLoop?.dispose();
      this.metronomeLoop = null;
    }
  }

  getPlaybackPosition() {
    return Tone.Transport.seconds;
  }

  dispose() {
    if (this.autoTuneLoopId) clearInterval(this.autoTuneLoopId);
    this.closeMic();
    this.micRecorder?.dispose();
    this.trackNodes.forEach((_, id) => this.disposeTrack(id));
    this.midiNodes.forEach((_, id) => this.disposeMidiTrack(id));
    this.busNodes.forEach((_, id) => this.disposeBus(id));
    this.metronomeLoop?.dispose();
    this.metronome?.dispose();
    this.masterGain.dispose();
    this.masterCompressor.dispose();
    this.masterLimiter.dispose();
    this.masterMeter.dispose();
    this.masterAnalyser.dispose();
    this.masterSplit.dispose();
    this.masterWaveformL.dispose();
    this.masterWaveformR.dispose();
  }
}

/** Decode any audio URL (blob: or remote) into a raw AudioBuffer, using the
 *  same AudioContext as the rest of the engine so sample rates line up. */
export async function urlToAudioBuffer(url: string): Promise<AudioBuffer> {
  const ctx = Tone.getContext().rawContext as AudioContext;
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer.slice(0));
}

/** Encode an AudioBuffer back into a playable blob: URL (16-bit WAV). */
export function audioBufferToUrl(buffer: AudioBuffer): string {
  return URL.createObjectURL(audioBufferToWav(buffer));
}

/** Minimal WAV encoder used for the reverse-buffer feature (16-bit PCM). */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2 + 44;
  const arrBuffer = new ArrayBuffer(length);
  const view = new DataView(arrBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, length - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length - 44, true);

  let offset = 44;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channelData.push(buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrBuffer], { type: "audio/wav" });
}

// Singleton instance shared across the app (client-side only).
export const audioEngine = new AudioEngine();

// ---------------------------------------------------------------------------
// Auto-Tune helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Metering helpers (Phase Correlation / Goniometer / True Peak / LUFS bars)
// ---------------------------------------------------------------------------

/** RMS level of a waveform buffer, in dB (silence -> -Infinity). */
function rmsDb(buffer: Float32Array): number {
  const n = buffer.length;
  if (n === 0) return -Infinity;
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += buffer[i] * buffer[i];
  const rms = Math.sqrt(sumSq / n);
  return linearToDb(rms);
}

/** Linear amplitude -> dBFS (0 or negative input -> -Infinity). */
function linearToDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

/**
 * Approximate true-peak amplitude (linear, 0..~1+) of a waveform buffer by
 * 4x-oversampling with linear interpolation between consecutive samples and
 * taking the max absolute value across both the original and interpolated
 * points. A full BS.1770 true-peak meter uses a steeper polyphase FIR
 * resampler; this catches the same inter-sample-peak overs with far less
 * code, at the cost of slightly understating very sharp transients.
 */
function estimateTruePeakLinear(buffer: Float32Array, oversample = 4): number {
  const n = buffer.length;
  if (n === 0) return 0;
  let peak = Math.abs(buffer[n - 1]);
  for (let i = 0; i < n - 1; i++) {
    const a = buffer[i];
    const b = buffer[i + 1];
    const diff = b - a;
    for (let k = 0; k < oversample; k++) {
      const abs = Math.abs(a + diff * (k / oversample));
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

/**
 * Autocorrelation pitch detector, restricted to the ~65-1000Hz vocal range
 * to keep the per-tick cost bounded. Returns Hz, or -1 if the signal is too
 * quiet / has no clear periodicity (silence, noise, consonants).
 */
export function detectPitch(buffer: Float32Array, sampleRate: number): number {
  const n = buffer.length;

  let rms = 0;
  for (let i = 0; i < n; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return -1; // too quiet to trust

  const minLag = Math.floor(sampleRate / 1000); // ~1000Hz upper bound
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / 65)); // ~65Hz lower bound

  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < n - lag; i++) corr += buffer[i] * buffer[i + lag];
    corr /= n - lag;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const normalizedConfidence = bestCorr / (rms * rms);
  if (bestLag <= 0 || normalizedConfidence < 0.35) return -1;
  return sampleRate / bestLag;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** Semitone correction (target - detected) to snap `freqHz` onto the
 *  nearest note of `scale` rooted at `key` (0=C .. 11=B). */
export function nearestScaleCorrection(
  freqHz: number,
  key: number,
  scale: "chromatic" | "major" | "minor"
): number {
  const detectedMidi = 69 + 12 * Math.log2(freqHz / 440);
  const intervals = scale === "major" ? MAJOR_SCALE : scale === "minor" ? MINOR_SCALE : null;

  if (!intervals) {
    // Chromatic: snap to the nearest whole semitone (no key restriction).
    const targetMidi = Math.round(detectedMidi);
    return targetMidi - detectedMidi;
  }

  const rounded = Math.round(detectedMidi);
  const allowed = intervalSet(intervals);
  let best = rounded;
  let bestDist = Infinity;
  for (let candidate = rounded - 12; candidate <= rounded + 12; candidate++) {
    if ((((candidate - key) % 12) + 12) % 12 in allowed) {
      const dist = Math.abs(candidate - detectedMidi);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best - detectedMidi;
}

function intervalSet(intervals: number[]): Record<number, true> {
  const set: Record<number, true> = {};
  intervals.forEach((i) => (set[i] = true));
  return set;
}

// ---------------------------------------------------------------------------
// Time Stretch (offline WSOLA — duration change, pitch preserved)
// ---------------------------------------------------------------------------

/**
 * WSOLA (Waveform Similarity Overlap-Add) time stretch: resamples the
 * playback timeline by `rate` (rate > 1 = shorter/faster, < 1 = longer/
 * slower) while keeping pitch intact, by hopping through the source at a
 * different rate than it re-assembles output frames and nudging each grab
 * within a small search window to the position of best waveform similarity
 * (avoiding phase-cancellation clicks at the seams).
 */
export function wsolaTimeStretch(buffer: AudioBuffer, rate: number): AudioBuffer {
  const clampedRate = Math.max(0.25, Math.min(4, rate));
  const ctx = Tone.getContext().rawContext as AudioContext;
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;

  const frameSize = Math.floor(sampleRate * 0.04); // 40ms grains
  const synthesisHop = Math.floor(frameSize / 2); // 50% overlap on output
  const analysisHop = Math.floor(synthesisHop * clampedRate);
  const searchWindow = Math.floor(sampleRate * 0.008); // +-8ms similarity search

  const outLength = Math.max(1, Math.floor(buffer.length / clampedRate));
  const out = ctx.createBuffer(numChannels, outLength, sampleRate);

  const hann = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
  }

  for (let c = 0; c < numChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    const weight = new Float32Array(outLength);

    let readPos = 0;
    let writePos = 0;
    let lastPlacedStart = 0;

    while (writePos < outLength && readPos < src.length) {
      let bestOffset = 0;

      // After the first grain, search nearby offsets for the best waveform
      // match against the tail of the previously placed grain, to reduce
      // seam artifacts (the core idea behind WSOLA vs. plain overlap-add).
      if (writePos > 0) {
        let bestScore = -Infinity;
        const searchLo = Math.max(0, -searchWindow);
        const searchHi = Math.min(searchWindow, src.length - readPos - frameSize);
        for (let off = searchLo; off <= searchHi; off += 4) {
          let score = 0;
          const overlapLen = Math.min(frameSize, outLength - writePos);
          for (let i = 0; i < overlapLen; i += 4) {
            const a = dst[writePos + i];
            const b = src[readPos + off + i] ?? 0;
            score += a * b;
          }
          if (score > bestScore) {
            bestScore = score;
            bestOffset = off;
          }
        }
      }

      const grainStart = Math.max(0, readPos + bestOffset);
      for (let i = 0; i < frameSize; i++) {
        const srcIdx = grainStart + i;
        const dstIdx = writePos + i;
        if (srcIdx >= src.length || dstIdx >= outLength) break;
        dst[dstIdx] += src[srcIdx] * hann[i];
        weight[dstIdx] += hann[i];
      }

      lastPlacedStart = grainStart;
      readPos = lastPlacedStart + analysisHop;
      writePos += synthesisHop;
    }

    // Normalize by accumulated window weight to flatten the overlap-add gain.
    for (let i = 0; i < outLength; i++) {
      if (weight[i] > 0.001) dst[i] /= weight[i];
    }
  }

  return out;
}

