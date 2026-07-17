"use client";

import { useState } from "react";
import { Scissors, Copy, ClipboardPaste, Crop, SplitSquareHorizontal, Combine, VolumeX, X, Loader2, ChevronsLeft } from "lucide-react";
import clsx from "clsx";
import { useDAWStore } from "@/store/useDAWStore";

type ToolKey = "cut" | "copy" | "paste" | "trim" | "split" | "merge" | "silence" | "ripple";

export default function EditToolbar() {
  const selection = useDAWStore((s) => s.selection);
  const selectedTrackId = useDAWStore((s) => s.selectedTrackId);
  const clipboard = useDAWStore((s) => s.clipboard);
  const tracks = useDAWStore((s) => s.tracks);
  const clearSelection = useDAWStore((s) => s.clearSelection);
  const cutSelection = useDAWStore((s) => s.cutSelection);
  const copySelection = useDAWStore((s) => s.copySelection);
  const pasteAtPlayhead = useDAWStore((s) => s.pasteAtPlayhead);
  const trimToSelection = useDAWStore((s) => s.trimToSelection);
  const splitTrack = useDAWStore((s) => s.splitTrack);
  const silenceSelection = useDAWStore((s) => s.silenceSelection);
  const mergeDown = useDAWStore((s) => s.mergeDown);
  const rippleDeleteSelection = useDAWStore((s) => s.rippleDeleteSelection);
  const snapEnabled = useDAWStore((s) => s.snapEnabled);
  const snapGrid = useDAWStore((s) => s.snapGrid);
  const toggleSnap = useDAWStore((s) => s.toggleSnap);
  const setSnapGrid = useDAWStore((s) => s.setSnapGrid);

  const [busy, setBusy] = useState<ToolKey | null>(null);

  const targetId = selection?.trackId ?? selectedTrackId;
  const targetTrack = tracks.find((t) => t.id === targetId);
  const targetIndex = tracks.findIndex((t) => t.id === targetId);
  const nextTrack = targetIndex > -1 ? tracks[targetIndex + 1] : undefined;

  const hasSelection = !!selection && selection.end > selection.start;
  const canEditSelection = hasSelection && !!targetTrack?.fileUrl && !busy;
  const canPaste = !!clipboard && !!targetTrack?.fileUrl && !busy;
  const canSplit = !!targetTrack?.fileUrl && !busy;
  const canMerge = !!targetTrack?.fileUrl && !!nextTrack?.fileUrl && !busy;

  const run = (key: ToolKey, fn: () => Promise<void>) => async () => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const btnClass = (enabled: boolean) =>
    clsx(
      "flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition",
      enabled
        ? "border-void-600 bg-void-850 text-white/70 hover:border-neon-cyan/50 hover:text-neon-cyan"
        : "cursor-not-allowed border-void-700 bg-void-900 text-white/20"
    );

  const icon = (key: ToolKey, Icon: typeof Scissors) =>
    busy === key ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-void-700 bg-void-900 px-4">
      <button
        disabled={!canEditSelection}
        onClick={run("cut", cutSelection)}
        className={btnClass(canEditSelection)}
        title="Cut selection to clipboard"
      >
        {icon("cut", Scissors)} Cut
      </button>
      <button
        disabled={!canEditSelection}
        onClick={run("copy", copySelection)}
        className={btnClass(canEditSelection)}
        title="Copy selection to clipboard"
      >
        {icon("copy", Copy)} Copy
      </button>
      <button
        disabled={!canPaste}
        onClick={run("paste", pasteAtPlayhead)}
        className={btnClass(canPaste)}
        title="Paste clipboard at the selection start / playhead"
      >
        {icon("paste", ClipboardPaste)} Paste
      </button>
      <button
        disabled={!canEditSelection}
        onClick={run("trim", trimToSelection)}
        className={btnClass(canEditSelection)}
        title="Trim track down to just the selection"
      >
        {icon("trim", Crop)} Trim
      </button>
      <button
        disabled={!canSplit}
        onClick={run("split", splitTrack)}
        className={btnClass(canSplit)}
        title="Split track into two at the selection start / playhead"
      >
        {icon("split", SplitSquareHorizontal)} Split
      </button>
      <button
        disabled={!canMerge}
        onClick={run("merge", () => mergeDown(targetId as string))}
        className={btnClass(canMerge)}
        title="Merge this track down with the one below it"
      >
        {icon("merge", Combine)} Merge
      </button>
      <button
        disabled={!canEditSelection}
        onClick={run("silence", silenceSelection)}
        className={btnClass(canEditSelection)}
        title="Silence the selected range"
      >
        {icon("silence", VolumeX)} Silence
      </button>
      <button
        disabled={!canEditSelection}
        onClick={run("ripple", rippleDeleteSelection)}
        className={btnClass(canEditSelection)}
        title="Ripple Delete — remove the selection from every track in sync and shift everything after it earlier, closing the gap"
      >
        {icon("ripple", ChevronsLeft)} Ripple
      </button>

      <div className="mx-1 h-6 w-px shrink-0 bg-void-700" />

      {selection ? (
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-void-700 bg-void-850 px-2 py-1 font-mono text-[10px] text-white/50">
          {selection.start.toFixed(2)}s – {selection.end.toFixed(2)}s
          <button onClick={clearSelection} className="text-white/40 transition hover:text-neon-red" title="Clear selection">
            <X size={11} />
          </button>
        </div>
      ) : (
        <span className="shrink-0 text-[10px] text-white/25">Drag on a waveform to select a range</span>
      )}

      {clipboard && (
        <div className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border border-neon-violet/40 bg-neon-violet/10 px-2 py-1 text-[10px] text-neon-violet sm:flex">
          Clipboard: {clipboard.duration.toFixed(2)}s
        </div>
      )}

      <div className={clsx("shrink-0 items-center gap-2", clipboard ? "flex" : "ml-auto flex")}>
        <button
          onClick={toggleSnap}
          className={clsx(
            "whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-medium transition",
            snapEnabled
              ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan"
              : "border-void-600 bg-void-850 text-white/50 hover:text-white"
          )}
          title="Snap markers, loop/punch points, and selections to the grid"
        >
          Snap {snapEnabled ? "On" : "Off"}
        </button>
        <select
          value={snapGrid}
          onChange={(e) => setSnapGrid(e.target.value as "bar" | "beat" | "half-beat")}
          disabled={!snapEnabled}
          className="rounded-md border border-void-600 bg-void-850 px-1.5 py-1 text-[10px] text-white/70 disabled:opacity-40"
          title="Snap grid"
        >
          <option value="bar">Bar</option>
          <option value="beat">Beat</option>
          <option value="half-beat">1/2 Beat</option>
        </select>
      </div>
    </div>
  );
}
