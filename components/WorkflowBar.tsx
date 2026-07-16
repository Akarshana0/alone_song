"use client";

import { useState } from "react";
import { MapPin, Repeat, Scissors as PunchIcon, X, Users, VolumeX, Headphones, Magnet, MoveHorizontal, Waves } from "lucide-react";
import clsx from "clsx";
import { useDAWStore } from "@/store/useDAWStore";

function formatShort(t: number) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

/** Numeric time field: shows the value but only commits on blur/Enter, so
 *  the user can freely retype without fighting a live re-render. */
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

/** Workflow: the single home for all timeline/session-level controls —
 *  Markers, Loop Comping (region), Punch-in/out (region), Snapping, and
 *  Track Grouping (group-level mute/solo), plus a quick cluster for the
 *  per-track Nudge / Input Monitoring / Sidechaining controls (whose full
 *  controls also live on the track header and FX rack) so every Workflow
 *  feature is visible and reachable from one bar. */
export default function WorkflowBar() {
  const markers = useDAWStore((s) => s.markers);
  const currentTime = useDAWStore((s) => s.currentTime);
  const addMarker = useDAWStore((s) => s.addMarker);
  const removeMarker = useDAWStore((s) => s.removeMarker);
  const seekPlayhead = useDAWStore((s) => s.seekPlayhead);

  const loopEnabled = useDAWStore((s) => s.loopEnabled);
  const loopStart = useDAWStore((s) => s.loopStart);
  const loopEnd = useDAWStore((s) => s.loopEnd);
  const toggleLoop = useDAWStore((s) => s.toggleLoop);
  const setLoopRegion = useDAWStore((s) => s.setLoopRegion);
  const setLoopFromSelection = useDAWStore((s) => s.setLoopFromSelection);

  const punchEnabled = useDAWStore((s) => s.punchEnabled);
  const punchIn = useDAWStore((s) => s.punchIn);
  const punchOut = useDAWStore((s) => s.punchOut);
  const togglePunch = useDAWStore((s) => s.togglePunch);
  const setPunchRegion = useDAWStore((s) => s.setPunchRegion);
  const setPunchFromSelection = useDAWStore((s) => s.setPunchFromSelection);

  const selection = useDAWStore((s) => s.selection);
  const tracks = useDAWStore((s) => s.tracks);
  const armedTrack = tracks.find((t) => t.armed);

  const groups = useDAWStore((s) => s.groups);
  const toggleGroupMute = useDAWStore((s) => s.toggleGroupMute);
  const toggleGroupSolo = useDAWStore((s) => s.toggleGroupSolo);
  const removeGroup = useDAWStore((s) => s.removeGroup);

  // --- Selected-track quick cluster: Snap / Nudge / Monitor / Sidechain.
  // These already live at their "natural" home (EditToolbar, per-track
  // header, FXRack) — this cluster just mirrors quick controls for
  // whichever track is selected so the whole Workflow set is glanceable
  // and reachable from one bar, without duplicating the underlying logic.
  const snapEnabled = useDAWStore((s) => s.snapEnabled);
  const snapGrid = useDAWStore((s) => s.snapGrid);
  const toggleSnap = useDAWStore((s) => s.toggleSnap);
  const setSnapGrid = useDAWStore((s) => s.setSnapGrid);
  const nudgeTrack = useDAWStore((s) => s.nudgeTrack);
  const toggleMonitor = useDAWStore((s) => s.toggleMonitor);
  const updateTrackEffects = useDAWStore((s) => s.updateTrackEffects);
  const selectedTrackId = useDAWStore((s) => s.selectedTrackId);
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? armedTrack ?? tracks[0];
  const sidechainSources = tracks.filter((t) => t.id !== selectedTrack?.id);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-void-700 bg-void-900/60 px-4 py-2 text-[10px]">
      {/* Markers */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => addMarker(currentTime)}
          className="flex items-center gap-1 rounded border border-void-600 bg-void-850 px-2 py-1 text-white/60 transition hover:border-neon-amber/50 hover:text-neon-amber"
          title="Drop a marker at the playhead"
        >
          <MapPin size={12} /> Marker
        </button>
        <div className="flex max-w-[280px] flex-wrap items-center gap-1 overflow-x-auto">
          {markers.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-1 rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-white/50"
            >
              <button onClick={() => seekPlayhead(m.time)} className="font-mono transition hover:text-neon-amber" title="Jump here">
                {m.label} {formatShort(m.time)}
              </button>
              <button onClick={() => removeMarker(m.id)} className="text-white/25 transition hover:text-neon-red">
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="h-5 w-px shrink-0 bg-void-700" />

      {/* Loop region (Loop Comping) */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={toggleLoop}
          className={clsx(
            "flex items-center gap-1 rounded border px-2 py-1 transition",
            loopEnabled ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan" : "border-void-600 bg-void-850 text-white/60 hover:text-white"
          )}
          title="Arm Loop Comping — Record will loop this region, building a take per pass"
        >
          <Repeat size={12} /> Loop
        </button>
        <TimeField value={loopStart} onCommit={(v) => setLoopRegion(v, loopEnd)} title="Loop start (s)" />
        <span className="text-white/25">–</span>
        <TimeField value={loopEnd} onCommit={(v) => setLoopRegion(loopStart, v)} title="Loop end (s)" />
        <button
          disabled={!selection}
          onClick={setLoopFromSelection}
          className="rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-white/50 transition hover:text-neon-cyan disabled:cursor-not-allowed disabled:opacity-30"
          title="Set loop region from the current waveform selection"
        >
          From sel.
        </button>
      </div>

      <div className="h-5 w-px shrink-0 bg-void-700" />

      {/* Punch region */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={togglePunch}
          className={clsx(
            "flex items-center gap-1 rounded border px-2 py-1 transition",
            punchEnabled ? "border-neon-red/50 bg-neon-red/10 text-neon-red" : "border-void-600 bg-void-850 text-white/60 hover:text-white"
          )}
          title="Arm Punch-in/out — Record will only capture inside this range, splicing it into the armed track"
        >
          <PunchIcon size={12} /> Punch
        </button>
        <TimeField value={punchIn} onCommit={(v) => setPunchRegion(v, punchOut)} title="Punch-in (s)" />
        <span className="text-white/25">–</span>
        <TimeField value={punchOut} onCommit={(v) => setPunchRegion(punchIn, v)} title="Punch-out (s)" />
        <button
          disabled={!selection}
          onClick={setPunchFromSelection}
          className="rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-white/50 transition hover:text-neon-red disabled:cursor-not-allowed disabled:opacity-30"
          title="Set punch region from the current waveform selection"
        >
          From sel.
        </button>
        {(loopEnabled || punchEnabled) && (
          <span className="text-white/30">
            → {armedTrack ? armedTrack.name : "no track armed"}
          </span>
        )}
      </div>

      <div className="h-5 w-px shrink-0 bg-void-700" />

      {/* Snap / Nudge / Monitor / Sidechain — quick access for the selected
          track, so the whole Workflow set is reachable from this one bar. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {/* Snapping */}
        <button
          onClick={toggleSnap}
          className={clsx(
            "flex items-center gap-1 rounded border px-2 py-1 transition",
            snapEnabled ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan" : "border-void-600 bg-void-850 text-white/60 hover:text-white"
          )}
          title="Snap markers, loop/punch points, and selections to the grid"
        >
          <Magnet size={12} /> Snap
        </button>
        <select
          value={snapGrid}
          onChange={(e) => setSnapGrid(e.target.value as "bar" | "beat" | "half-beat")}
          disabled={!snapEnabled}
          className="rounded border border-void-600 bg-void-850 px-1.5 py-1 text-[10px] text-white/70 disabled:opacity-40"
          title="Snap grid"
        >
          <option value="bar">Bar</option>
          <option value="beat">Beat</option>
          <option value="half-beat">1/2 Beat</option>
        </select>

        {selectedTrack && (
          <>
            <span className="mx-0.5 max-w-[90px] truncate text-white/30" title={selectedTrack.name}>
              {selectedTrack.name}
            </span>

            {/* Nudge */}
            <div className="flex items-center gap-1 rounded border border-void-600 bg-void-850 px-1.5 py-1" title="Nudge — shift this track's playback earlier/later">
              <MoveHorizontal size={12} className="text-white/40" />
              <button
                onClick={() => nudgeTrack(selectedTrack.id, -1)}
                className="px-1 text-white/60 transition hover:text-neon-cyan"
                title="Nudge earlier"
              >
                –
              </button>
              <span className="min-w-[52px] text-center font-mono text-[10px] text-white/60">
                {selectedTrack.nudge === 0 ? "0.000s" : `${selectedTrack.nudge > 0 ? "+" : ""}${selectedTrack.nudge.toFixed(3)}s`}
              </span>
              <button
                onClick={() => nudgeTrack(selectedTrack.id, 1)}
                className="px-1 text-white/60 transition hover:text-neon-cyan"
                title="Nudge later"
              >
                +
              </button>
            </div>

            {/* Input Monitoring */}
            <button
              onClick={() => toggleMonitor(selectedTrack.id)}
              className={clsx(
                "flex items-center gap-1 rounded border px-2 py-1 transition",
                selectedTrack.monitorEnabled
                  ? "border-neon-amber/50 bg-neon-amber/10 text-neon-amber"
                  : "border-void-600 bg-void-850 text-white/60 hover:text-white"
              )}
              title="Input Monitoring — hear the live mic while this track is armed"
            >
              <Headphones size={12} /> Monitor
            </button>

            {/* Sidechaining */}
            <div
              className={clsx(
                "flex items-center gap-1.5 rounded border px-2 py-1",
                selectedTrack.effects.sidechain.enabled
                  ? "border-neon-violet/50 bg-neon-violet/10"
                  : "border-void-600 bg-void-850"
              )}
            >
              <button
                onClick={() =>
                  updateTrackEffects(selectedTrack.id, (fx) => ({
                    ...fx,
                    sidechain: { ...fx.sidechain, enabled: !fx.sidechain.enabled },
                  }))
                }
                className={clsx(
                  "flex items-center gap-1 transition",
                  selectedTrack.effects.sidechain.enabled ? "text-neon-violet" : "text-white/60 hover:text-white"
                )}
                title="Sidechaining — duck this track's gain off another track's level"
              >
                <Waves size={12} /> Sidechain
              </button>
              <select
                value={selectedTrack.effects.sidechain.sourceTrackId ?? ""}
                onChange={(e) =>
                  updateTrackEffects(selectedTrack.id, (fx) => ({
                    ...fx,
                    sidechain: { ...fx.sidechain, sourceTrackId: e.target.value || null },
                  }))
                }
                disabled={sidechainSources.length === 0}
                className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70 disabled:opacity-40"
                title="Duck from…"
              >
                <option value="">Duck from…</option>
                {sidechainSources.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Track groups (mute/solo the whole group at once) */}
      {groups.length > 0 && (
        <>
          <div className="h-5 w-px shrink-0 bg-void-700" />
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Users size={12} className="text-white/40" />
            {groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-1 rounded border px-1.5 py-0.5"
                style={{ borderColor: `${g.color}55`, color: g.color }}
              >
                <span className="font-medium">{g.name}</span>
                <button onClick={() => toggleGroupMute(g.id)} title="Mute/unmute group" className="opacity-70 hover:opacity-100">
                  <VolumeX size={11} />
                </button>
                <button onClick={() => toggleGroupSolo(g.id)} title="Solo/unsolo group" className="opacity-70 hover:opacity-100">
                  <Headphones size={11} />
                </button>
                <button onClick={() => removeGroup(g.id)} title="Delete group" className="text-white/30 hover:text-neon-red">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
