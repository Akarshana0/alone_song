"use client";

import Image from "next/image";
import { Settings, Share2, Sparkles, Undo2, Redo2, LayoutTemplate, Zap, CloudUpload } from "lucide-react";
import { useDAWStore } from "@/store/useDAWStore";

export default function Navbar() {
  const bpm = useDAWStore((s) => s.bpm);
  const setBpm = useDAWStore((s) => s.setBpm);
  const undo = useDAWStore((s) => s.undo);
  const redo = useDAWStore((s) => s.redo);
  const toggleExportPanel = useDAWStore((s) => s.toggleExportPanel);
  const toggleTemplatesPanel = useDAWStore((s) => s.toggleTemplatesPanel);
  const toggleMacrosPanel = useDAWStore((s) => s.toggleMacrosPanel);
  const toggleCloudPanel = useDAWStore((s) => s.toggleCloudPanel);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-void-700 bg-void-900/90 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="relative h-8 w-8 overflow-hidden rounded-lg shadow-neon-cyan">
          <Image src="/logo.png" alt="ALONE SONG" fill sizes="32px" className="object-cover" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <h1 className="text-lg font-bold tracking-wide text-white">
            ALONE
            <span className="bg-gradient-to-r from-neon-cyan via-neon-pink to-neon-violet bg-clip-text text-transparent">
              {" "}SONG
            </span>
          </h1>
          <span className="hidden text-[10px] uppercase tracking-[0.2em] text-white/30 sm:inline">
            Web DAW · Phase 1
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-md border border-void-600 bg-void-850 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-white/40">BPM</span>
          <input
            type="number"
            min={40}
            max={300}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-12 bg-transparent text-center font-mono text-sm text-neon-cyan outline-none"
          />
        </div>

        <button
          onClick={undo}
          title="Undo (Ctrl+Z)"
          className="rounded-md border border-void-600 bg-void-850 p-1.5 text-white/60 transition hover:text-white"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          className="rounded-md border border-void-600 bg-void-850 p-1.5 text-white/60 transition hover:text-white"
        >
          <Redo2 size={15} />
        </button>

        <button
          className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-850 px-3 py-1.5 text-xs text-white/70 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
          title="Coming in a later phase"
        >
          <Sparkles size={14} />
          <span className="hidden sm:inline">AI Master</span>
        </button>
        <button
          onClick={() => toggleTemplatesPanel(true)}
          title="Track Templates — save/reuse a track's sound design"
          className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-850 px-3 py-1.5 text-xs text-white/70 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
        >
          <LayoutTemplate size={14} />
          <span className="hidden sm:inline">Templates</span>
        </button>
        <button
          onClick={() => toggleMacrosPanel(true)}
          title="Macros / Custom Actions — chain and replay track actions"
          className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-850 px-3 py-1.5 text-xs text-white/70 transition hover:border-neon-pink/50 hover:text-neon-pink"
        >
          <Zap size={14} />
          <span className="hidden sm:inline">Macros</span>
        </button>
        <button
          onClick={() => toggleCloudPanel(true)}
          title="Cloud Sync / Collaboration — versions, export/import, share code"
          className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-850 px-3 py-1.5 text-xs text-white/70 transition hover:border-neon-violet/50 hover:text-neon-violet"
        >
          <CloudUpload size={14} />
          <span className="hidden sm:inline">Cloud</span>
        </button>
        <button
          onClick={() => toggleExportPanel(true)}
          title="Export/Delivery — stems, batch export, format conversion, ID3 tags"
          className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-850 px-3 py-1.5 text-xs text-white/70 transition hover:border-neon-pink/50 hover:text-neon-pink"
        >
          <Share2 size={14} />
          <span className="hidden sm:inline">Export</span>
        </button>
        <button className="rounded-md border border-void-600 bg-void-850 p-1.5 text-white/60 transition hover:text-white">
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
