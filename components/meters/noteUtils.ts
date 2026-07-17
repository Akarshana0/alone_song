const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface NoteInfo {
  name: string; // e.g. "A4"
  cents: number; // -50..+50, deviation from the nearest equal-tempered note
}

/** Converts a frequency in Hz to the nearest equal-tempered note name (A4 = 440Hz) and cents offset. */
export function freqToNote(freqHz: number): NoteInfo {
  const midi = 69 + 12 * Math.log2(freqHz / 440);
  const rounded = Math.round(midi);
  const cents = (midi - rounded) * 100;
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name: `${name}${octave}`, cents };
}
