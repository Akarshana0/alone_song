"use client";

import { MidiNote } from "./audioEngine";

/**
 * Retrospective Recording (Capture MIDI) — category 8/9 workflow feature.
 *
 * The idea: instead of requiring the record button to be armed *before* you
 * start playing, this module continuously listens to MIDI input (a real
 * MIDI controller via the Web MIDI API, and/or the computer keyboard as a
 * fallback "typing keyboard" synth) and keeps a rolling ring buffer of the
 * last `maxWindowSeconds` of note events, whether or not anything is
 * "recording". `captureRetrospectiveTake` (in the store) then reads that
 * buffer and drops it onto a MIDI track's timeline retroactively — so if
 * you just played something great and only *then* remembered to capture
 * it, nothing is lost.
 *
 * Two independent input sources feed the same buffer:
 *  - Web MIDI API (`navigator.requestMIDIAccess`) for a real MIDI keyboard/
 *    controller, if the browser supports it and permission is granted.
 *  - A QWERTY "computer keyboard as piano" fallback (see KEY_TO_SEMITONE)
 *    for when no MIDI hardware is connected — this is what makes the
 *    feature usable on any machine, not just ones with a MIDI controller.
 *
 * Known limitations:
 *  - Web MIDI is not supported in every browser (notably Safari has patchy/
 *    behind-a-flag support as of this writing) — `isMidiApiSupported()`
 *    lets the UI degrade gracefully to keyboard-only.
 *  - The computer-keyboard fallback is not velocity-sensitive (a physical
 *    key press has no analog pressure data) — every note is captured at a
 *    fixed velocity (0.85). It also only covers about two octaves at once.
 *  - This module tracks wall-clock time (`performance.now()`), not
 *    `Tone.Transport` time, since input can arrive whether or not the
 *    transport is running. `captureRetrospectiveTake` in the store is what
 *    maps that wall-clock window onto the timeline (anchored so the most
 *    recent captured note lands at the current playhead).
 */

export interface CapturedNoteEvent {
  pitch: number; // MIDI note number, 0-127
  velocity: number; // 0..1
  onAtMs: number; // performance.now() timestamp
  offAtMs: number | null; // null while the note is still held
}

/** "Musical typing" layout: two rows of QWERTY keys mapped to a chromatic
 *  run of semitones above a base note (C4 = MIDI 60), the same general
 *  idea used by GarageBand/Ableton's computer-keyboard input. Not meant to
 *  be a full piano — just enough range to sketch a melody or bassline
 *  without a MIDI controller plugged in. */
const KEY_TO_SEMITONE: Record<string, number> = {
  // Lower octave — white keys
  a: 0, s: 2, d: 4, f: 5, g: 7, h: 9, j: 11, k: 12,
  // Lower octave — black keys
  w: 1, e: 3, t: 6, y: 8, u: 10,
  // Continuing into the next octave — white keys
  l: 14, ";": 16, "'": 17,
  // Continuing into the next octave — black keys
  o: 13, p: 15,
};

const DEFAULT_BASE_NOTE = 60; // C4
const MAX_BUFFER_SECONDS = 180; // hard ceiling so the buffer can't grow unbounded

/** Minimal Web MIDI API surface this module needs. TypeScript's bundled DOM
 *  lib doesn't ship official Web MIDI types, so these are declared locally
 *  rather than pulling in an extra @types dependency. */
interface MinimalMidiMessageEvent {
  data: Uint8Array;
}
interface MinimalMidiInput {
  onmidimessage: ((msg: MinimalMidiMessageEvent) => void) | null;
}
interface MinimalMidiAccess {
  inputs: Map<string, MinimalMidiInput> | { forEach: (cb: (input: MinimalMidiInput) => void) => void };
  onstatechange: (() => void) | null;
}

class MidiCaptureBuffer {
  private events: CapturedNoteEvent[] = [];
  private openByPitch: Map<number, CapturedNoteEvent> = new Map();
  private enabled = false;
  private midiAccess: MinimalMidiAccess | null = null;
  private midiInputsConnected = 0;
  private keyboardHeld: Set<string> = new Set();
  private baseNote = DEFAULT_BASE_NOTE;
  private listeners: Set<() => void> = new Set();

