"use client";

import { useState } from "react";
import { Music4, Gauge, Plus, X } from "lucide-react";
import clsx from "clsx";
import { useDAWStore } from "@/store/useDAWStore";
import { ChordQuality, CHORD_QUALITY_LABELS } from "@/lib/audioEngine";

const CHORD_ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHORD_QUALITIES = Object.keys(CHORD_QUALITY_LABELS) as ChordQuality[];

function formatShort(t: number) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

/** Numeric time field: shows the value but only commits on blur/Enter, so
 *  the user can freely retype without fighting a live re-render. Mirrors
 *  WorkflowBar's TimeField (kept local here to avoid a cross-import). */
function TimeField({ value, onCommit, title }: { value: number; onCommit: (v: number) => void; title?: string }) {
  const [text, setText] = useState(value.toFixed(2));
  return (
    <input
      value={text}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setText(value.toFixed(2))}
      onBlur={() => {
        const n = parseFloat(text);
        if (!Number.isNaN(n)) onCommit(Math.max(0, n));
        else setText(value.toFixed(2));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-14 rounded border border-void-700 bg-void-850 px-1 py-0.5 text-center font-mono text-[10px] text-white/70 outline-none focus:border-neon-cyan/50"
    />
  );
}

/** Chord Track + Tempo Track / Time Signature Map — both are reference
 *  lanes read against the timeline rather than full visual tracks (same
 *  compact-list spirit as the Markers lane in WorkflowBar), so they slot in
 *  as one more bar rather than needing a whole new track-lane renderer. */
export default function ChordTempoBar() {
  const currentTime = useDAWStore((s) => s.currentTime);
  const seekPlayhead = useDAWStore((s) => s.seekPlayhead);

  const chordTrack = useDAWStore((s) => s.chordTrack);
  const addChordEvent = useDAWStore((s) => s.addChordEvent);
  const updateChordEvent = useDAWStore((s) => s.updateChordEvent);
  const removeChordEvent = useDAWStore((s) => s.removeChordEvent);

  const tempoEvents = useDAWStore((s) => s.tempoEvents);
  const bpm = useDAWStore((s) => s.bpm);
  const addTempoEvent = useDAWStore((s) => s.addTempoEvent);
  const updateTempoEvent = useDAWStore((s) => s.updateTempoEvent);
  const removeTempoEvent = useDAWStore((s) => s.removeTempoEvent);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-void-700 bg-void-900/60 px-4 py-2 text-[10px]">
      {/* Chord Track */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => addChordEvent(currentTime)}
          className="flex items-center gap-1 rounded border border-void-600 bg-void-850 px-2 py-1 text-white/60 transition hover:border-neon-violet/50 hover:text-neon-violet"
          title="Mark a chord at the playhead"
        >
          <Music4 size={12} /> Chord
        </button>
        <div className="flex max-w-[420px] flex-wrap items-center gap-1 overflow-x-auto">
          {chordTrack.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-1 rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-white/50"
            >
              <button onClick={() => seekPlayhead(c.time)} className="font-mono text-neon-violet/80 transition hover:text-neon-violet" title="Jump here">
                {formatShort(c.time)}
              </button>
              <select
                value={c.root}
                onChange={(e) => updateChordEvent(c.id, { root: parseInt(e.target.value) })}
                className="rounded bg-void-900 px-1 py-0.5 text-white/70 outline-none"
                title="Root"
              >
                {CHORD_ROOT_NAMES.map((name, i) => (
                  <option key={name} value={i}>{name}</option>
                ))}
              </select>
              <select
                value={c.quality}
                onChange={(e) => updateChordEvent(c.id, { quality: e.target.value as ChordQuality })}
                className="rounded bg-void-900 px-1 py-0.5 text-white/70 outline-none"
                title="Quality"
              >
                {CHORD_QUALITIES.map((q) => (
                  <option key={q} value={q}>{q === "maj" ? "maj" : CHORD_QUALITY_LABELS[q]}</option>
                ))}
              </select>
              <button onClick={() => removeChordEvent(c.id)} className="text-white/25 transition hover:text-neon-red">
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="h-5 w-px shrink-0 bg-void-700" />

      {/* Tempo Track / Time Signature Map */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => addTempoEvent(currentTime, bpm, 4, 4)}
          className="flex items-center gap-1 rounded border border-void-600 bg-void-850 px-2 py-1 text-white/60 transition hover:border-neon-amber/50 hover:text-neon-amber"
          title="Add a tempo/time-signature change at the playhead"
        >
          <Gauge size={12} /> Tempo Change
        </button>
        <div className="flex max-w-[480px] flex-wrap items-center gap-1 overflow-x-auto">
          {tempoEvents.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center gap-1 rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-white/50"
            >
              <button onClick={() => seekPlayhead(ev.time)} className="font-mono text-neon-amber/80 transition hover:text-neon-amber" title="Jump here">
                {formatShort(ev.time)}
              </button>
              <input
                type="number"
                min={40}
                max={300}
                value={ev.bpm}
                onChange={(e) => updateTempoEvent(ev.id, { bpm: Number(e.target.value) || ev.bpm })}
                className="w-11 rounded bg-void-900 px-1 py-0.5 text-center font-mono text-white/70 outline-none"
                title="BPM from this point"
              />
              <input
                type="number"
                min={1}
                max={32}
                value={ev.numerator}
                onChange={(e) => updateTempoEvent(ev.id, { numerator: Number(e.target.value) || ev.numerator })}
                className="w-7 rounded bg-void-900 px-1 py-0.5 text-center font-mono text-white/70 outline-none"
                title="Time signature numerator"
              />
              <span className="text-white/25">/</span>
              <select
                value={ev.denominator}
                onChange={(e) => updateTempoEvent(ev.id, { denominator: Number(e.target.value) })}
                className="rounded bg-void-900 px-1 py-0.5 text-white/70 outline-none"
                title="Time signature denominator"
              >
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={8}>8</option>
                <option value={16}>16</option>
              </select>
              <button onClick={() => removeTempoEvent(ev.id)} className="text-white/25 transition hover:text-neon-red">
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
