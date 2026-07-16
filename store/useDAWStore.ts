"use client";

import { create } from "zustand";
import { v4 as uuid } from "uuid";
import {
  defaultTrackEffects,
  TrackEffectsSettings,
  urlToAudioBuffer,
  audioBufferToUrl,
  wsolaTimeStretch,
  defaultAutomation,
  TrackAutomation,
  AutomationParam,
  MidiNote,
  SynthWaveform,
  QuantizeGrid,
  PluginSlot,
  quantizeMidiNotes,
  renderProjectOffline,
  audioEngine,
  ArpeggiatorSettings,
  defaultArpeggiator,
  applyArpeggiator,
  InstrumentEngine,
  WavetableSettings,
  GranularSettings,
  defaultWavetableSettings,
  defaultGranularSettings,
  ScaleType,
  ChordQuality,
  nearestScalePitch,
  humanizeMidiNotes,
  extractGroove,
  applyGroove,
  GrooveTemplate,
} from "@/lib/audioEngine";
import {
  sliceBuffer,
  removeRange,
  silenceRange,
  insertBufferAt,
  splitBuffer,
  mergeBuffersDown,
  sliceIntoPads,
  removeDcOffset,
} from "@/lib/audioEditing";
import { reduceNoise, deClick, deClip, deReverb } from "@/lib/audioRestoration";
import { WarpMarker, defaultWarpMarkers, applyWarpMarkers } from "@/lib/timeWarp";
import { midiCapture } from "@/lib/midiInput";
import {
  LOCAL_KEYS,
  loadLocal,
  saveLocal,
  blobUrlToBase64,
  base64ToBlobUrl,
  Macro,
  MacroStep,
  macroActionDef,
} from "@/lib/projectSync";

export type TrackKind = "audio" | "midi";

export interface Marker {
  id: string;
  time: number;
  label: string;
}

/** One entry on the Chord Track: a root + quality marking what chord the
 *  song is on starting at `time`, purely descriptive (no audio generated
 *  from it) — a reference lane to arrange/solo against. */
export interface ChordEvent {
  id: string;
  time: number;
  root: number; // pitch class 0-11 (0 = C)
  quality: ChordQuality;
}

/** One entry on the Tempo Track / Time Signature Map: the bpm and time
 *  signature take effect starting at `time`. The project's single `bpm`
 *  field stays the "current" value the rest of the UI reads/edits; this
 *  array is what lets that value change partway through the song. */
export interface TempoEvent {
  id: string;
  time: number;
  bpm: number;
  numerator: number; // e.g. 4 in 4/4
  denominator: number; // e.g. 4 in 4/4 (typically 4 or 8)
}

/** A time-range selection made on one track's waveform, used by the
 *  Cut / Copy / Trim / Split / Silence / Paste editing tools. */
export interface Selection {
  trackId: string;
  start: number; // seconds
  end: number; // seconds
}

/** In-memory clipboard for Copy/Cut + Paste. Holds a decoded buffer, so
 *  it's intentionally kept out of the JSON-serialized undo history. */
export interface ClipboardClip {
  buffer: AudioBuffer;
  duration: number;
  label: string;
}

/** A submix group: several tracks route into one shared volume/pan/mute,
 *  which itself feeds the master bus. Purely data here — the engine owns
 *  the actual Tone.js gain/panner nodes, kept in sync via useAudioEngine. */
/** A named, colored group of tracks (Workflow: Track Grouping). Purely a
 *  label registry — membership itself lives on each Track's `groupId`. */
export interface TrackGroup {
  id: string;
  name: string;
  color: string;
}

/** One recorded pass, kept alongside a track so Loop Comping can offer a
 *  pick-the-best-take workflow instead of only ever keeping the last pass. */
export interface Take {
  id: string;
  url: string;
  duration: number;
  label: string;
}

/** Grid subdivisions offered by Snapping (Workflow: Snapping) and used as
 *  the default Nudge step when snap is on. */
export type SnapGrid = "bar" | "beat" | "half-beat";

function gridSeconds(bpm: number, grid: SnapGrid): number {
  const beat = 60 / Math.max(1, bpm);
  if (grid === "bar") return beat * 4;
  if (grid === "half-beat") return beat / 2;
  return beat;
}

/** Rounds `t` to the nearest grid line when snapping is on; otherwise just
 *  clamps to non-negative. Shared by markers, loop/punch region edits, and
 *  waveform selection so every time input in the app snaps consistently. */
export function snapValue(t: number, snapOn: boolean, bpm: number, grid: SnapGrid): number {
  const clamped = Math.max(0, t);
  if (!snapOn) return clamped;
  const g = gridSeconds(bpm, grid);
  return Math.max(0, Math.round(clamped / g) * g);
}

export interface Bus {
  id: string;
  name: string;
  color: string;
  volume: number; // 0 - 1.2
  pan: number; // -1 (L) to 1 (R)
  muted: boolean;
  solo: boolean;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  fileUrl?: string;
  fileName?: string;
  volume: number; // 0 - 1.2
  pan: number; // -1 (L) to 1 (R)
  muted: boolean;
  solo: boolean;
  armed: boolean;
  groupId?: string | null;
  /** Which bus (if any) this track's output routes through instead of
   *  going straight to the master bus. `null`/`undefined` = master. */
  busId?: string | null;
  /** Automation lines/curves for volume and pan, drawn on the timeline. */
  automation: TrackAutomation;
  effects: TrackEffectsSettings;

  /** MIDI piano-roll notes. Only meaningful for kind === "midi", but kept
   *  on every track (empty array) so Track type stays uniform. */
  notes: MidiNote[];
  /** Oscillator waveform for the MIDI track's built-in synth (used when
   *  instrumentEngine === "subtractive"). */
  instrument: SynthWaveform;
  /** Which synthesis engine the MIDI track's instrument uses. */
  instrumentEngine: InstrumentEngine;
  wavetable: WavetableSettings;
  granular: GranularSettings;
  /** MIDI tracks only: turns held chords/notes into a stepped pattern at
   *  playback time (applied to a copy of `notes` before scheduling). */
  arpeggiator: ArpeggiatorSettings;
  /** Elastic-audio warp markers (audio tracks only) — empty until the user
   *  opens the Time Warp panel, which seeds a 1:1 start/end pair. */
  warpMarkers: WarpMarker[];
  /** Hosted Web Audio Modules (VST-style) plugin chain, audio tracks only —
   *  spliced into the engine's per-track chain right before the panner. */
  plugins: PluginSlot[];

  /** Workflow: Nudge — playback offset in seconds (+later / -earlier),
   *  applied live by the engine without touching the buffer. */
  nudge: number;
  /** Workflow: Input Monitoring — hear the live mic while this track is
   *  armed, instead of only after recording finishes. */
  monitorEnabled: boolean;
  /** Workflow: Loop Comping — alternate takes recorded across loop passes,
   *  kept alongside the track so any pass can be promoted to the real audio. */
  takes: Take[];

  /** Folder Tracks (nested): `isFolder` marks a track as a folder header
   *  (holds no audio/MIDI of its own); `parentId` points a normal track (or
   *  another folder, for nesting) at the folder it lives inside; `collapsed`
   *  hides a folder's children in the Timeline/track list when true. */
  isFolder?: boolean;
  parentId?: string | null;
  collapsed?: boolean;

  /** Track Freeze / Bounce to Audio: `frozen` is true once this track's
   *  live FX chain has been rendered down to a flat audio file (fileUrl now
   *  points at that render). `preFreeze*` stashes what the track looked
   *  like before freezing so Unfreeze can restore it exactly. */
  frozen?: boolean;
  preFreezeFileUrl?: string;
  preFreezeEffects?: TrackEffectsSettings;
  preFreezeKind?: TrackKind;
}

/** Track Templates — a reusable snapshot of everything about a track EXCEPT
 *  its actual audio/MIDI content and mix-session-specific fields (id, name,
 *  mute/solo/arm, group/bus routing, nudge, takes). Applying one to a track
 *  restamps its sound design (effects, instrument, plugins are NOT included
 *  since plugin instances are loaded async and host-specific); creating a
 *  track from one starts a brand-new track with that sound design ready to
 *  go. Persisted to localStorage so templates survive a reload/new project. */
export interface TrackTemplate {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  volume: number;
  pan: number;
  effects: TrackEffectsSettings;
  instrument: SynthWaveform;
  instrumentEngine: InstrumentEngine;
  wavetable: WavetableSettings;
  granular: GranularSettings;
  arpeggiator: ArpeggiatorSettings;
  automation: TrackAutomation;
}

/** Cloud Sync — a named, timestamped snapshot of the whole session, kept
 *  in localStorage as a lightweight stand-in for a real backend. Structure
 *  only (tracks/buses/groups/markers/tempo/macros/templates); actual audio
 *  stays local to this browser for these quick snapshots — use Export
 *  Project / Share Code below for a fully portable copy including audio. */
export interface CloudVersion {
  id: string;
  name: string;
  savedAt: number;
  snapshot: ProjectSnapshot;
}

/** The serializable shape of an entire session, used by Cloud Sync, Export
 *  Project, and Share Code. `audio` is only populated when exporting/sharing
 *  (base64 data URLs, keyed by track id) since it's the one piece too big
 *  and too session-specific for quick localStorage round-trips. */