  isMidiApiSupported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      midiSupported: this.isMidiApiSupported(),
      midiInputsConnected: this.midiInputsConnected,
      bufferedNoteCount: this.events.length,
    };
  }

  /** Subscribe to buffer/status changes (for a small "listening" indicator
   *  in the UI). Returns an unsubscribe function. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    this.listeners.forEach((cb) => cb());
  }

  setBaseNote(note: number) {
    this.baseNote = note;
  }

  async enable() {
    if (this.enabled) return;
    this.enabled = true;

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.handleKeyDown);
      window.addEventListener("keyup", this.handleKeyUp);
      window.addEventListener("blur", this.handleWindowBlur);
    }

    if (this.isMidiApiSupported()) {
      try {
        this.midiAccess = (await (navigator as unknown as { requestMIDIAccess: () => Promise<MinimalMidiAccess> }).requestMIDIAccess());
        this.attachMidiInputs();
        this.midiAccess.onstatechange = () => this.attachMidiInputs();
      } catch {
        // Permission denied or no device — keyboard fallback still works.
        this.midiAccess = null;
      }
    }
    this.notify();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    // Finalize any still-held notes rather than silently dropping them.
    const now = performance.now();
    this.openByPitch.forEach((ev) => {
      ev.offAtMs = now;
    });
    this.openByPitch.clear();
    this.keyboardHeld.clear();

    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.handleKeyDown);
      window.removeEventListener("keyup", this.handleKeyUp);
      window.removeEventListener("blur", this.handleWindowBlur);
    }
    if (this.midiAccess) {
      this.midiAccess.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    }
    this.midiInputsConnected = 0;
    this.notify();
  }

  clear() {
    this.events = [];
    this.openByPitch.clear();
    this.notify();
  }

  private attachMidiInputs() {
    if (!this.midiAccess) return;
    let count = 0;
    this.midiAccess.inputs.forEach((input) => {
      input.onmidimessage = (msg: MinimalMidiMessageEvent) => this.handleMidiMessage(msg);
      count++;
    });
    this.midiInputsConnected = count;
    this.notify();
  }

  private handleMidiMessage(msg: MinimalMidiMessageEvent) {
    const data = msg.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const pitch = data[1];
    const velocityByte = data.length > 2 ? data[2] : 0;
    if (status === 0x90 && velocityByte > 0) {
      this.noteOn(pitch, velocityByte / 127);
    } else if (status === 0x80 || (status === 0x90 && velocityByte === 0)) {
      this.noteOff(pitch);
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    const key = e.key.toLowerCase();
    const semitone = KEY_TO_SEMITONE[key];
    if (semitone === undefined || this.keyboardHeld.has(key)) return;
    this.keyboardHeld.add(key);
    this.noteOn(this.baseNote + semitone, 0.85);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const semitone = KEY_TO_SEMITONE[key];
    if (semitone === undefined) return;
    this.keyboardHeld.delete(key);
    this.noteOff(this.baseNote + semitone);
  };

  private handleWindowBlur = () => {
    // Losing focus means we'll never see the matching keyup — release
    // everything so a note doesn't appear to hang forever.
    const now = performance.now();
    this.keyboardHeld.clear();
    this.openByPitch.forEach((ev) => {
      ev.offAtMs = now;
    });
    this.openByPitch.clear();
  };

  private noteOn(pitch: number, velocity: number) {
    const now = performance.now();
    // If this exact pitch is somehow still open (stuck note / retrigger
    // without an off), close it out first rather than losing the event.
    const existing = this.openByPitch.get(pitch);
    if (existing) existing.offAtMs = now;
    const ev: CapturedNoteEvent = { pitch, velocity, onAtMs: now, offAtMs: null };
    this.events.push(ev);
    this.openByPitch.set(pitch, ev);
    this.pruneOld();
    this.notify();
  }

  private noteOff(pitch: number) {
    const ev = this.openByPitch.get(pitch);
    if (!ev) return;
    ev.offAtMs = performance.now();
    this.openByPitch.delete(pitch);
    this.notify();
  }

  private pruneOld() {
    const cutoff = performance.now() - MAX_BUFFER_SECONDS * 1000;
    this.events = this.events.filter((ev) => (ev.offAtMs ?? Infinity) >= cutoff);
  }

  /** Returns every note that overlaps the last `windowSeconds`, as plain
   *  `MidiNote`s with `start` relative to the *start* of that window (0 =
   *  windowSeconds ago), clamped so nothing starts before 0. Still-held
   *  notes are extended to "now". The store's `captureRetrospectiveTake`
   *  then offsets these onto the actual timeline. */
  getCapturedNotes(windowSeconds: number): MidiNote[] {
    const now = performance.now();
    const windowStartMs = now - windowSeconds * 1000;
    const out: MidiNote[] = [];
    let idCounter = 0;
    this.events.forEach((ev) => {
      const effectiveOff = ev.offAtMs ?? now;
      if (effectiveOff < windowStartMs) return; // fully before the window
      const startSec = Math.max(0, (ev.onAtMs - windowStartMs) / 1000);
      const endSec = Math.max(startSec + 0.05, (effectiveOff - windowStartMs) / 1000);
      out.push({
        id: `retro-${now}-${idCounter++}`,
        pitch: ev.pitch,
        start: startSec,
        duration: endSec - startSec,
        velocity: ev.velocity,
      });
    });
    return out;
  }
}

export const midiCapture = new MidiCaptureBuffer();
