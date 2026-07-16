"use client";

import { useState } from "react";
import { Plug, Trash2, Power, Loader2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { Track as TrackType, useDAWStore } from "@/store/useDAWStore";

/**
 * VST-style plugin rack backed by real Web Audio Modules (WAM) hosting —
 * see AudioEngine.loadPlugin in lib/audioEngine.ts. Paste the published
 * bundle URL of any WAM 2.0-compatible plugin (an ES module exposing a
 * static `createInstance`) and it's loaded live into this track's chain,
 * right before the panner.
 */
export default function PluginRack({ track }: { track: TrackType }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const addPlugin = useDAWStore((s) => s.addPlugin);
  const removePlugin = useDAWStore((s) => s.removePlugin);
  const togglePluginBypass = useDAWStore((s) => s.togglePluginBypass);

  const handleAdd = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    addPlugin(track.id, trimmed, name.trim() || undefined);
    setUrl("");
    setName("");
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-void-700 bg-void-850 p-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
        <Plug size={12} />
        Plugins (Web Audio Modules)
      </div>

      {track.plugins.length === 0 && (
        <p className="text-[10px] text-white/30">No plugins loaded on this track yet.</p>
      )}

      <div className="flex flex-col gap-1">
        {track.plugins.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-2 rounded border border-void-700 bg-void-900 px-2 py-1"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-white/80">{p.name}</div>
              {p.status === "error" && (
                <div className="flex items-center gap-1 truncate text-[9px] text-neon-red">
                  <AlertTriangle size={9} />
                  {p.error ?? "Failed to load"}
                </div>
              )}
              {p.status === "loading" && (
                <div className="flex items-center gap-1 text-[9px] text-white/40">
                  <Loader2 size={9} className="animate-spin" />
                  Loading…
                </div>
              )}
            </div>
            <button
              onClick={() => togglePluginBypass(track.id, p.id)}
              title={p.bypassed ? "Bypassed — click to enable" : "Enabled — click to bypass"}
              className={clsx(
                "rounded p-1 transition",
                p.bypassed ? "text-white/25" : "text-neon-violet"
              )}
            >
              <Power size={12} />
            </button>
            <button
              onClick={() => removePlugin(track.id, p.id)}
              title="Remove plugin"
              className="rounded p-1 text-white/40 transition hover:text-neon-red"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-void-700 pt-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="WAM plugin bundle URL (e.g. https://.../index.js)"
          className="rounded border border-void-600 bg-void-900 px-2 py-1 text-[11px] text-white/80 outline-none focus:border-neon-violet/50"
        />
        <div className="flex gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (optional)"
            className="min-w-0 flex-1 rounded border border-void-600 bg-void-900 px-2 py-1 text-[11px] text-white/80 outline-none focus:border-neon-violet/50"
          />
          <button
            onClick={handleAdd}
            disabled={!url.trim()}
            className="shrink-0 rounded border border-neon-violet/40 bg-neon-violet/10 px-3 py-1 text-[11px] font-semibold text-neon-violet transition hover:bg-neon-violet/20 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Load
          </button>
        </div>
      </div>
      <p className="text-[9px] text-white/25">
        Loads any WAM 2.0-compatible plugin at runtime — no install needed. The plugin&apos;s audio node is inserted
        live into this track&apos;s chain, right before the panner.
      </p>
    </div>
  );
}