export interface ProjectSnapshot {
  version: 1;
  bpm: number;
  masterVolume: number;
  tracks: Track[];
  buses: Bus[];
  groups: TrackGroup[];
  markers: Marker[];
  macros: Macro[];
  trackTemplates: TrackTemplate[];
  audio?: Record<string, string>; // trackId -> base64 data URL
  /** Optional so older snapshots (saved before these features existed)
   *  still load fine — loadProjectSnapshot falls back to empty/defaults. */
  chordTrack?: ChordEvent[];
  tempoEvents?: TempoEvent[];
  scaleRoot?: number;
  scaleType?: ScaleType;
}

interface DAWState {
  tracks: Track[];
  buses: Bus[];
  groups: TrackGroup[];
  selectedTrackId: string | null;
  isPlaying: boolean;
  isRecording: boolean;
  metronomeOn: boolean;
  bpm: number;
  currentTime: number;
  masterVolume: number;
  markers: Marker[];
  snapEnabled: boolean;
  snapGrid: SnapGrid;
  nudgeStepMs: number;

  // --- Advanced/MIDI: Retrospective Recording (see lib/midiInput.ts) ---
  // Continuously buffers incoming MIDI/keyboard notes in the background so
  // a take can be captured onto the timeline *after* the fact, without
  // having pressed Record first.
  retroCaptureEnabled: boolean;
  retroCaptureWindowSeconds: number;

  // --- Workflow: Loop Comping ---
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  /** Track receiving takes while a loop-comping pass is being recorded. */
  compingTrackId: string | null;

  // --- Workflow: Punch-in/out ---
  punchEnabled: boolean;
  punchIn: number;
  punchOut: number;
  /** Transport event id for the scheduled punch-out, so it can be cancelled
   *  if the user stops recording manually before reaching it. */
  punchEventId: number | null;

  // --- Chord Track ---
  chordTrack: ChordEvent[];
  addChordEvent: (time: number, root?: number, quality?: ChordQuality) => void;
  updateChordEvent: (id: string, patch: Partial<Omit<ChordEvent, "id">>) => void;
  removeChordEvent: (id: string) => void;
  clearChordTrack: () => void;

  // --- Tempo Track / Time Signature Map ---
  tempoEvents: TempoEvent[];
  addTempoEvent: (time: number, bpm?: number, numerator?: number, denominator?: number) => void;
  updateTempoEvent: (id: string, patch: Partial<Omit<TempoEvent, "id">>) => void;
  removeTempoEvent: (id: string) => void;
  clearTempoEvents: () => void;

  // --- Scale Highlighting & Snapping ---
  scaleRoot: number; // pitch class 0-11
  scaleType: ScaleType;
  scaleSnapEnabled: boolean;
  setScale: (root: number, scaleType: ScaleType) => void;
  toggleScaleSnap: () => void;

  // --- Groove Extraction ---
  grooveTemplate: GrooveTemplate | null;
  grooveSourceTrackId: string | null;
  extractGrooveFromTrack: (trackId: string, grid: QuantizeGrid) => void;
  applyGrooveToTrack: (trackId: string, grid: QuantizeGrid, amount: number) => void;

  // --- MIDI Humanize ---
  humanizeNotes: (trackId: string, timingMs: number, velocityAmount: number) => void;

  selection: Selection | null;
  clipboard: ClipboardClip | null;

  history: string[]; // JSON snapshots of `tracks` for undo/redo
  historyIndex: number;

  // --- Track Templates ---
  trackTemplates: TrackTemplate[];
  templatesPanelOpen: boolean;
  toggleTemplatesPanel: (open?: boolean) => void;
  saveTrackTemplate: (trackId: string, name: string) => void;
  applyTrackTemplate: (trackId: string, templateId: string) => void;
  createTrackFromTemplate: (templateId: string) => void;
  deleteTrackTemplate: (id: string) => void;

  // --- Macros / Custom Actions ---
  macros: Macro[];
  macrosPanelOpen: boolean;
  runningMacroId: string | null;
  toggleMacrosPanel: (open?: boolean) => void;
  saveMacro: (name: string, steps: MacroStep[]) => void;
  deleteMacro: (id: string) => void;
  runMacro: (macroId: string, trackId: string) => Promise<void>;

  // --- Cloud Sync / Collaboration ---
  cloudVersions: CloudVersion[];
  cloudPanelOpen: boolean;
  cloudBusy: boolean;
  cloudError: string | null;
  toggleCloudPanel: (open?: boolean) => void;
  buildProjectSnapshot: (includeAudio: boolean) => Promise<ProjectSnapshot>;
  loadProjectSnapshot: (snapshot: ProjectSnapshot) => Promise<void>;
  pushToCloud: (name: string) => Promise<void>;
  pullFromCloud: (versionId: string) => void;
  deleteCloudVersion: (versionId: string) => void;
  exportProjectFile: () => Promise<void>;
  importProjectFile: (file: File) => Promise<void>;
  copyShareCode: () => Promise<string>;
  pasteShareCode: (code: string) => Promise<void>;

  // --- Ripple Delete ---
  rippleDeleteSelection: () => Promise<void>;

  addTrack: (kind?: TrackKind) => void;
  removeTrack: (id: string) => void;
  /** Folder Tracks (nested): creates a folder header track, and lets any
   *  existing track be filed into (or out of, with `null`) one. */
  addFolderTrack: () => void;
  setTrackParent: (trackId: string, parentId: string | null) => void;
  toggleFolderCollapse: (trackId: string) => void;
  /** Track Freeze / Bounce to Audio: renders the track's current live
   *  output to a flat audio file and swaps it in, muting further live FX
   *  processing (Unfreeze restores exactly what was there before). MIDI
   *  tracks freeze into an equivalent audio track ("bounce to audio"). */
  freezeTrack: (trackId: string) => Promise<void>;
  unfreezeTrack: (trackId: string) => void;
  /** Pre-roll: bars of metronome count-in played before recording/playback
   *  actually starts (0 = off). */
  preRollBars: number;
  setPreRollBars: (bars: number) => void;
  selectTrack: (id: string) => void;
  loadFileToTrack: (id: string, file: File) => void;
  setTrackFileUrl: (id: string, url: string, fileName?: string) => void;
  setTrackVolume: (id: string, volume: number) => void;
  setTrackPan: (id: string, pan: number) => void;
  toggleMute: (id: string) => void;
  toggleSolo: (id: string) => void;
  toggleArm: (id: string) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackGroup: (id: string, groupId: string | null) => void;

  updateTrackEffects: (id: string, updater: (fx: TrackEffectsSettings) => TrackEffectsSettings) => void;
  toggleReverse: (id: string) => void;
  applyTimeStretch: (id: string, rate: number) => Promise<void>;
  applyNoiseReduction: (id: string, amount: number) => Promise<void>;
  applyDeClick: (id: string, sensitivity: number) => Promise<void>;
  applyDeClip: (id: string, threshold: number) => Promise<void>;
  applyDeReverb: (id: string, amount: number) => Promise<void>;
  /** DC Offset Removal: destructive buffer transform, same offline pattern
   *  as the rest of the Restoration suite. */
  applyDcOffsetRemoval: (id: string) => Promise<void>;
  /** Phase Inversion / Polarity Flip: a live, non-destructive toggle (see
   *  AudioEngine.setPolarity), unlike the Restoration tools above. */
  togglePolarityInvert: (id: string) => void;

  addBus: (name?: string) => void;
  removeBus: (id: string) => void;
  renameBus: (id: string, name: string) => void;
  setBusVolume: (id: string, volume: number) => void;
  setBusPan: (id: string, pan: number) => void;
  toggleBusMute: (id: string) => void;
  toggleBusSolo: (id: string) => void;
  assignTrackToBus: (trackId: string, busId: string | null) => void;

  toggleAutomationLane: (trackId: string, param: AutomationParam) => void;
  addAutomationPoint: (trackId: string, param: AutomationParam, time: number, value: number) => void;
  moveAutomationPoint: (trackId: string, param: AutomationParam, pointId: string, time: number, value: number) => void;
  removeAutomationPoint: (trackId: string, param: AutomationParam, pointId: string) => void;
  clearAutomationLane: (trackId: string, param: AutomationParam) => void;

  addMarker: (time: number, label?: string) => void;
  removeMarker: (id: string) => void;
  toggleSnap: () => void;
  setSnapGrid: (grid: SnapGrid) => void;
  setNudgeStep: (ms: number) => void;
  /** Snaps a raw waveform/timeline time (seconds) using the current snap
   *  settings — shared by Track.tsx's region drag and the workflow bar. */
  snapTime: (t: number) => number;
  /** Moves the playhead directly (Workflow: Snapping / Markers), re-starting
   *  playback at the new spot if the transport is currently running. */
  seekPlayhead: (seconds: number) => void;

  // --- Track Grouping ---
  addGroup: (name?: string) => string;
  renameGroup: (id: string, name: string) => void;
  removeGroup: (id: string) => void;
  toggleGroupMute: (id: string) => void;
  toggleGroupSolo: (id: string) => void;

  // --- Nudge ---
  nudgeTrack: (id: string, direction: 1 | -1) => void;

  // --- Input Monitoring ---
  toggleMonitor: (id: string) => void;

  // --- Loop Comping ---
  toggleLoop: () => void;
  setLoopRegion: (start: number, end: number) => void;
  setLoopFromSelection: () => void;
  applyTake: (trackId: string, takeId: string) => void;
  removeTake: (trackId: string, takeId: string) => void;

