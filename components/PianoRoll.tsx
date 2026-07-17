"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Grid3x3, Wand2, Sparkles, Mic } from "lucide-react";
import clsx from "clsx";
import { Track as TrackType, useDAWStore } from "@/store/useDAWStore";
import { midiCapture } from "@/lib/midiInput";
import {
  midiToNoteName,
  QuantizeGrid,
  SynthWaveform,
  InstrumentEngine,
  ScaleType,
  SCALE_LABELS,
  isPitchInScale,
} from "@/lib/audioEngine";

const SCALE_ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALE_TYPE_OPTIONS = Object.keys(SCALE_LABELS) as ScaleType[];

// Piano roll geometry: fixed row height / seconds-per-pixel so notes line up
// exactly with the grid lines drawn underneath them.
const ROW_HEIGHT = 14;
const PX_PER_SECOND = 60;
const LOW_PITCH = 36; // C2
const HIGH_PITCH = 84; // C5
const DEFAULT_NOTE_SECONDS = 0.25;
const VISIBLE_SECONDS = 32;

const GRID_OPTIONS: { value: QuantizeGrid; label: string }[] = [
  { value: "1/4", label: "1/4" },
  { value: "1/8", label: "1/8" },
  { value: "1/16", label: "1/16" },
  { value: "1/8t", label: "1/8 T" },
  { value: "1/16t", label: "1/16 T" },
];

const WAVEFORM_OPTIONS: { value: SynthWaveform; label: string }[] = [
  { value: "sine", label: "Sine" },
  { value: "triangle", label: "Triangle" },
  { value: "square", label: "Square" },
  { value: "sawtooth", label: "Saw" },
];

/**
 * MIDI piano roll: a scrollable pitch (rows) x time (columns) grid. Click
 * empty space to drop a note at that exact time/pitch; click an existing
 * note to delete it; drag from a note's right edge to lengthen it. Notes
 * are free-time by design — Quantize is the explicit corrective action
 * that snaps every note's start to the chosen grid subdivision.
 */
