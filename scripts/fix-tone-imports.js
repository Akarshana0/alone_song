/**
 * Transform audioEngine.ts to use named imports from tone
 * instead of the broken namespace import pattern.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'lib', 'audioEngine.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Replace lines 1-14 (the import block)
const lines = content.split(/\r?\n/);
let endIdx = -1;
for (let i = 0; i < Math.min(20, lines.length); i++) {
  if (lines[i].includes('.default ?? ToneImport')) {
    endIdx = i;
    break;
  }
}

const newImportBlock = [
  '"use client";',
  '',
  '// Named imports from tone — bypasses ESM/CJS namespace interop issues',
  '// that cause "Tone.Meter is not a constructor" in production builds.',
  'import {',
  '  Meter, Gain, Panner, Compressor, Limiter, Filter, Distortion,',
  '  BitCrusher, Chorus, Phaser, Tremolo, Vibrato, PitchShift,',
  '  FeedbackDelay, Reverb, EQ3, Gate, Chebyshev, Player, PolySynth,',
  '  Synth, Analyser, Split, Recorder, Panner3D, LFO, AutoFilter,',
  '  Follower, Scale, Delay, OmniOscillator, Oscillator, PulseOscillator,',
  '  Transport, Destination, start as toneStart, getContext, now as toneNow,',
  '  ToneAudioBuffer, Offline, Draw,',
  '  context as toneCtxAccessor,',
  '} from "tone";',
  'import type * as ToneImport from "tone";',
  '',
  '// Build a Tone-like namespace object from the named imports so every',
  '// existing `Tone.XYZ` / `new Tone.XYZ(...)` reference keeps working',
  '// without touching 200+ call sites.',
  'const Tone: Record<string, any> = {',
  '  Meter, Gain, Panner, Compressor, Limiter, Filter, Distortion,',
  '  BitCrusher, Chorus, Phaser, Tremolo, Vibrato, PitchShift,',
  '  FeedbackDelay, Reverb, EQ3, Gate, Chebyshev, Player, PolySynth,',
  '  Synth, Analyser, Split, Recorder, Panner3D, LFO, AutoFilter,',
  '  Follower, Scale, Delay, OmniOscillator, Oscillator, PulseOscillator,',
  '  Transport, Destination, ToneAudioBuffer, Draw,',
  '  start: toneStart,',
  '  getContext,',
  '  now: toneNow,',
  '  Offline,',
  '  context: toneCtxAccessor,',
  '};',
];

if (endIdx >= 0) {
  lines.splice(0, endIdx + 1, ...newImportBlock);
  content = lines.join('\r\n');
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('OK: Replaced import block (lines 0-' + endIdx + ')');
} else {
  console.error('FAIL: Could not find import block end marker');
  process.exit(1);
}