  // --- Punch-in/out ---
  togglePunch: () => void;
  setPunchRegion: (start: number, end: number) => void;
  setPunchFromSelection: () => void;

  // --- Recording orchestration (free / punch / loop-comping) ---
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  finalizePunchTake: (trackId: string) => Promise<void>;

  // --- MIDI piano roll ---
  addMidiNote: (trackId: string, pitch: number, start: number, duration: number, velocity?: number) => void;
  updateMidiNote: (trackId: string, noteId: string, patch: Partial<MidiNote>) => void;
  removeMidiNote: (trackId: string, noteId: string) => void;
  clearMidiNotes: (trackId: string) => void;
  quantizeNotes: (trackId: string, grid: QuantizeGrid) => void;
  setInstrument: (trackId: string, waveform: SynthWaveform) => void;

  // --- Arpeggiator (MIDI tracks) ---
  setArpeggiator: (trackId: string, updater: (a: ArpeggiatorSettings) => ArpeggiatorSettings) => void;

  // --- Wavetable / Granular synthesis (MIDI tracks) ---
  setInstrumentEngine: (trackId: string, engine: InstrumentEngine) => void;
  setWavetablePosition: (trackId: string, position: number) => void;
  setGranularSettings: (trackId: string, updater: (g: GranularSettings) => GranularSettings) => void;
  loadGranularSample: (trackId: string, file: File) => Promise<void>;

  // --- Sample Slicing (MPC-style pad slicer, audio tracks) ---
  padSlicerTrackId: string | null;
  togglePadSlicer: (trackId: string | null) => void;
  sendSliceToNewTrack: (trackId: string, sliceIndex: number, totalSlices: number) => Promise<void>;

  // --- Time Warping (elastic audio / warp markers, audio tracks) ---
  seedWarpMarkers: (trackId: string, duration: number) => void;
  addWarpMarker: (trackId: string, sourceTime: number, timelineTime: number) => void;
  updateWarpMarker: (trackId: string, markerId: string, patch: Partial<WarpMarker>) => void;
  removeWarpMarker: (trackId: string, markerId: string) => void;
  applyTimeWarp: (trackId: string) => Promise<void>;

  // --- Tape Stop / Tape Start (live trigger, audio tracks) ---
  triggerTapeStop: (trackId: string) => void;
  triggerTapeStart: (trackId: string) => void;

  // --- VST/Plugin support (Web Audio Modules) ---
  addPlugin: (trackId: string, url: string, name?: string) => Promise<void>;
  removePlugin: (trackId: string, pluginId: string) => void;
  togglePluginBypass: (trackId: string, pluginId: string) => void;

  // --- Rendering / export (offline bounce to WAV) ---
  /** Export/Delivery panel (stems, batch export, format/dither/ID3 options). */
  exportPanelOpen: boolean;
  toggleExportPanel: (open?: boolean) => void;

  renderState: "idle" | "rendering" | "done" | "error";
  renderProgress: number;
  renderError: string | null;
  renderProject: () => Promise<void>;

  setSelection: (selection: Selection | null) => void;
  clearSelection: () => void;

  cutSelection: () => Promise<void>;
  copySelection: () => Promise<void>;
  pasteAtPlayhead: () => Promise<void>;
  trimToSelection: () => Promise<void>;
  splitTrack: () => Promise<void>;
  silenceSelection: () => Promise<void>;
  mergeDown: (trackId: string) => Promise<void>;

