"use client";

import { Plus, Trash2, Volume2, VolumeX, Headphones } from "lucide-react";
import { useDAWStore } from "@/store/useDAWStore";
import SpectrumAnalyzer from "./SpectrumAnalyzer";
import MeteringPanel from "./meters/MeteringPanel";

function ChannelStrip({
  name,
  color,
  volume,
  pan,
  onVolumeChange,
  onPanChange,
  muted,
  solo,
  onToggleMute,
  onToggleSolo,
  onDelete,
  onRename,
  routedCount,
}: {
  name: string;
  color: string;
  volume: number;
  pan: number;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  muted?: boolean;
  solo?: boolean;
  onToggleMute?: () => void;
  onToggleSolo?: () => void;
  onDelete?: () => void;
  onRename?: (name: string) => void;
  routedCount?: number;
}) {
  return (
    <div className="flex w-24 shrink-0 flex-col items-center gap-2 rounded-md border border-void-700 bg-void-850 p-3 shadow-panel">
      <div className="flex w-full items-center justify-between gap-1">
        {onRename ? (
          <input
            value={name}
            onChange={(e) => onRename(e.target.value)}
            className="w-full truncate bg-transparent text-center text-[11px] font-semibold outline-none"
            style={{ color }}
          />
        ) : (
          <span className="w-full truncate text-center text-[11px] font-semibold" style={{ color }}>
            {name}
          </span>
        )}
        {onDelete && (
          <button onClick={onDelete} className="shrink-0 text-white/30 transition hover:text-neon-red" title="Delete bus">
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {typeof routedCount === "number" && (
        <span className="text-[9px] text-white/30">{routedCount} track{routedCount === 1 ? "" : "s"}</span>
      )}

      {(onToggleMute || onToggleSolo) && (
        <div className="flex items-center gap-1">
          {onToggleMute && (
            <button
              onClick={onToggleMute}
              className={`rounded p-1 text-[10px] font-bold transition ${
                muted ? "bg-neon-red/20 text-neon-red" : "bg-void-800 text-white/50 hover:text-white"
              }`}
              title="Mute"
            >
              {muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
            </button>
          )}
          {onToggleSolo && (
            <button
              onClick={onToggleSolo}
              className={`rounded p-1 text-[10px] font-bold transition ${
                solo ? "bg-neon-amber/20 text-neon-amber" : "bg-void-800 text-white/50 hover:text-white"
              }`}
              title="Solo"
            >
              <Headphones size={11} />
            </button>
          )}
        </div>
      )}

      <div className="flex h-32 items-end justify-center gap-2">
        <div className="relative h-full w-2 rounded-full bg-void-700">
          <div
            className="absolute bottom-0 w-full rounded-full transition-all"
            style={{
              height: `${(Math.min(volume, 1.2) / 1.2) * 100}%`,
              background: `linear-gradient(to top, ${color}, transparent)`,
              opacity: muted ? 0.2 : 1,
            }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="fader h-32 [writing-mode:vertical-lr]"
          style={{ direction: "rtl" }}
        />
      </div>

      <span className="font-mono text-[10px] text-white/40">
        {Math.round((muted ? 0 : volume) * 100)}%
      </span>

      <div className="flex w-full flex-col items-center gap-1">
        <span className="text-[9px] uppercase tracking-wider text-white/30">Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={pan}
          onChange={(e) => onPanChange(Number(e.target.value))}
          className="pan-knob w-full"
        />
        <span className="font-mono text-[9px] text-white/30">
          {pan === 0 ? "C" : pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`}
        </span>
      </div>
    </div>
  );
}

export default function Mixer() {
  const tracks = useDAWStore((s) => s.tracks);
  const setTrackVolume = useDAWStore((s) => s.setTrackVolume);
  const setTrackPan = useDAWStore((s) => s.setTrackPan);
  const masterVolume = useDAWStore((s) => s.masterVolume);
  const setMasterVolume = useDAWStore((s) => s.setMasterVolume);

  const buses = useDAWStore((s) => s.buses);
  const addBus = useDAWStore((s) => s.addBus);
  const removeBus = useDAWStore((s) => s.removeBus);
  const renameBus = useDAWStore((s) => s.renameBus);
  const setBusVolume = useDAWStore((s) => s.setBusVolume);
  const setBusPan = useDAWStore((s) => s.setBusPan);
  const toggleBusMute = useDAWStore((s) => s.toggleBusMute);
  const toggleBusSolo = useDAWStore((s) => s.toggleBusSolo);

  return (
    <aside className="flex w-full shrink-0 flex-col border-l border-void-700 bg-void-900 md:w-72">
      <div className="border-b border-void-700 px-4 py-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">
          Mixer
        </h2>
      </div>

      <div className="flex flex-1 gap-3 overflow-x-auto p-3">
        {tracks.length === 0 ? (
          <p className="p-2 text-xs text-white/30">
            Channel strips appear here once you add tracks.
          </p>
        ) : (
          tracks.map((t) => (
            <ChannelStrip
              key={t.id}
              name={t.name}
              color={t.color}
              volume={t.volume}
              pan={t.pan}
              muted={t.muted}
              onVolumeChange={(v) => setTrackVolume(t.id, v)}
              onPanChange={(v) => setTrackPan(t.id, v)}
            />
          ))
        )}
      </div>

      {/* Buses: submix groups sitting between tracks and the master bus. */}
      <div className="border-t border-void-700 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Buses</h3>
          <button
            onClick={() => addBus()}
            className="flex items-center gap-1 rounded border border-void-600 bg-void-850 px-2 py-1 text-[10px] text-white/60 transition hover:text-neon-cyan"
            title="Add bus"
          >
            <Plus size={11} />
            Add bus
          </button>
        </div>
        {buses.length === 0 ? (
          <p className="px-1 text-[10px] text-white/25">
            Group tracks (e.g. Drums, Vocals) by routing them to a bus from each track&rsquo;s header dropdown.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto">
            {buses.map((b) => (
              <ChannelStrip
                key={b.id}
                name={b.name}
                color={b.color}
                volume={b.volume}
                pan={b.pan}
                muted={b.muted}
                solo={b.solo}
                onVolumeChange={(v) => setBusVolume(b.id, v)}
                onPanChange={(v) => setBusPan(b.id, v)}
                onToggleMute={() => toggleBusMute(b.id)}
                onToggleSolo={() => toggleBusSolo(b.id)}
                onDelete={() => removeBus(b.id)}
                onRename={(name) => renameBus(b.id, name)}
                routedCount={tracks.filter((t) => t.busId === b.id).length}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-void-700 p-3">
        <SpectrumAnalyzer />
      </div>

      <div className="border-t border-void-700 p-3">
        <MeteringPanel />
      </div>

      <div className="border-t border-void-700 p-3">
        <ChannelStrip
          name="MASTER"
          color="#ffb84f"
          volume={masterVolume}
          pan={0}
          onVolumeChange={setMasterVolume}
          onPanChange={() => {}}
        />
      </div>
    </aside>
  );
}
