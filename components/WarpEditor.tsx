"use client";

import { useState } from "react";
import { Waves, Plus, Trash2, Play } from "lucide-react";
import { Track as TrackType, useDAWStore } from "@/store/useDAWStore";

/**
 * Time Warping (elastic audio) editor. Unlike the existing Time Stretch
 * tool (one uniform rate across the whole clip, in OfflineToolBox), this
 * pins source-time <-> timeline-time pairs ("warp markers") and stretches
 * each in-between segment independently to fit — so a clip can be sped up
 * in one section and slowed down in another, e.g. to snap a loose recording
 * onto a click track section by section.
 *
 * This is a numeric list editor rather than drag-on-waveform markers —
 * a deliberate scope simplification, since dragging directly on the
 * waveform would need its own canvas/hit-testing layer on top of
 * WaveSurfer. Functionally it's the same warp-marker model either way.
 */
export default function WarpEditor({ track, duration }: { track: TrackType; duration: number }) {
  const [newSource, setNewSource] = useState(0);
  const [newTimeline, setNewTimeline] = useState(0);
  const seedWarpMarkers = useDAWStore((s) => s.seedWarpMarkers);
  const addWarpMarker = useDAWStore((s) => s.addWarpMarker);
  const updateWarpMarker = useDAWStore((s) => s.updateWarpMarker);
  const removeWarpMarker = useDAWStore((s) => s.removeWarpMarker);
  const applyTimeWarp = useDAWStore((s) => s.applyTimeWarp);

  const markers = [...track.warpMarkers].sort((a, b) => a.sourceTime - b.sourceTime);

  if (markers.length < 2) {
    return (
      <div className="rounded-md border border-void-700 bg-void-850 p-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
          <Waves size={12} />
          Time Warping (elastic audio)
        </div>
        <button
          onClick={() => seedWarpMarkers(track.id, duration)}
          className="rounded bg-neon-cyan/15 px-2 py-1 text-[10px] font-bold uppercase text-neon-cyan transition hover:bg-neon-cyan/25"
        >
          Add start/end markers
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-void-700 bg-void-850 p-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
        <Waves size={12} />
        Time Warping (elastic audio)
      </div>

      <div className="flex flex-col gap-1">
        {markers.map((m, i) => {
          const isEdge = i === 0 || i === markers.length - 1;
          return (
            <div key={m.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-3 text-white/30">{i + 1}</span>
              <label className="flex items-center gap-1 text-white/40">
                src
                <input
                  type="number"
                  step={0.01}
                  value={m.sourceTime.toFixed(2)}
                  onChange={(e) => updateWarpMarker(track.id, m.id, { sourceTime: parseFloat(e.target.value) || 0 })}
                  className="w-16 rounded bg-void-800 px-1 py-0.5 text-white/80"
                />
              </label>
              <label className="flex items-center gap-1 text-white/40">
                timeline
                <input
                  type="number"
                  step={0.01}
                  value={m.timelineTime.toFixed(2)}
                  onChange={(e) => updateWarpMarker(track.id, m.id, { timelineTime: parseFloat(e.target.value) || 0 })}
                  className="w-16 rounded bg-void-800 px-1 py-0.5 text-white/80"
                />
              </label>
              {!isEdge && (
                <button onClick={() => removeWarpMarker(track.id, m.id)} className="text-white/30 hover:text-neon-red">
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 border-t border-void-700 pt-2 text-[10px]">
        <label className="flex items-center gap-1 text-white/40">
          src
          <input
            type="number"
            step={0.01}
            value={newSource}
            onChange={(e) => setNewSource(parseFloat(e.target.value) || 0)}
            className="w-16 rounded bg-void-800 px-1 py-0.5 text-white/80"
          />
        </label>
        <label className="flex items-center gap-1 text-white/40">
          timeline
          <input
            type="number"
            step={0.01}
            value={newTimeline}
            onChange={(e) => setNewTimeline(parseFloat(e.target.value) || 0)}
            className="w-16 rounded bg-void-800 px-1 py-0.5 text-white/80"
          />
        </label>
        <button
          onClick={() => addWarpMarker(track.id, newSource, newTimeline)}
          className="flex items-center gap-0.5 rounded bg-void-800 px-1.5 py-0.5 text-white/60 hover:text-white"
        >
          <Plus size={11} /> Marker
        </button>
      </div>

      <button
        onClick={() => applyTimeWarp(track.id)}
        className="flex items-center justify-center gap-1 rounded bg-neon-cyan/15 px-2 py-1 text-[10px] font-bold uppercase text-neon-cyan transition hover:bg-neon-cyan/25"
      >
        <Play size={11} /> Apply Warp
      </button>
      <p className="text-[9px] text-white/30">
        Each marker pins a point in the source audio to a point on the timeline; the audio between markers stretches
        to fit. Applying re-renders the clip and resets markers to a fresh 1:1 pair.
      </p>
    </div>
  );
}