  play: () => void;
  pause: () => void;
  stop: () => void;
  toggleRecording: () => void;
  toggleMetronome: () => void;
  /** Retrospective Recording (see lib/midiInput.ts): toggling this on/off
   *  starts/stops the background MIDI + computer-keyboard listener.
   *  `captureRetrospectiveTake` reads whatever's currently buffered and
   *  drops it onto `trackId`'s piano roll, anchored so the most recent
   *  captured note lands at the current playhead. */
  setRetroCaptureEnabled: (enabled: boolean) => void;
  setRetroCaptureWindowSeconds: (seconds: number) => void;
  captureRetrospectiveTake: (trackId: string) => void;
  setBpm: (bpm: number) => void;
  setCurrentTime: (t: number) => void;
  setMasterVolume: (v: number) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

const TRACK_COLORS = ["#3ee6e0", "#ff4fd8", "#a45bff", "#ffb84f", "#ff5c6c", "#5cffb0"];
const BUS_COLORS = ["#ff9d5c", "#5cd6ff", "#c95cff", "#5cff9d", "#ff5c9d"];
const MAX_HISTORY = 50;

export const useDAWStore = create<DAWState>((set, get) => ({
  tracks: [],
  buses: [],
  groups: [],
  selectedTrackId: null,
  isPlaying: false,
  isRecording: false,
  metronomeOn: false,
  retroCaptureEnabled: false,
  retroCaptureWindowSeconds: 15,
  bpm: 120,
  currentTime: 0,
  masterVolume: 1,
  markers: [],
  chordTrack: [],
  tempoEvents: [],
  scaleRoot: 0,
  scaleType: "major",
  scaleSnapEnabled: false,
  grooveTemplate: null,
  grooveSourceTrackId: null,
  snapEnabled: true,
  snapGrid: "beat",
  nudgeStepMs: 10,
  loopEnabled: false,
  loopStart: 0,
  loopEnd: 4,
  compingTrackId: null,
  punchEnabled: false,
  punchIn: 0,
  punchOut: 2,
  punchEventId: null,
  selection: null,
  clipboard: null,
  history: [],
  historyIndex: -1,

  trackTemplates: loadLocal<TrackTemplate[]>(LOCAL_KEYS.templates, []),
  templatesPanelOpen: false,
  macros: loadLocal<Macro[]>(LOCAL_KEYS.macros, []),
  macrosPanelOpen: false,
  runningMacroId: null,
  cloudVersions: loadLocal<CloudVersion[]>(LOCAL_KEYS.cloud, []),
  cloudPanelOpen: false,
  cloudBusy: false,
  cloudError: null,

  exportPanelOpen: false,
  toggleExportPanel: (open) => set((state) => ({ exportPanelOpen: open ?? !state.exportPanelOpen })),
  padSlicerTrackId: null,

  renderState: "idle",
  renderProgress: 0,
  renderError: null,

  addTrack: (kind = "audio") => {
    set((state) => {
      const newTrack: Track = {
        id: uuid(),
        name: `${kind === "audio" ? "Audio" : "MIDI"} ${state.tracks.length + 1}`,
        kind,
        color: TRACK_COLORS[state.tracks.length % TRACK_COLORS.length],
        volume: 0.85,
        pan: 0,
        muted: false,
        solo: false,
        armed: false,
        groupId: null,
        busId: null,
        automation: defaultAutomation(),
        effects: defaultTrackEffects(),
        notes: [],
        instrument: "sine",
        instrumentEngine: "subtractive",
        wavetable: defaultWavetableSettings(),
        granular: defaultGranularSettings(),
        arpeggiator: defaultArpeggiator(),
        warpMarkers: [],
        plugins: [],
        nudge: 0,
        monitorEnabled: false,
        takes: [],
      };
      return {
        tracks: [...state.tracks, newTrack],
        selectedTrackId: newTrack.id,
      };
    });
    get().pushHistory();
  },

  removeTrack: (id) => {
    set((state) => ({
      tracks: state.tracks.filter((t) => t.id !== id),
      selectedTrackId: state.selectedTrackId === id ? null : state.selectedTrackId,
    }));
    get().pushHistory();
  },

  addFolderTrack: () => {
    set((state) => {
      const folder: Track = {
        id: uuid(),
        name: `Folder ${state.tracks.filter((t) => t.isFolder).length + 1}`,
        kind: "audio",
        color: TRACK_COLORS[state.tracks.length % TRACK_COLORS.length],
        volume: 0.85,
        pan: 0,
        muted: false,
        solo: false,
        armed: false,
        groupId: null,
        busId: null,
        automation: defaultAutomation(),
        effects: defaultTrackEffects(),
        notes: [],
        instrument: "sine",
        instrumentEngine: "subtractive",
        wavetable: defaultWavetableSettings(),
        granular: defaultGranularSettings(),
        arpeggiator: defaultArpeggiator(),
        warpMarkers: [],
        plugins: [],
        nudge: 0,
        monitorEnabled: false,
        takes: [],
        isFolder: true,
        parentId: null,
        collapsed: false,
      };
      return { tracks: [...state.tracks, folder], selectedTrackId: folder.id };
    });
    get().pushHistory();
  },

  setTrackParent: (trackId, parentId) => {
    // Guard against a folder being filed into itself or into its own child.
    if (trackId === parentId) return;
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, parentId } : t)),
    }));
    get().pushHistory();
  },

  toggleFolderCollapse: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, collapsed: !t.collapsed } : t)),
    }));
  },

  preRollBars: 0,
  setPreRollBars: (bars) => set({ preRollBars: Math.max(0, Math.round(bars)) }),

  freezeTrack: async (trackId) => {
    const track = get().tracks.find((t) => t.id === trackId);
    if (!track || track.frozen || track.isFolder) return;
    // Rough duration estimate for the real-time capture window: longest of
    // the loaded buffer, any MIDI note end, or a sane 3-minute fallback.
    const midiEnd = track.notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
    const durationSec = track.kind === "midi" ? Math.max(4, midiEnd + 1) : 240;
    let url: string | null = null;
    if (track.kind === "midi") {
      url = await audioEngine.bounceMidiTrack(trackId, durationSec);
    } else {
      url = await audioEngine.freezeTrack(trackId, durationSec);
    }
    if (!url) return;
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              frozen: true,
              preFreezeFileUrl: t.fileUrl,
              preFreezeEffects: t.effects,
              preFreezeKind: t.kind,
              fileUrl: url!,
              kind: "audio",
              effects: defaultTrackEffects(), // avoid double-processing the already-rendered audio
            }
          : t
      ),
    }));
    await audioEngine.loadTrack(trackId, url);
    get().pushHistory();
  },

  unfreezeTrack: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId && t.frozen
          ? {
              ...t,
              frozen: false,
              fileUrl: t.preFreezeFileUrl,
              effects: t.preFreezeEffects ?? defaultTrackEffects(),
              kind: t.preFreezeKind ?? t.kind,
              preFreezeFileUrl: undefined,
              preFreezeEffects: undefined,
              preFreezeKind: undefined,
            }
          : t
      ),
    }));
    const track = get().tracks.find((t) => t.id === trackId);
    if (track?.fileUrl) audioEngine.loadTrack(trackId, track.fileUrl);
    get().pushHistory();
  },

  selectTrack: (id) => set({ selectedTrackId: id }),

  loadFileToTrack: (id, file) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, fileUrl: URL.createObjectURL(file), fileName: file.name } : t
      ),
    }));
    get().pushHistory();
  },

  setTrackFileUrl: (id, url, fileName) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, fileUrl: url, fileName: fileName ?? t.fileName } : t
      ),
    }));
    get().pushHistory();
  },

  setTrackVolume: (id, volume) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, volume } : t)),
    })),

  setTrackPan: (id, pan) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, pan } : t)),
    })),

  toggleMute: (id) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)),
    }));
    get().pushHistory();
  },

  toggleSolo: (id) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, solo: !t.solo } : t)),
    }));
    get().pushHistory();
  },

  toggleArm: (id) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, armed: !t.armed } : t)),
    })),

  renameTrack: (id, name) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  setTrackGroup: (id, groupId) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, groupId } : t)),
    })),

  updateTrackEffects: (id, updater) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, effects: updater(t.effects) } : t)),
    })),

  toggleReverse: (id) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, effects: { ...t.effects, reversed: !t.effects.reversed } } : t
      ),
    }));
    get().pushHistory();
  },

  applyTimeStretch: async (id, rate) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track?.fileUrl || rate === 1) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const stretched = wsolaTimeStretch(buffer, rate);
    get().setTrackFileUrl(track.id, audioBufferToUrl(stretched), track.fileName);
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, effects: { ...t.effects, timeStretch: { rate: 1 } } } : t
      ),
    }));
  },

  // --- Restoration: same offline "decode -> transform -> re-encode" pattern
  // as applyTimeStretch above. Each is destructive and gets its own undo step.
  applyNoiseReduction: async (id, amount) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const cleaned = reduceNoise(buffer, amount);
    get().setTrackFileUrl(track.id, audioBufferToUrl(cleaned), track.fileName);
  },

  applyDeClick: async (id, sensitivity) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const cleaned = deClick(buffer, sensitivity);
    get().setTrackFileUrl(track.id, audioBufferToUrl(cleaned), track.fileName);
  },

  applyDeClip: async (id, threshold) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const cleaned = deClip(buffer, threshold);
    get().setTrackFileUrl(track.id, audioBufferToUrl(cleaned), track.fileName);
  },

  applyDeReverb: async (id, amount) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const cleaned = deReverb(buffer, amount);
    get().setTrackFileUrl(track.id, audioBufferToUrl(cleaned), track.fileName);
  },

  applyDcOffsetRemoval: async (id) => {
    const track = get().tracks.find((t) => t.id === id);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const centered = removeDcOffset(buffer);
    get().setTrackFileUrl(track.id, audioBufferToUrl(centered), track.fileName);
  },

  togglePolarityInvert: (id) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, effects: { ...t.effects, polarityInverted: !t.effects.polarityInverted } } : t
      ),
    }));
    get().pushHistory();
  },

  // --- Buses: submix groups. Data only — engine node create/dispose and
  // parameter sync happens in useAudioEngine.ts, mirroring how track
  // mute/solo/volume already flow from store -> engine. ---
  addBus: (name) => {
    set((state) => {
      const newBus: Bus = {
        id: uuid(),
        name: name ?? `Bus ${state.buses.length + 1}`,
        color: BUS_COLORS[state.buses.length % BUS_COLORS.length],
        volume: 0.85,
        pan: 0,
        muted: false,
        solo: false,
      };
      return { buses: [...state.buses, newBus] };
    });
  },

  removeBus: (id) =>
    set((state) => ({
      buses: state.buses.filter((b) => b.id !== id),
      tracks: state.tracks.map((t) => (t.busId === id ? { ...t, busId: null } : t)),
    })),

  renameBus: (id, name) =>
    set((state) => ({ buses: state.buses.map((b) => (b.id === id ? { ...b, name } : b)) })),

  setBusVolume: (id, volume) =>
    set((state) => ({ buses: state.buses.map((b) => (b.id === id ? { ...b, volume } : b)) })),

  setBusPan: (id, pan) =>
    set((state) => ({ buses: state.buses.map((b) => (b.id === id ? { ...b, pan } : b)) })),

  toggleBusMute: (id) =>
    set((state) => ({ buses: state.buses.map((b) => (b.id === id ? { ...b, muted: !b.muted } : b)) })),

  toggleBusSolo: (id) =>
    set((state) => ({ buses: state.buses.map((b) => (b.id === id ? { ...b, solo: !b.solo } : b)) })),

  assignTrackToBus: (trackId, busId) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, busId } : t)),
    })),

  // --- Automation lines/curves: per-track volume/pan envelopes drawn on
  // the timeline. Points are kept time-sorted so the engine can walk them
  // in order when scheduling ramps against Tone.Transport. ---
  toggleAutomationLane: (trackId, param) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              automation: {
                ...t.automation,
                [param]: { ...t.automation[param], enabled: !t.automation[param].enabled },
              },
            }
          : t
      ),
    })),

  addAutomationPoint: (trackId, param, time, value) =>
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lane = t.automation[param];
        const points = [...lane.points, { id: uuid(), time: Math.max(0, time), value }].sort(
          (a, b) => a.time - b.time
        );
        return { ...t, automation: { ...t.automation, [param]: { ...lane, points } } };
      }),
    })),

  moveAutomationPoint: (trackId, param, pointId, time, value) =>
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lane = t.automation[param];
        const points = lane.points
          .map((p) => (p.id === pointId ? { ...p, time: Math.max(0, time), value } : p))
          .sort((a, b) => a.time - b.time);
        return { ...t, automation: { ...t.automation, [param]: { ...lane, points } } };
      }),
    })),

  removeAutomationPoint: (trackId, param, pointId) =>
    set((state) => ({
      tracks: state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const lane = t.automation[param];
        return {
          ...t,
          automation: { ...t.automation, [param]: { ...lane, points: lane.points.filter((p) => p.id !== pointId) } },
        };
      }),
    })),

  clearAutomationLane: (trackId, param) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? { ...t, automation: { ...t.automation, [param]: { ...t.automation[param], points: [] } } }
          : t
      ),
    })),

  addMarker: (time, label) =>
    set((state) => ({
      markers: [
        ...state.markers,
        { id: uuid(), time: snapValue(time, state.snapEnabled, state.bpm, state.snapGrid), label: label ?? `M${state.markers.length + 1}` },
      ].sort((a, b) => a.time - b.time),
    })),

  removeMarker: (id) =>
    set((state) => ({ markers: state.markers.filter((m) => m.id !== id) })),

  // --- Chord Track ---
  addChordEvent: (time, root = 0, quality = "maj") =>
    set((state) => ({
      chordTrack: [
        ...state.chordTrack,
        { id: uuid(), time: snapValue(time, state.snapEnabled, state.bpm, state.snapGrid), root, quality },
      ].sort((a, b) => a.time - b.time),
    })),
  updateChordEvent: (id, patch) =>
    set((state) => ({
      chordTrack: state.chordTrack
        .map((c) => (c.id === id ? { ...c, ...patch } : c))
        .sort((a, b) => a.time - b.time),
    })),
  removeChordEvent: (id) =>
    set((state) => ({ chordTrack: state.chordTrack.filter((c) => c.id !== id) })),
  clearChordTrack: () => set({ chordTrack: [] }),

  // --- Tempo Track / Time Signature Map ---
  addTempoEvent: (time, bpm, numerator = 4, denominator = 4) =>
    set((state) => ({
      tempoEvents: [
        ...state.tempoEvents,
        {
          id: uuid(),
          time: snapValue(time, state.snapEnabled, state.bpm, state.snapGrid),
          bpm: bpm ?? state.bpm,
          numerator,
          denominator,
        },
      ].sort((a, b) => a.time - b.time),
    })),
  updateTempoEvent: (id, patch) =>
    set((state) => ({
      tempoEvents: state.tempoEvents
        .map((e) => (e.id === id ? { ...e, ...patch } : e))
        .sort((a, b) => a.time - b.time),
    })),
  removeTempoEvent: (id) =>
    set((state) => ({ tempoEvents: state.tempoEvents.filter((e) => e.id !== id) })),
  clearTempoEvents: () => set({ tempoEvents: [] }),

  // --- Scale Highlighting & Snapping ---
  setScale: (root, scaleType) => set({ scaleRoot: root, scaleType }),
  toggleScaleSnap: () => set((state) => ({ scaleSnapEnabled: !state.scaleSnapEnabled })),

  // --- Groove Extraction ---
  extractGrooveFromTrack: (trackId, grid) =>
    set((state) => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return state;
      return {
        grooveTemplate: extractGroove(track.notes, state.bpm, grid),
        grooveSourceTrackId: trackId,
      };
    }),
  applyGrooveToTrack: (trackId, grid, amount) => {
    set((state) => {
      if (!state.grooveTemplate) return state;
      const template = state.grooveTemplate;
      return {
        tracks: state.tracks.map((t) =>
          t.id === trackId ? { ...t, notes: applyGroove(t.notes, template, state.bpm, grid, amount) } : t
        ),
      };
    });
    get().pushHistory();
  },

  // --- MIDI Humanize ---
  humanizeNotes: (trackId, timingMs, velocityAmount) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, notes: humanizeMidiNotes(t.notes, timingMs, velocityAmount) } : t
      ),
    }));
    get().pushHistory();
  },

  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setSnapGrid: (grid) => set({ snapGrid: grid }),
  setNudgeStep: (ms) => set({ nudgeStepMs: Math.max(1, ms) }),
  snapTime: (t) => {
    const s = get();
    return snapValue(t, s.snapEnabled, s.bpm, s.snapGrid);
  },

  seekPlayhead: (seconds) => {
    const state = get();
    const t = Math.max(0, seconds);
    audioEngine.seekTo(t, state.isPlaying);
    set({ currentTime: t });
  },

  // --- Track Grouping: a lightweight named/colored registry; membership
  // lives on each Track's groupId (setTrackGroup, already above). ---
  addGroup: (name) => {
    const id = uuid();
    set((state) => ({
      groups: [
        ...state.groups,
        { id, name: name?.trim() || `Group ${state.groups.length + 1}`, color: TRACK_COLORS[state.groups.length % TRACK_COLORS.length] },
      ],
    }));
    return id;
  },

  renameGroup: (id, name) =>
    set((state) => ({ groups: state.groups.map((g) => (g.id === id ? { ...g, name } : g)) })),

  removeGroup: (id) =>
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
      tracks: state.tracks.map((t) => (t.groupId === id ? { ...t, groupId: null } : t)),
    })),

  toggleGroupMute: (id) =>
    set((state) => {
      const members = state.tracks.filter((t) => t.groupId === id);
      const anyUnmuted = members.some((t) => !t.muted);
      return { tracks: state.tracks.map((t) => (t.groupId === id ? { ...t, muted: anyUnmuted } : t)) };
    }),

  toggleGroupSolo: (id) =>
    set((state) => {
      const members = state.tracks.filter((t) => t.groupId === id);
      const anySoloOff = members.some((t) => !t.solo);
      return { tracks: state.tracks.map((t) => (t.groupId === id ? { ...t, solo: anySoloOff } : t)) };
    }),

  // --- Nudge: step size follows the snap grid when snap is on, else the
  // explicit ms step — matches how most DAWs tie nudge to the grid. ---
  nudgeTrack: (id, direction) => {
    const state = get();
    const step = state.snapEnabled ? gridSeconds(state.bpm, state.snapGrid) : state.nudgeStepMs / 1000;
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === id ? { ...t, nudge: Math.round((t.nudge + direction * step) * 1000) / 1000 } : t
      ),
    }));
    audioEngine.setTrackNudge(id, get().tracks.find((t) => t.id === id)?.nudge ?? 0);
  },

  // --- Input Monitoring ---
  toggleMonitor: (id) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, monitorEnabled: !t.monitorEnabled } : t)),
    })),

  // --- Loop Comping ---
  toggleLoop: () => set((state) => ({ loopEnabled: !state.loopEnabled })),
  setLoopRegion: (start, end) => {
    const state = get();
    const s = snapValue(start, state.snapEnabled, state.bpm, state.snapGrid);
    const e = Math.max(s + 0.1, snapValue(end, state.snapEnabled, state.bpm, state.snapGrid));
    set({ loopStart: s, loopEnd: e });
  },
  setLoopFromSelection: () => {
    const sel = get().selection;
    if (!sel) return;
    get().setLoopRegion(sel.start, sel.end);
  },
  applyTake: (trackId, takeId) => {
    const track = get().tracks.find((t) => t.id === trackId);
    const take = track?.takes.find((tk) => tk.id === takeId);
    if (!track || !take) return;
    get().setTrackFileUrl(trackId, take.url, `${take.label}.wav`);
  },
  removeTake: (trackId, takeId) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, takes: t.takes.filter((tk) => tk.id !== takeId) } : t
      ),
    })),

  // --- Punch-in/out ---
  togglePunch: () => set((state) => ({ punchEnabled: !state.punchEnabled })),
  setPunchRegion: (start, end) => {
    const state = get();
    const s = snapValue(start, state.snapEnabled, state.bpm, state.snapGrid);
    const e = Math.max(s + 0.1, snapValue(end, state.snapEnabled, state.bpm, state.snapGrid));
    set({ punchIn: s, punchOut: e });
  },
  setPunchFromSelection: () => {
    const sel = get().selection;
    if (!sel) return;
    get().setPunchRegion(sel.start, sel.end);
  },

  // --- Recording orchestration: routes to free / punch / loop-comping
  // capture depending on which mode is armed. All three funnel through the
  // engine's shared mic + Tone.Recorder (startCapture/stopCapture). ---
  startRecording: async () => {
    const state = get();
    const track = state.tracks.find((t) => t.armed) ?? state.tracks.find((t) => t.id === state.selectedTrackId);
    if (!track) return;
    await audioEngine.start();

    if (state.punchEnabled) {
      if (state.punchOut <= state.punchIn) return;
      audioEngine.seekTo(state.punchIn, false);
      set({ currentTime: state.punchIn });
      const started = await audioEngine.startCapture();
      if (!started) return;
      audioEngine.playAll();
      const evtId = audioEngine.onTransportTime(state.punchOut, () => {
        get().finalizePunchTake(track.id);
      });
      set({ isRecording: true, isPlaying: true, punchEventId: evtId });
      return;
    }

    if (state.loopEnabled) {
      if (state.loopEnd <= state.loopStart) return;
      audioEngine.setTransportLoop(true, state.loopStart, state.loopEnd);
      audioEngine.seekTo(state.loopStart, false);
      const started = await audioEngine.startCapture();
      if (!started) return;
      audioEngine.playAll();
      set({ isRecording: true, isPlaying: true, currentTime: state.loopStart, compingTrackId: track.id });
      return;
    }

    // Pre-roll: count in before capture actually starts (punch/loop modes
    // already have their own lead-in via seek-then-play, so pre-roll only
    // applies to plain free recording here).
    if (state.preRollBars > 0) {
      await audioEngine.playWithPreRoll(state.preRollBars, () => {});
    }
    const started = await audioEngine.startCapture();
    if (started) set({ isRecording: true });
  },

  stopRecording: async () => {
    const state = get();

    if (state.punchEnabled && state.punchEventId != null) {
      audioEngine.clearTransportEvent(state.punchEventId);
      const track = state.tracks.find((t) => t.armed) ?? state.tracks.find((t) => t.id === state.selectedTrackId);
      set({ punchEventId: null });
      if (track) await get().finalizePunchTake(track.id);
      return;
    }

    if (state.loopEnabled && state.compingTrackId) {
      const trackId = state.compingTrackId;
      const blob = await audioEngine.stopCapture();
      audioEngine.setTransportLoop(false, 0, 0);
      audioEngine.pauseAll();
      set({ isRecording: false, isPlaying: false, compingTrackId: null });
      if (blob) {
        const full = await urlToAudioBuffer(URL.createObjectURL(blob));
        const passDuration = Math.max(0.1, state.loopEnd - state.loopStart);
        const passes = Math.max(1, Math.round(full.duration / passDuration));
        for (let i = 0; i < passes; i++) {
          const s = i * passDuration;
          const e = Math.min(full.duration, s + passDuration);
          if (e <= s) continue;
          const slice = sliceBuffer(full, s, e);
          const takeId = uuid();
          set((st) => ({
            tracks: st.tracks.map((t) =>
              t.id === trackId
                ? { ...t, takes: [...t.takes, { id: takeId, url: audioBufferToUrl(slice), duration: slice.duration, label: `Take ${t.takes.length + 1}` }] }
                : t
            ),
          }));
        }
      }
      return;
    }

    const blob = await audioEngine.stopCapture();
    set({ isRecording: false });
    const track = state.tracks.find((t) => t.armed) ?? state.tracks.find((t) => t.id === state.selectedTrackId);
    if (blob && track) {
      const buf = await urlToAudioBuffer(URL.createObjectURL(blob));
      get().setTrackFileUrl(track.id, audioBufferToUrl(buf), "recording.wav");
    }
  },

  // Shared by the punch-out transport callback and an early manual Stop.
  finalizePunchTake: async (trackId) => {
    const blob = await audioEngine.stopCapture();
    audioEngine.pauseAll();
    const state = get();
    set({ isRecording: false, isPlaying: false, punchEventId: null });
    if (!blob) return;
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const recordedBuf = await urlToAudioBuffer(URL.createObjectURL(blob));
    if (track.fileUrl) {
      const original = await urlToAudioBuffer(track.fileUrl);
      const spliced = insertBufferAt(removeRange(original, state.punchIn, state.punchOut), recordedBuf, state.punchIn);
      get().setTrackFileUrl(track.id, audioBufferToUrl(spliced), track.fileName);
    } else {
      get().setTrackFileUrl(track.id, audioBufferToUrl(recordedBuf), "punch-take.wav");
    }
  },

  // --- MIDI piano roll: notes are absolute seconds from track start, same
  // convention as audio-track selections. Quantize is a separate, explicit
  // corrective action (rather than snapping on every click) so free-time
  // note placement stays possible. ---
  addMidiNote: (trackId, pitch, start, duration, velocity = 0.85) => {
    set((state) => {
      const snappedPitch = state.scaleSnapEnabled
        ? nearestScalePitch(pitch, state.scaleRoot, state.scaleType)
        : pitch;
      return {
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                notes: [
                  ...t.notes,
                  {
                    id: uuid(),
                    pitch: snappedPitch,
                    start: Math.max(0, start),
                    duration: Math.max(0.05, duration),
                    velocity,
                  },
                ],
              }
            : t
        ),
      };
    });
    get().pushHistory();
  },

  updateMidiNote: (trackId, noteId, patch) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? { ...t, notes: t.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)) }
          : t
      ),
    })),

  removeMidiNote: (trackId, noteId) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, notes: t.notes.filter((n) => n.id !== noteId) } : t
      ),
    }));
    get().pushHistory();
  },

  clearMidiNotes: (trackId) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, notes: [] } : t)),
    }));
    get().pushHistory();
  },

  quantizeNotes: (trackId, grid) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, notes: quantizeMidiNotes(t.notes, state.bpm, grid) } : t
      ),
    }));
    get().pushHistory();
  },

  setInstrument: (trackId, waveform) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, instrument: waveform } : t)),
    })),

  // --- Arpeggiator: pure data on the track; Track.tsx re-derives the
  // arpeggiated note list (audioEngine.scheduleMidiTrack) whenever this or
  // the raw notes change, so no engine call is needed here directly. ---
  setArpeggiator: (trackId, updater) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, arpeggiator: updater(t.arpeggiator) } : t)),
    })),

  // --- Wavetable / Granular synthesis ---
  setInstrumentEngine: (trackId, engine) => {
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, instrumentEngine: engine } : t)),
    }));
    get().pushHistory();
  },

  setWavetablePosition: (trackId, position) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, wavetable: { position } } : t)),
    })),

  setGranularSettings: (trackId, updater) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, granular: updater(t.granular) } : t)),
    })),

  loadGranularSample: async (trackId, file) => {
    const url = URL.createObjectURL(file);
    await audioEngine.loadGranularSample(trackId, url);
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, granular: { ...t.granular, sampleUrl: url } } : t
      ),
    }));
    get().pushHistory();
  },

  // --- Sample Slicing (MPC-style pad slicer) ---
  togglePadSlicer: (trackId) => set((state) => ({ padSlicerTrackId: state.padSlicerTrackId === trackId ? null : trackId })),

  sendSliceToNewTrack: async (trackId, sliceIndex, totalSlices) => {
    const track = get().tracks.find((t) => t.id === trackId);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const pads = sliceIntoPads(buffer, totalSlices);
    const pad = pads[sliceIndex];
    if (!pad) return;
    const slice = sliceBuffer(buffer, pad.start, pad.end);
    const url = audioBufferToUrl(slice);
    set((state) => {
      const newTrack: Track = {
        id: uuid(),
        name: `${track.name} slice ${sliceIndex + 1}`,
        kind: "audio",
        color: TRACK_COLORS[state.tracks.length % TRACK_COLORS.length],
        fileUrl: url,
        fileName: `${track.fileName ?? "slice"}-${sliceIndex + 1}.wav`,
        volume: 0.85,
        pan: 0,
        muted: false,
        solo: false,
        armed: false,
        groupId: null,
        busId: null,
        automation: defaultAutomation(),
        effects: defaultTrackEffects(),
        notes: [],
        instrument: "sine",
        instrumentEngine: "subtractive",
        wavetable: defaultWavetableSettings(),
        granular: defaultGranularSettings(),
        arpeggiator: defaultArpeggiator(),
        warpMarkers: [],
        plugins: [],
        nudge: 0,
        monitorEnabled: false,
        takes: [],
      };
      return { tracks: [...state.tracks, newTrack] };
    });
    get().pushHistory();
  },

  // --- Time Warping (elastic audio / warp markers) ---
  seedWarpMarkers: (trackId, duration) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId && t.warpMarkers.length < 2 ? { ...t, warpMarkers: defaultWarpMarkers(duration) } : t
      ),
    })),

  addWarpMarker: (trackId, sourceTime, timelineTime) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, warpMarkers: [...t.warpMarkers, { id: uuid(), sourceTime, timelineTime }] } : t
      ),
    }));
    get().pushHistory();
  },

  updateWarpMarker: (trackId, markerId, patch) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? { ...t, warpMarkers: t.warpMarkers.map((m) => (m.id === markerId ? { ...m, ...patch } : m)) }
          : t
      ),
    })),

  removeWarpMarker: (trackId, markerId) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, warpMarkers: t.warpMarkers.filter((m) => m.id !== markerId) } : t
      ),
    }));
    get().pushHistory();
  },

  applyTimeWarp: async (trackId) => {
    const track = get().tracks.find((t) => t.id === trackId);
    if (!track?.fileUrl || track.warpMarkers.length < 2) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const warped = applyWarpMarkers(buffer, track.warpMarkers);
    get().setTrackFileUrl(track.id, audioBufferToUrl(warped), track.fileName);
    const newDuration = track.warpMarkers[track.warpMarkers.length - 1].timelineTime;
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, warpMarkers: defaultWarpMarkers(newDuration) } : t)),
    }));
  },

  // --- Tape Stop / Tape Start: live triggers, not store-persisted state
  // (see AudioEngine.triggerTapeStop/triggerTapeStart). ---
  triggerTapeStop: (trackId) => {
    const track = get().tracks.find((t) => t.id === trackId);
    if (!track) return;
    audioEngine.triggerTapeStop(trackId, track.effects.tapeStop.stopDuration, track.effects.tapeStop.curve);
  },

  triggerTapeStart: (trackId) => {
    const track = get().tracks.find((t) => t.id === trackId);
    if (!track) return;
    audioEngine.triggerTapeStart(trackId, track.effects.tapeStop.startDuration, track.effects.tapeStop.curve);
  },

  // --- VST/Plugin support (Web Audio Modules): plugins are hosted live by
  // the engine (lib/audioEngine.ts loadPlugin), the store just tracks slot
  // metadata + status so the UI can show loading/ready/error per plugin. ---
  addPlugin: async (trackId, url, name) => {
    const id = uuid();
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              plugins: [
                ...t.plugins,
                { id, name: name?.trim() || url.split("/").pop() || "Plugin", url, bypassed: false, status: "loading" },
              ],
            }
          : t
      ),
    }));
    try {
      await audioEngine.loadPlugin(trackId, id, url);
      set((state) => ({
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? { ...t, plugins: t.plugins.map((p) => (p.id === id ? { ...p, status: "ready" } : p)) }
            : t
        ),
      }));
    } catch (err) {
      set((state) => ({
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                plugins: t.plugins.map((p) =>
                  p.id === id ? { ...p, status: "error", error: err instanceof Error ? err.message : String(err) } : p
                ),
              }
            : t
        ),
      }));
    }
  },

  removePlugin: (trackId, pluginId) => {
    audioEngine.unloadPlugin(trackId, pluginId);
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId ? { ...t, plugins: t.plugins.filter((p) => p.id !== pluginId) } : t
      ),
    }));
  },

  togglePluginBypass: (trackId, pluginId) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? { ...t, plugins: t.plugins.map((p) => (p.id === pluginId ? { ...p, bypassed: !p.bypassed } : p)) }
          : t
      ),
    }));
    const track = get().tracks.find((t) => t.id === trackId);
    const slot = track?.plugins.find((p) => p.id === pluginId);
    if (slot) audioEngine.setPluginBypass(trackId, pluginId, slot.bypassed);
  },

  // --- Rendering / export: bounces the whole project to a WAV file via
  // Tone.Offline (see renderProjectOffline) and triggers a browser download. ---
  renderProject: async () => {
    set({ renderState: "rendering", renderProgress: 0, renderError: null });
    try {
      const state = get();
      audioEngine.stopAll();
      set({ isPlaying: false, currentTime: 0 });
      const blob = await renderProjectOffline(state.tracks, state.bpm, (p) => set({ renderProgress: p }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${document.title || "alone-song"}-render.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      set({ renderState: "done", renderProgress: 1 });
    } catch (err) {
      set({ renderState: "error", renderError: err instanceof Error ? err.message : String(err) });
    }
  },

  setSelection: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),

  // --- Range-based editing tools (Cut / Copy / Paste / Trim / Split / Merge / Silence) ---
  // All of these decode the track's current audio into a raw AudioBuffer,
  // transform it with the pure helpers in lib/audioEditing.ts, then
  // re-encode the result back into a blob: URL via setTrackFileUrl, which
  // Track.tsx picks up to reload the waveform + engine player.

  cutSelection: async () => {
    const sel = get().selection;
    if (!sel || sel.end <= sel.start) return;
    const track = get().tracks.find((t) => t.id === sel.trackId);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const removed = sliceBuffer(buffer, sel.start, sel.end);
    const remainder = removeRange(buffer, sel.start, sel.end);
    set({
      clipboard: { buffer: removed, duration: removed.duration, label: `${track.name} clip` },
      selection: null,
    });
    get().setTrackFileUrl(track.id, audioBufferToUrl(remainder), track.fileName);
  },

  copySelection: async () => {
    const sel = get().selection;
    if (!sel || sel.end <= sel.start) return;
    const track = get().tracks.find((t) => t.id === sel.trackId);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const copied = sliceBuffer(buffer, sel.start, sel.end);
    set({ clipboard: { buffer: copied, duration: copied.duration, label: `${track.name} clip` } });
  },

  pasteAtPlayhead: async () => {
    const state = get();
    const clip = state.clipboard;
    if (!clip) return;
    const targetId = state.selection?.trackId ?? state.selectedTrackId;
    if (!targetId) return;
    const track = state.tracks.find((t) => t.id === targetId);
    if (!track?.fileUrl) return;
    const at = state.selection && state.selection.trackId === targetId ? state.selection.start : state.currentTime;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const result = insertBufferAt(buffer, clip.buffer, at);
    set({ selection: null });
    get().setTrackFileUrl(track.id, audioBufferToUrl(result), track.fileName);
  },

  trimToSelection: async () => {
    const sel = get().selection;
    if (!sel || sel.end <= sel.start) return;
    const track = get().tracks.find((t) => t.id === sel.trackId);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const trimmed = sliceBuffer(buffer, sel.start, sel.end);
    set({ selection: null });
    get().setTrackFileUrl(track.id, audioBufferToUrl(trimmed), track.fileName);
  },

  splitTrack: async () => {
    const state = get();
    const targetId = state.selection?.trackId ?? state.selectedTrackId;
    if (!targetId) return;
    const track = state.tracks.find((t) => t.id === targetId);
    if (!track?.fileUrl) return;
    const at = state.selection && state.selection.trackId === targetId ? state.selection.start : state.currentTime;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    if (at <= 0 || at >= buffer.duration) return;
    const [first, second] = splitBuffer(buffer, at);
    const newTrack: Track = {
      ...track,
      id: uuid(),
      name: `${track.name} (split)`,
      fileUrl: audioBufferToUrl(second),
      takes: [],
    };
    set((s) => {
      const idx = s.tracks.findIndex((t) => t.id === track.id);
      if (idx === -1) return s;
      const nextTracks = [...s.tracks];
      nextTracks[idx] = { ...track, fileUrl: audioBufferToUrl(first) };
      nextTracks.splice(idx + 1, 0, newTrack);
      return { tracks: nextTracks, selectedTrackId: newTrack.id, selection: null };
    });
    get().pushHistory();
  },

  silenceSelection: async () => {
    const sel = get().selection;
    if (!sel || sel.end <= sel.start) return;
    const track = get().tracks.find((t) => t.id === sel.trackId);
    if (!track?.fileUrl) return;
    const buffer = await urlToAudioBuffer(track.fileUrl);
    const silenced = silenceRange(buffer, sel.start, sel.end);
    get().setTrackFileUrl(track.id, audioBufferToUrl(silenced), track.fileName);
  },

  mergeDown: async (trackId) => {
    const state = get();
    const idx = state.tracks.findIndex((t) => t.id === trackId);
    if (idx === -1 || idx >= state.tracks.length - 1) return;
    const a = state.tracks[idx];
    const b = state.tracks[idx + 1];
    if (!a.fileUrl || !b.fileUrl) return;
    const [bufA, bufB] = await Promise.all([urlToAudioBuffer(a.fileUrl), urlToAudioBuffer(b.fileUrl)]);
    const merged = mergeBuffersDown(
      bufA, a.muted ? 0 : a.volume, a.pan,
      bufB, b.muted ? 0 : b.volume, b.pan
    );
    const mergedUrl = audioBufferToUrl(merged);
    set((s) => {
      const nextTracks = s.tracks
        .filter((t) => t.id !== b.id)
        .map((t) =>
          t.id === a.id
            ? { ...t, name: `${a.name} + ${b.name}`, fileUrl: mergedUrl, volume: 0.85, pan: 0, muted: false }
            : t
        );
      return { tracks: nextTracks, selectedTrackId: a.id, selection: null };
    });
    get().pushHistory();
  },

  // --- Track Templates: snapshot a track's sound design (not its audio/MIDI
  // content) so it can be re-applied or spun into a fresh track later. ---
  toggleTemplatesPanel: (open) => set((state) => ({ templatesPanelOpen: open ?? !state.templatesPanelOpen })),

  saveTrackTemplate: (trackId, name) => {
    const track = get().tracks.find((t) => t.id === trackId);
    if (!track) return;
    const template: TrackTemplate = {
      id: uuid(),
      name,
      kind: track.kind,
      color: track.color,
      volume: track.volume,
      pan: track.pan,
      effects: track.effects,
      instrument: track.instrument,
      instrumentEngine: track.instrumentEngine,
      wavetable: track.wavetable,
      granular: track.granular,
      arpeggiator: track.arpeggiator,
      automation: track.automation,
    };
    set((state) => {
      const next = [...state.trackTemplates, template];
      saveLocal(LOCAL_KEYS.templates, next);
      return { trackTemplates: next };
    });
  },

  applyTrackTemplate: (trackId, templateId) => {
    const template = get().trackTemplates.find((t) => t.id === templateId);
    if (!template) return;
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              color: template.color,
              volume: template.volume,
              pan: template.pan,
              effects: template.effects,
              instrument: template.instrument,
              instrumentEngine: template.instrumentEngine,
              wavetable: template.wavetable,
              granular: template.granular,
              arpeggiator: template.arpeggiator,
              automation: template.automation,
            }
          : t
      ),
    }));
    get().pushHistory();
  },

  createTrackFromTemplate: (templateId) => {
    const template = get().trackTemplates.find((t) => t.id === templateId);
    if (!template) return;
    set((state) => {
      const newTrack: Track = {
        id: uuid(),
        name: `${template.name} ${state.tracks.length + 1}`,
        kind: template.kind,
        color: template.color,
        volume: template.volume,
        pan: template.pan,
        muted: false,
        solo: false,
        armed: false,
        groupId: null,
        busId: null,
        automation: template.automation,
        effects: template.effects,
        notes: [],
        instrument: template.instrument,
        instrumentEngine: template.instrumentEngine,
        wavetable: template.wavetable,
        granular: template.granular,
        arpeggiator: template.arpeggiator,
        warpMarkers: [],
        plugins: [],
        nudge: 0,
        monitorEnabled: false,
        takes: [],
      };
      return { tracks: [...state.tracks, newTrack], selectedTrackId: newTrack.id };
    });
    get().pushHistory();
  },

  deleteTrackTemplate: (id) => {
    set((state) => {
      const next = state.trackTemplates.filter((t) => t.id !== id);
      saveLocal(LOCAL_KEYS.templates, next);
      return { trackTemplates: next };
    });
  },

  // --- Macros / Custom Actions: a named, replayable chain of existing
  // track actions, run in order against whichever track you point it at. ---
  toggleMacrosPanel: (open) => set((state) => ({ macrosPanelOpen: open ?? !state.macrosPanelOpen })),

  saveMacro: (name, steps) => {
    set((state) => {
      const next = [...state.macros, { id: uuid(), name, steps }];
      saveLocal(LOCAL_KEYS.macros, next);
      return { macros: next };
    });
  },

  deleteMacro: (id) => {
    set((state) => {
      const next = state.macros.filter((m) => m.id !== id);
      saveLocal(LOCAL_KEYS.macros, next);
      return { macros: next };
    });
  },

  runMacro: async (macroId, trackId) => {
    const macro = get().macros.find((m) => m.id === macroId);
    if (!macro || !get().tracks.find((t) => t.id === trackId)) return;
    set({ runningMacroId: macroId });
    try {
      for (const step of macro.steps) {
        const def = macroActionDef(step.action);
        const amount = step.amount ?? def.default ?? 0;
        switch (step.action) {
          case "toggleReverse":
            get().toggleReverse(trackId);
            break;
          case "timeStretch":
            await get().applyTimeStretch(trackId, amount);
            break;
          case "noiseReduction":
            await get().applyNoiseReduction(trackId, amount);
            break;
          case "deClick":
            await get().applyDeClick(trackId, amount);
            break;
          case "deClip":
            await get().applyDeClip(trackId, amount);
            break;
          case "deReverb":
            await get().applyDeReverb(trackId, amount);
            break;
          case "setVolume":
            get().setTrackVolume(trackId, amount);
            break;
          case "setPan":
            get().setTrackPan(trackId, amount);
            break;
          case "mute":
            if (!get().tracks.find((t) => t.id === trackId)?.muted) get().toggleMute(trackId);
            break;
          case "unmute":
            if (get().tracks.find((t) => t.id === trackId)?.muted) get().toggleMute(trackId);
            break;
        }
      }
      get().pushHistory();
    } finally {
      set({ runningMacroId: null });
    }
  },

  // --- Cloud Sync / Collaboration: localStorage-backed version snapshots
  // stand in for a real backend (structure only — audio stays on-device for
  // these quick saves); Export/Share Code embed audio as base64 so a
  // project can travel to another browser/device/collaborator intact. ---
  toggleCloudPanel: (open) => set((state) => ({ cloudPanelOpen: open ?? !state.cloudPanelOpen, cloudError: null })),

  buildProjectSnapshot: async (includeAudio) => {
    const state = get();
    const snapshot: ProjectSnapshot = {
      version: 1,
      bpm: state.bpm,
      masterVolume: state.masterVolume,
      tracks: state.tracks,
      buses: state.buses,
      groups: state.groups,
      markers: state.markers,
      macros: state.macros,
      trackTemplates: state.trackTemplates,
      chordTrack: state.chordTrack,
      tempoEvents: state.tempoEvents,
      scaleRoot: state.scaleRoot,
      scaleType: state.scaleType,
    };
    if (includeAudio) {
      const audio: Record<string, string> = {};
      await Promise.all(
        state.tracks.map(async (t) => {
          if (!t.fileUrl) return;
          try {
            audio[t.id] = await blobUrlToBase64(t.fileUrl);
          } catch {
            // Skip a clip that can't be read rather than failing the whole export.
          }
        })
      );
      snapshot.audio = audio;
    }
    return snapshot;
  },

  loadProjectSnapshot: async (snapshot) => {
    let tracks = snapshot.tracks;
    if (snapshot.audio) {
      const audio = snapshot.audio;
      tracks = await Promise.all(
        tracks.map(async (t) => {
          const data = audio[t.id];
          if (!data) return t;
          try {
            return { ...t, fileUrl: await base64ToBlobUrl(data) };
          } catch {
            return t;
          }
        })
      );
    }
    set({
      bpm: snapshot.bpm,
      masterVolume: snapshot.masterVolume,
      tracks,
      buses: snapshot.buses,
      groups: snapshot.groups,
      markers: snapshot.markers,
      macros: snapshot.macros,
      trackTemplates: snapshot.trackTemplates,
      chordTrack: snapshot.chordTrack ?? [],
      tempoEvents: snapshot.tempoEvents ?? [],
      scaleRoot: snapshot.scaleRoot ?? 0,
      scaleType: snapshot.scaleType ?? "major",
      selectedTrackId: tracks[0]?.id ?? null,
      selection: null,
    });
    saveLocal(LOCAL_KEYS.macros, snapshot.macros);
    saveLocal(LOCAL_KEYS.templates, snapshot.trackTemplates);
    get().pushHistory();
  },

  pushToCloud: async (name) => {
    set({ cloudBusy: true, cloudError: null });
    try {
      const snapshot = await get().buildProjectSnapshot(false);
      const version: CloudVersion = { id: uuid(), name, savedAt: Date.now(), snapshot };
      set((state) => {
        const next = [version, ...state.cloudVersions].slice(0, 20);
        const ok = saveLocal(LOCAL_KEYS.cloud, next);
        return {
          cloudVersions: next,
          cloudError: ok ? null : "Saved, but local storage is nearly full — older versions may get trimmed.",
        };
      });
    } catch (err) {
      set({ cloudError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ cloudBusy: false });
    }
  },

  pullFromCloud: (versionId) => {
    const version = get().cloudVersions.find((v) => v.id === versionId);
    if (!version) return;
    get().loadProjectSnapshot(version.snapshot);
  },

  deleteCloudVersion: (versionId) => {
    set((state) => {
      const next = state.cloudVersions.filter((v) => v.id !== versionId);
      saveLocal(LOCAL_KEYS.cloud, next);
      return { cloudVersions: next };
    });
  },

  exportProjectFile: async () => {
    set({ cloudBusy: true, cloudError: null });
    try {
      const snapshot = await get().buildProjectSnapshot(true);
      const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${document.title || "alone-song"}-project.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      set({ cloudError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ cloudBusy: false });
    }
  },

  importProjectFile: async (file) => {
    set({ cloudBusy: true, cloudError: null });
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text) as ProjectSnapshot;
      await get().loadProjectSnapshot(snapshot);
    } catch (err) {
      set({ cloudError: "Couldn't read that project file — " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      set({ cloudBusy: false });
    }
  },

  copyShareCode: async () => {
    const snapshot = await get().buildProjectSnapshot(true);
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(snapshot))));
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        // Clipboard permission denied — caller still gets the code back to display/copy manually.
      }
    }
    return code;
  },

  pasteShareCode: async (code) => {
    set({ cloudBusy: true, cloudError: null });
    try {
      const json = decodeURIComponent(escape(atob(code.trim())));
      const snapshot = JSON.parse(json) as ProjectSnapshot;
      await get().loadProjectSnapshot(snapshot);
    } catch {
      set({ cloudError: "That share code looks invalid or corrupted." });
    } finally {
      set({ cloudBusy: false });
    }
  },

  // --- Ripple Delete: removes the selected range from EVERY track's audio
  // in sync (not just the one selected on), and shifts every other
  // time-based thing after it — MIDI notes, warp markers, automation
  // points, markers, loop/punch region, playhead — earlier by the same
  // amount, so the whole session stays glued together instead of opening a
  // silent gap the way plain Cut/Trim would. ---
  rippleDeleteSelection: async () => {
    const sel = get().selection;
    if (!sel || sel.end <= sel.start) return;
    const { start, end } = sel;
    const shift = end - start;
    const state = get();
    const audioTracks = state.tracks.filter((t) => t.fileUrl);
    const updatedUrls = new Map<string, string>();
    await Promise.all(
      audioTracks.map(async (t) => {
        const buffer = await urlToAudioBuffer(t.fileUrl!);
        const rippled = removeRange(buffer, start, end);
        updatedUrls.set(t.id, audioBufferToUrl(rippled));
      })
    );

    const shiftTime = (t: number) => (t >= end ? t - shift : t >= start ? start : t);

    set((s) => ({
      tracks: s.tracks.map((t) => {
        const next: Track = updatedUrls.has(t.id) ? { ...t, fileUrl: updatedUrls.get(t.id)! } : { ...t };
        next.notes = t.notes.map((n) => ({ ...n, start: shiftTime(n.start) }));
        next.warpMarkers = t.warpMarkers.map((m) => ({ ...m, timelineTime: shiftTime(m.timelineTime) }));
        next.automation = {
          volume: { ...t.automation.volume, points: t.automation.volume.points.map((p) => ({ ...p, time: shiftTime(p.time) })) },
          pan: { ...t.automation.pan, points: t.automation.pan.points.map((p) => ({ ...p, time: shiftTime(p.time) })) },
        };
        return next;
      }),
      markers: s.markers.map((m) => ({ ...m, time: shiftTime(m.time) })),
      loopStart: shiftTime(s.loopStart),
      loopEnd: shiftTime(s.loopEnd),
      punchIn: shiftTime(s.punchIn),
      punchOut: shiftTime(s.punchOut),
      currentTime: shiftTime(s.currentTime),
      selection: null,
    }));
    get().pushHistory();
  },

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, currentTime: 0 }),
  toggleRecording: () => set((state) => ({ isRecording: !state.isRecording })),
  toggleMetronome: () => set((state) => ({ metronomeOn: !state.metronomeOn })),

  setRetroCaptureEnabled: (enabled) => {
    if (enabled) {
      midiCapture.enable().catch(() => {});
    } else {
      midiCapture.disable();
    }
    set({ retroCaptureEnabled: enabled });
  },

  setRetroCaptureWindowSeconds: (seconds) => {
    set({ retroCaptureWindowSeconds: Math.max(1, Math.min(180, seconds)) });
  },

  captureRetrospectiveTake: (trackId) => {
    const state = get();
    const captured = midiCapture.getCapturedNotes(state.retroCaptureWindowSeconds);
    if (captured.length === 0) return;
    // Anchor the buffered window so the most recent captured note lands at
    // the current playhead, and everything before it lines up relative to
    // that — i.e. "what I just played" ends right about now.
    const anchor = Math.max(0, state.currentTime - state.retroCaptureWindowSeconds);
    const placed: MidiNote[] = captured.map((n, i) => ({
      ...n,
      id: `${uuid()}-${i}`,
      start: anchor + n.start,
    }));
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, notes: [...t.notes, ...placed] } : t)),
    }));
    get().pushHistory();
  },
  setBpm: (bpm) => set({ bpm }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setMasterVolume: (v) => set({ masterVolume: v }),

  // --- Simple whole-state undo/redo (tracks array snapshots) ---
  pushHistory: () =>
    set((state) => {
      const snapshot = JSON.stringify(state.tracks);
      const trimmed = state.history.slice(0, state.historyIndex + 1);
      const nextHistory = [...trimmed, snapshot].slice(-MAX_HISTORY);
      return { history: nextHistory, historyIndex: nextHistory.length - 1 };
    }),

  undo: () =>
    set((state) => {
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      return { tracks: JSON.parse(state.history[newIndex]), historyIndex: newIndex };
    }),

  redo: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      return { tracks: JSON.parse(state.history[newIndex]), historyIndex: newIndex };
    }),
}));
