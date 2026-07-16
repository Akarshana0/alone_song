"use client";

import { Plus, Music2, Piano, FolderPlus } from "lucide-react";
import { useDAWStore } from "@/store/useDAWStore";
import Track from "./Track";

export default function Timeline() {
  const tracks = useDAWStore((s) => s.tracks);
  const addTrack = useDAWStore((s) => s.addTrack);
  const addFolderTrack = useDAWStore((s) => s.addFolderTrack);

  // Folder Tracks (nested): hide a track if it's filed under a folder that's
  // currently collapsed.
  const collapsedFolderIds = new Set(tracks.filter((t) => t.isFolder && t.collapsed).map((t) => t.id));
  const visibleTracks = tracks.filter((t) => !t.parentId || !collapsedFolderIds.has(t.parentId));

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-void-950">
      {/* Ruler */}
      <div className="flex h-7 shrink-0 items-center border-b border-void-700 bg-void-900 pl-48">
        <div className="bg-grid h-full flex-1 opacity-60" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {tracks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/30">
            <Music2 size={32} className="text-neon-cyan/40" />
            <p className="text-sm">No tracks yet. Add your first track to get started.</p>
          </div>
        ) : (
          visibleTracks.map((track) => <Track key={track.id} track={track} />)
        )}
      </div>

      {/* Add track bar */}
      <div className="flex shrink-0 gap-2 border-t border-void-700 bg-void-900 p-3">
        <button
          onClick={() => addTrack("audio")}
          className="flex items-center gap-2 rounded-md border border-void-600 bg-void-850 px-3 py-2 text-xs text-white/70 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
        >
          <Plus size={14} />
          <Music2 size={14} />
          Add Audio Track
        </button>
        <button
          onClick={() => addTrack("midi")}
          className="flex items-center gap-2 rounded-md border border-void-600 bg-void-850 px-3 py-2 text-xs text-white/70 transition hover:border-neon-violet/50 hover:text-neon-violet"
        >
          <Plus size={14} />
          <Piano size={14} />
          Add MIDI Track
        </button>
        <button
          onClick={() => addFolderTrack()}
          className="flex items-center gap-2 rounded-md border border-void-600 bg-void-850 px-3 py-2 text-xs text-white/70 transition hover:border-neon-amber/50 hover:text-neon-amber"
        >
          <FolderPlus size={14} />
          Add Folder Track
        </button>
      </div>
    </div>
  );
}