export default function PianoRoll({ track }: { track: TrackType }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<QuantizeGrid>("1/16");
  const [resizing, setResizing] = useState<{ noteId: string; startX: number; startDuration: number } | null>(null);

  const addMidiNote = useDAWStore((s) => s.addMidiNote);
  const removeMidiNote = useDAWStore((s) => s.removeMidiNote);
  const updateMidiNote = useDAWStore((s) => s.updateMidiNote);
  const clearMidiNotes = useDAWStore((s) => s.clearMidiNotes);
  const quantizeNotes = useDAWStore((s) => s.quantizeNotes);
  const setInstrument = useDAWStore((s) => s.setInstrument);
  const setInstrumentEngine = useDAWStore((s) => s.setInstrumentEngine);
  const setWavetablePosition = useDAWStore((s) => s.setWavetablePosition);
  const setGranularSettings = useDAWStore((s) => s.setGranularSettings);
  const loadGranularSample = useDAWStore((s) => s.loadGranularSample);
  const setArpeggiator = useDAWStore((s) => s.setArpeggiator);
  const bpm = useDAWStore((s) => s.bpm);
  const retroCaptureEnabled = useDAWStore((s) => s.retroCaptureEnabled);
  const retroCaptureWindowSeconds = useDAWStore((s) => s.retroCaptureWindowSeconds);
  const setRetroCaptureEnabled = useDAWStore((s) => s.setRetroCaptureEnabled);
  const setRetroCaptureWindowSeconds = useDAWStore((s) => s.setRetroCaptureWindowSeconds);
  const captureRetrospectiveTake = useDAWStore((s) => s.captureRetrospectiveTake);

  // Live status for the Retrospective Recording indicator (MIDI device
  // connected? how many note-events are currently buffered?) — subscribes
  // directly to the capture module rather than the store, since it changes
  // on every note on/off regardless of whether the transport is running.
  const [retroStatus, setRetroStatus] = useState(midiCapture.getStatus());
  useEffect(() => {
    const unsub = midiCapture.onChange(() => setRetroStatus(midiCapture.getStatus()));
    return unsub;
  }, []);

  // Scale Highlighting & Snapping (project-wide — shared by every MIDI track).
  const scaleRoot = useDAWStore((s) => s.scaleRoot);
  const scaleType = useDAWStore((s) => s.scaleType);
  const scaleSnapEnabled = useDAWStore((s) => s.scaleSnapEnabled);
  const setScale = useDAWStore((s) => s.setScale);
  const toggleScaleSnap = useDAWStore((s) => s.toggleScaleSnap);

  // Groove Extraction
  const grooveTemplate = useDAWStore((s) => s.grooveTemplate);
  const grooveSourceTrackId = useDAWStore((s) => s.grooveSourceTrackId);
  const extractGrooveFromTrack = useDAWStore((s) => s.extractGrooveFromTrack);
  const applyGrooveToTrack = useDAWStore((s) => s.applyGrooveToTrack);
  const [grooveAmount, setGrooveAmount] = useState(1);

  // MIDI Humanize
  const humanizeNotes = useDAWStore((s) => s.humanizeNotes);
  const [humanizeTimingMs, setHumanizeTimingMs] = useState(15);
  const [humanizeVelocity, setHumanizeVelocity] = useState(0.15);

  const pitches = useMemo(() => {
    const list: number[] = [];
    for (let p = HIGH_PITCH; p >= LOW_PITCH; p--) list.push(p);
    return list;
  }, []);

  const gridStepSeconds = useMemo(() => {
    // Mirrors quantizeMidiNotes' step-size math, just for drawing guide lines.
    const quarter = 60 / Math.max(1, bpm);
    const map: Record<QuantizeGrid, number> = {
      "1/4": quarter,
      "1/8": quarter / 2,
      "1/16": quarter / 4,
      "1/8t": quarter / 3,
      "1/16t": quarter / 6,
    };
    return map[grid];
  }, [grid, bpm]);

  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>, pitch: number) => {
    if (resizing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const start = Math.max(0, x / PX_PER_SECOND);
    addMidiNote(track.id, pitch, start, DEFAULT_NOTE_SECONDS);
  };

  const handleResizeStart = (e: React.MouseEvent, noteId: string, currentDuration: number) => {
    e.stopPropagation();
    setResizing({ noteId, startX: e.clientX, startDuration: currentDuration });
    const onMove = (ev: MouseEvent) => {
      const deltaSeconds = (ev.clientX - e.clientX) / PX_PER_SECOND;
      const nextDuration = Math.max(0.05, currentDuration + deltaSeconds);
      updateMidiNote(track.id, noteId, { duration: nextDuration });
    };
    const onUp = () => {
      setResizing(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const totalWidth = VISIBLE_SECONDS * PX_PER_SECOND;
  const gridLineCount = Math.floor(VISIBLE_SECONDS / gridStepSeconds);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-void-700 bg-void-850 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-white/40">Engine</span>
          <select
            value={track.instrumentEngine}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setInstrumentEngine(track.id, e.target.value as InstrumentEngine)}
            className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-[11px] text-white/70 outline-none focus:border-neon-violet/50"
          >
            <option value="subtractive">Subtractive</option>
            <option value="wavetable">Wavetable</option>
            <option value="granular">Granular</option>
          </select>

          {track.instrumentEngine === "subtractive" && (
            <select
              value={track.instrument}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setInstrument(track.id, e.target.value as SynthWaveform)}
              className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-[11px] text-white/70 outline-none focus:border-neon-violet/50"
            >
              {WAVEFORM_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          )}

          {track.instrumentEngine === "wavetable" && (
            <label className="flex items-center gap-1 text-[10px] text-white/40">
              Position
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.wavetable.position}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setWavetablePosition(track.id, parseFloat(e.target.value))}
                className="w-20 accent-neon-violet"
              />
            </label>
          )}

          {track.instrumentEngine === "granular" && (
            <div className="flex items-center gap-1.5 text-[10px] text-white/40">
              <label className="cursor-pointer rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-white/60 hover:text-white">
                {track.granular.sampleUrl ? "Replace sample" : "Load sample"}
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) loadGranularSample(track.id, file);
                  }}
                />
              </label>
              <label className="flex items-center gap-1">
                Grain
                <input
                  type="range"
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  value={track.granular.grainSize}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setGranularSettings(track.id, (g) => ({ ...g, grainSize: parseFloat(e.target.value) }))}
                  className="w-14 accent-neon-violet"
                />
              </label>
              <label className="flex items-center gap-1">
                Spread
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={track.granular.spread}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setGranularSettings(track.id, (g) => ({ ...g, spread: parseFloat(e.target.value) }))}
                  className="w-14 accent-neon-violet"
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Grid3x3 size={12} className="text-white/40" />
          <select
            value={grid}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setGrid(e.target.value as QuantizeGrid)}
            className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-[11px] text-white/70 outline-none focus:border-neon-violet/50"
            title="Grid subdivision"
          >
            {GRID_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <button
            onClick={(e) => {
              e.stopPropagation();
              quantizeNotes(track.id, grid);
            }}
            className="rounded border border-void-600 bg-void-900 px-2 py-0.5 text-[11px] font-semibold text-neon-violet transition hover:border-neon-violet/50"
            title="Snap every note's start time to the grid"
          >
            Quantize
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearMidiNotes(track.id);
            }}
            className="rounded p-1 text-white/40 transition hover:text-neon-red"
            title="Clear all notes"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px]" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setArpeggiator(track.id, (a) => ({ ...a, enabled: !a.enabled }))}
          className={clsx(
            "rounded border px-2 py-0.5 font-semibold uppercase tracking-wider transition",
            track.arpeggiator.enabled
              ? "border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan"
              : "border-void-600 bg-void-900 text-white/40 hover:text-white/70"
          )}
          title="Arpeggiator: turns held chords into a stepped pattern"
        >
          Arp
        </button>
        {track.arpeggiator.enabled && (
          <>
            <select
              value={track.arpeggiator.pattern}
              onChange={(e) => setArpeggiator(track.id, (a) => ({ ...a, pattern: e.target.value as any }))}
              className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-white/70 outline-none"
            >
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="updown">Up/Down</option>
              <option value="asPlayed">As played</option>
              <option value="random">Random</option>
            </select>
            <select
              value={track.arpeggiator.rate}
              onChange={(e) => setArpeggiator(track.id, (a) => ({ ...a, rate: e.target.value as any }))}
              className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-white/70 outline-none"
            >
              <option value="1/4">1/4</option>
              <option value="1/8">1/8</option>
              <option value="1/16">1/16</option>
              <option value="1/8t">1/8t</option>
              <option value="1/16t">1/16t</option>
            </select>
            <label className="flex items-center gap-1 text-white/40">
              Octaves
              <input
                type="number"
                min={1}
                max={4}
                value={track.arpeggiator.octaves}
                onChange={(e) => setArpeggiator(track.id, (a) => ({ ...a, octaves: parseInt(e.target.value) || 1 }))}
                className="w-10 rounded border border-void-600 bg-void-900 px-1 py-0.5 text-white/70"
              />
            </label>
            <label className="flex items-center gap-1 text-white/40">
              Gate
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={track.arpeggiator.gate}
                onChange={(e) => setArpeggiator(track.id, (a) => ({ ...a, gate: parseFloat(e.target.value) }))}
                className="w-16 accent-neon-cyan"
              />
            </label>
          </>
        )}
      </div>

      {/* Retrospective Recording: keeps listening for MIDI/keyboard input
          in the background (no armed Record needed) and lets you drop
          whatever you just played onto this track's timeline after the
          fact — see lib/midiInput.ts. */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setRetroCaptureEnabled(!retroCaptureEnabled)}
          className={clsx(
            "flex items-center gap-1 rounded border px-2 py-0.5 font-semibold uppercase tracking-wider transition",
            retroCaptureEnabled
              ? "border-neon-pink/50 bg-neon-pink/15 text-neon-pink"
              : "border-void-600 bg-void-900 text-white/40 hover:text-white/70"
          )}
          title="Retrospective Recording: buffers MIDI/keyboard input continuously, whether or not you're recording"
        >
          <Mic size={11} className={retroCaptureEnabled ? "animate-pulse" : ""} />
          {retroCaptureEnabled ? "Listening…" : "Capture MIDI"}
        </button>
        {retroCaptureEnabled && (
          <>
            <label className="flex items-center gap-1 text-white/40">
              Last
              <select
                value={retroCaptureWindowSeconds}
                onChange={(e) => setRetroCaptureWindowSeconds(parseInt(e.target.value))}
                className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-white/70 outline-none"
              >
                {[5, 10, 15, 30, 60, 120].map((s) => (
                  <option key={s} value={s}>{s}s</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => captureRetrospectiveTake(track.id)}
              className="rounded border border-void-600 bg-void-900 px-2 py-0.5 font-semibold text-neon-pink transition hover:border-neon-pink/50 disabled:cursor-not-allowed disabled:opacity-30"
              disabled={retroStatus.bufferedNoteCount === 0}
              title="Drop the buffered notes onto this track's timeline, ending at the current playhead"
            >
              Capture last {retroCaptureWindowSeconds}s
            </button>
            <span className="text-white/30">
              {retroStatus.midiSupported
                ? retroStatus.midiInputsConnected > 0
                  ? `${retroStatus.midiInputsConnected} MIDI device(s)`
                  : "No MIDI device — using computer keyboard (A–L row)"
                : "Web MIDI unsupported — using computer keyboard (A–L row)"}
            </span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-void-800 pt-2 text-[10px]" onClick={(e) => e.stopPropagation()}>
        {/* Scale Highlighting & Snapping */}
        <span className="text-white/40">Scale</span>
        <select
          value={scaleRoot}
          onChange={(e) => setScale(parseInt(e.target.value), scaleType)}
          className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-white/70 outline-none"
          title="Scale root note"
        >
          {SCALE_ROOT_NAMES.map((name, i) => (
            <option key={name} value={i}>{name}</option>
          ))}
        </select>
        <select
          value={scaleType}
          onChange={(e) => setScale(scaleRoot, e.target.value as ScaleType)}
          className="rounded border border-void-600 bg-void-900 px-1.5 py-0.5 text-white/70 outline-none"
          title="Scale type"
        >
          {SCALE_TYPE_OPTIONS.map((s) => (
            <option key={s} value={s}>{SCALE_LABELS[s]}</option>
          ))}
        </select>
        <button
          onClick={toggleScaleSnap}
          className={clsx(
            "rounded border px-2 py-0.5 font-semibold uppercase tracking-wider transition",
            scaleSnapEnabled
              ? "border-neon-amber/50 bg-neon-amber/15 text-neon-amber"
              : "border-void-600 bg-void-900 text-white/40 hover:text-white/70"
          )}
          title="Snap new notes to the nearest scale pitch"
        >
          Snap
        </button>

        <div className="mx-1 h-4 w-px shrink-0 bg-void-700" />

        {/* Groove Extraction */}
        <button
          onClick={() => extractGrooveFromTrack(track.id, grid)}
          className="flex items-center gap-1 rounded border border-void-600 bg-void-900 px-2 py-0.5 text-white/60 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
          title="Extract this track's timing/velocity feel relative to the current grid"
        >
          <Wand2 size={11} /> Extract Groove
        </button>
        <button
          disabled={!grooveTemplate}
          onClick={() => applyGrooveToTrack(track.id, grid, grooveAmount)}
          className="rounded border border-void-600 bg-void-900 px-2 py-0.5 text-white/60 transition hover:border-neon-cyan/50 hover:text-neon-cyan disabled:cursor-not-allowed disabled:opacity-30"
          title={grooveSourceTrackId ? `Apply the groove extracted from that track to this one` : "Extract a groove first"}
        >
          Apply Groove
        </button>
        <label className="flex items-center gap-1 text-white/40">
          Amt
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={grooveAmount}
            onChange={(e) => setGrooveAmount(parseFloat(e.target.value))}
            className="w-14 accent-neon-cyan"
          />
        </label>

        <div className="mx-1 h-4 w-px shrink-0 bg-void-700" />

        {/* MIDI Humanize */}
        <button
          onClick={() => humanizeNotes(track.id, humanizeTimingMs, humanizeVelocity)}
          className="flex items-center gap-1 rounded border border-void-600 bg-void-900 px-2 py-0.5 text-white/60 transition hover:border-neon-pink/50 hover:text-neon-pink"
          title="Randomize timing and velocity slightly so the part feels played, not programmed"
        >
          <Sparkles size={11} /> Humanize
        </button>
        <label className="flex items-center gap-1 text-white/40">
          Timing
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={humanizeTimingMs}
            onChange={(e) => setHumanizeTimingMs(parseInt(e.target.value))}
            className="w-14 accent-neon-pink"
          />
          {humanizeTimingMs}ms
        </label>
        <label className="flex items-center gap-1 text-white/40">
          Vel
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={humanizeVelocity}
            onChange={(e) => setHumanizeVelocity(parseFloat(e.target.value))}
            className="w-14 accent-neon-pink"
          />
        </label>
      </div>

      <div className="flex h-56 overflow-auto rounded border border-void-700 bg-void-950" onClick={(e) => e.stopPropagation()}>
        {/* Piano keys column */}
        <div className="sticky left-0 z-10 shrink-0 bg-void-900">
          {pitches.map((p) => {
            const name = midiToNoteName(p);
            const isSharp = name.includes("#");
            const inScale = isPitchInScale(p, scaleRoot, scaleType);
            return (
              <div
                key={p}
                style={{ height: ROW_HEIGHT }}
                className={clsx(
                  "flex w-12 items-center justify-end border-b border-void-800 pr-1.5 text-[9px]",
                  isSharp ? "bg-void-950 text-white/30" : "bg-void-900 text-white/50",
                  inScale && "text-neon-amber/80"
                )}
              >
                {name}
              </div>
            );
          })}
        </div>

        {/* Note grid */}
        <div ref={gridRef} className="relative" style={{ width: totalWidth }}>
          {/* Grid guide lines at the current subdivision */}
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: gridLineCount }).map((_, i) => (
              <div
                key={i}
                className={clsx(
                  "absolute top-0 bottom-0 w-px",
                  i % 4 === 0 ? "bg-white/10" : "bg-white/5"
                )}
                style={{ left: i * gridStepSeconds * PX_PER_SECOND }}
              />
            ))}
          </div>

          {pitches.map((p) => {
            const inScale = isPitchInScale(p, scaleRoot, scaleType);
            return (
              <div
                key={p}
                onClick={(e) => handleGridClick(e, p)}
                style={{ height: ROW_HEIGHT }}
                className={clsx(
                  "border-b border-void-800/60",
                  p % 12 === 0 && "bg-white/[0.03]",
                  inScale ? "bg-neon-amber/[0.05]" : "bg-black/10"
                )}
              />
            );
          })}

          {track.notes.map((n) => {
            const rowIndex = pitches.indexOf(n.pitch);
            if (rowIndex === -1) return null;
            return (
              <div
                key={n.id}
                onClick={(e) => {
                  e.stopPropagation();
                  removeMidiNote(track.id, n.id);
                }}
                style={{
                  position: "absolute",
                  top: rowIndex * ROW_HEIGHT + 1,
                  left: n.start * PX_PER_SECOND,
                  width: Math.max(4, n.duration * PX_PER_SECOND),
                  height: ROW_HEIGHT - 2,
                  backgroundColor: track.color,
                  opacity: 0.4 + n.velocity * 0.5,
                }}
                className="cursor-pointer rounded-sm"
                title={`${midiToNoteName(n.pitch)} · ${n.duration.toFixed(2)}s · click to delete`}
              >
                <div
                  onMouseDown={(e) => handleResizeStart(e, n.id, n.duration)}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/30"
                />
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[9px] text-white/25">
        Click the grid to add a note, click a note to delete it, drag a note&apos;s right edge to resize. Quantize
        snaps every note&apos;s start time to the selected grid at the current BPM. Scale rows are tinted amber;
        Snap pulls new notes to the nearest scale pitch. Extract Groove captures this track&apos;s timing/velocity
        feel to re-apply elsewhere; Humanize randomizes timing/velocity so a programmed part feels played.
      </p>
    </div>
  );
}
