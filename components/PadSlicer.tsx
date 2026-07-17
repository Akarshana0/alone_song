"use client";

import { useEffect, useRef, useState } from "react";
import * as ToneImport from "tone";
const Tone: any = (ToneImport as any).default ?? ToneImport;
import { Grid2x2, Play, ArrowUpRight } from "lucide-react";
import { Track as TrackType, useDAWStore } from "@/store/useDAWStore";
import { urlToAudioBuffer } from "@/lib/audioEngine";
import { sliceIntoPads } from "@/lib/audioEditing";

const PAD_COUNTS = [4, 8, 16] as const;
const PAD_KEYS = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"];

/**
 * MPC-style sample pad slicer: divides the track's audio into equal-length
 * slices and lays them out as tappable/keyboard-triggerable pads, with a
 * one-click "send to new track" per pad so any slice can be rearranged,
 * re-pitched, or re-sequenced independently on its own track. Preview
 * playback is a one-shot Tone.Player per pad-press — it doesn't touch the
 * track's own Player/effects chain, so auditioning slices here won't
 * interfere with normal playback.
 */
export default function PadSlicer({ track }: { track: TrackType }) {
  const [count, setCount] = useState<(typeof PAD_COUNTS)[number]>(16);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [activePad, setActivePad] = useState<number | null>(null);
  const sendSliceToNewTrack = useDAWStore((s) => s.sendSliceToNewTrack);
  const previewPlayerRef = useRef<ToneImport.Player | null>(null);

  useEffect(() => {
    if (!track.fileUrl) return;
    let cancelled = false;
    urlToAudioBuffer(track.fileUrl).then((b) => {
      if (!cancelled) setBuffer(b);
    });
    return () => {
      cancelled = true;
    };
  }, [track.fileUrl]);

  useEffect(() => {
    return () => {
      previewPlayerRef.current?.dispose();
    };
  }, []);

  const pads = buffer ? sliceIntoPads(buffer, count) : [];

  const playPad = async (index: number) => {
    if (!buffer || !pads[index]) return;
    await Tone.start();
    previewPlayerRef.current?.dispose();
    const player = new Tone.Player(buffer).toDestination();
    player.onstop = () => player.dispose();
    const { start, end } = pads[index];
    player.start(undefined, start, Math.max(0.02, end - start));
    previewPlayerRef.current = player;
    setActivePad(index);
    setTimeout(() => setActivePad((p) => (p === index ? null : p)), 150);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = PAD_KEYS.indexOf(e.key.toLowerCase());
      if (idx >= 0 && idx < pads.length) playPad(idx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pads.length, buffer]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-void-700 bg-void-850 p-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
          <Grid2x2 size={12} />
          Sample Slicing (MPC pads)
        </div>
        <div className="flex gap-1">
          {PAD_COUNTS.map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold transition ${
                count === n ? "bg-neon-amber/20 text-neon-amber" : "bg-void-800 text-white/40 hover:text-white/70"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {!buffer && <div className="py-2 text-center text-[10px] text-white/30">Loading buffer…</div>}

      {buffer && (
        <div className={`grid gap-1.5 ${count === 4 ? "grid-cols-2" : "grid-cols-4"}`}>
          {pads.map((pad, i) => (
            <div
              key={i}
              className={`group relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded border transition ${
                activePad === i ? "border-neon-amber bg-neon-amber/20" : "border-void-700 bg-void-800 hover:border-white/20"
              }`}
            >
              <button onClick={() => playPad(i)} className="flex flex-1 flex-col items-center justify-center gap-0.5 w-full">
                <Play size={11} className="text-white/50" />
                <span className="text-[9px] text-white/40">{PAD_KEYS[i]?.toUpperCase()}</span>
              </button>
              <button
                onClick={() => sendSliceToNewTrack(track.id, i, count)}
                title="Send slice to a new track"
                className="absolute right-0.5 top-0.5 rounded bg-void-900/80 p-0.5 text-white/30 opacity-0 transition group-hover:opacity-100 hover:text-neon-cyan"
              >
                <ArrowUpRight size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[9px] text-white/30">
        Click a pad or press its key to preview a slice. The arrow icon bounces that slice out to its own track.
      </p>
    </div>
  );
}
