"use client";

import { useState, ReactNode } from "react";
import clsx from "clsx";
import {
  X,
  Layers,
  Music2,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  Tag,
} from "lucide-react";
import { useDAWStore } from "@/store/useDAWStore";
import {
  BatchItem,
  DitherMethod,
  ExportFormat,
  ExportProgress,
  ExportSettings,
  SampleRateOption,
  defaultExportSettings,
  exportBatch,
  exportMixdown,
  exportStems,
} from "@/lib/exportEngine";

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "wav", label: "WAV (Lossless)" },
  { value: "flac", label: "FLAC (Lossless)" },
  { value: "mp3", label: "MP3 (Lossy)" },
  { value: "ogg", label: "OGG Vorbis (Lossy)" },
];

const SAMPLE_RATE_OPTIONS: { value: SampleRateOption; label: string }[] = [
  { value: "source", label: "Keep project rate" },
  { value: 44100, label: "44.1 kHz — CD" },
  { value: 48000, label: "48 kHz — Video" },
  { value: 88200, label: "88.2 kHz" },
  { value: 96000, label: "96 kHz — HD" },
  { value: 192000, label: "192 kHz" },
];

const DITHER_OPTIONS: { value: DitherMethod; label: string }[] = [
  { value: "none", label: "None" },
  { value: "triangular", label: "Triangular (TPDF)" },
  { value: "shibata", label: "Shibata (noise-shaped)" },
  { value: "lipshitz", label: "Lipshitz (noise-shaped)" },
];

const BITRATE_OPTIONS = [128, 192, 256, 320] as const;

function labelFor(settings: ExportSettings): string {
  const rate = settings.sampleRate === "source" ? "src" : `${settings.sampleRate / 1000}k`;
  if (settings.format === "wav" || settings.format === "flac") {
    return `${settings.format.toUpperCase()} ${settings.bitDepth}-bit/${rate}`;
  }
  return `${settings.format.toUpperCase()} ${settings.mp3Bitrate}kbps`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] text-white/40">
      <span className="uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

const selectClass =
  "rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none transition focus:border-neon-cyan/50";
const inputClass =
  "rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none transition placeholder:text-white/25 focus:border-neon-cyan/50";

export default function ExportPanel() {
  const open = useDAWStore((s) => s.exportPanelOpen);
  const toggle = useDAWStore((s) => s.toggleExportPanel);
  const tracks = useDAWStore((s) => s.tracks);
  const bpm = useDAWStore((s) => s.bpm);

  const [mode, setMode] = useState<"mix" | "stems">("mix");
  const [settings, setSettings] = useState<ExportSettings>(defaultExportSettings());
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isExporting = progress !== null && progress.stage !== "done" && progress.stage !== "error";

  if (!open) return null;

  const patch = (partial: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...partial }));
  const patchTags = (partial: Partial<ExportSettings["tags"]>) =>
    setSettings((s) => ({ ...s, tags: { ...s.tags, ...partial } }));

  const showBitDepth = settings.format === "wav" || settings.format === "flac";
  const showDither = showBitDepth && settings.bitDepth === 16;
  const showBitrate = settings.format === "mp3" || settings.format === "ogg";

  const allTrackIds = tracks.map((t) => t.id);
  const toggleTrack = (id: string) =>
    setSelectedTrackIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const addToBatch = () => {
    setBatchItems((items) => [
      ...items,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: labelFor(settings), settings },
    ]);
  };
  const removeFromBatch = (id: string) => setBatchItems((items) => items.filter((i) => i.id !== id));

  const run = async () => {
    setError(null);
    setProgress({ stage: "mixing", progress: 0 });
    const baseName = (typeof document !== "undefined" && document.title) || "alone-song";
    try {
      if (batchItems.length > 0) {
        await exportBatch(
          tracks,
          bpm,
          batchItems,
          { stems: mode === "stems", trackIds: selectedTrackIds },
          baseName,
          setProgress
        );
      } else if (mode === "stems") {
        await exportStems(tracks, bpm, selectedTrackIds, settings, baseName, setProgress);
      } else {
        await exportMixdown(tracks, bpm, settings, baseName, setProgress);
      }
      setProgress({ stage: "done", progress: 1 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setProgress({ stage: "error", progress: 0 });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-void-600 bg-void-900 shadow-panel">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-void-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Download size={16} className="text-neon-cyan" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Export / Delivery</h2>
          </div>
          <button
            onClick={() => toggle(false)}
            className="rounded-md p-1 text-white/40 transition hover:bg-void-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Mode tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode("mix")}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition",
                mode === "mix"
                  ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan"
                  : "border-void-600 bg-void-850 text-white/50 hover:text-white"
              )}
            >
              <Music2 size={14} />
              Full Mix
            </button>
            <button
              onClick={() => setMode("stems")}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition",
                mode === "stems"
                  ? "border-neon-pink/50 bg-neon-pink/10 text-neon-pink"
                  : "border-void-600 bg-void-850 text-white/50 hover:text-white"
              )}
            >
              <Layers size={14} />
              Stems
            </button>
          </div>

          {/* Stems track picker */}
          {mode === "stems" && (
            <div className="rounded-md border border-void-700 bg-void-850 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/40">
                  Tracks to bounce ({selectedTrackIds.length}/{tracks.length})
                </span>
                <div className="flex gap-2 text-[10px]">
                  <button className="text-neon-cyan hover:underline" onClick={() => setSelectedTrackIds(allTrackIds)}>
                    All
                  </button>
                  <button className="text-white/40 hover:underline" onClick={() => setSelectedTrackIds([])}>
                    None
                  </button>
                </div>
              </div>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {tracks.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-void-800">
                    <input
                      type="checkbox"
                      checked={selectedTrackIds.includes(t.id)}
                      onChange={() => toggleTrack(t.id)}
                      className="accent-neon-pink"
                    />
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="truncate text-white/80">{t.name}</span>
                  </label>
                ))}
                {tracks.length === 0 && <p className="text-xs text-white/30">No tracks in this project yet.</p>}
              </div>
            </div>
          )}

          {/* Format settings */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Format">
              <select
                className={selectClass}
                value={settings.format}
                onChange={(e) => {
                  const format = e.target.value as ExportFormat;
                  const bitDepth = format !== "wav" && settings.bitDepth === 32 ? 24 : settings.bitDepth;
                  patch({ format, bitDepth });
                }}
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sample rate">
              <select
                className={selectClass}
                value={String(settings.sampleRate)}
                onChange={(e) => patch({ sampleRate: e.target.value === "source" ? "source" : (Number(e.target.value) as SampleRateOption) })}
              >
                {SAMPLE_RATE_OPTIONS.map((o) => (
                  <option key={o.label} value={String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            {showBitDepth && (
              <Field label="Bit depth">
                <select className={selectClass} value={settings.bitDepth} onChange={(e) => patch({ bitDepth: Number(e.target.value) as 16 | 24 | 32 })}>
                  <option value={16}>16-bit</option>
                  <option value={24}>24-bit</option>
                  {settings.format === "wav" && <option value={32}>32-bit float</option>}
                </select>
              </Field>
            )}
            {showDither && (
              <Field label="Dithering">
                <select className={selectClass} value={settings.dither} onChange={(e) => patch({ dither: e.target.value as DitherMethod })}>
                  {DITHER_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {showBitrate && (
              <Field label="Bitrate / quality">
                <select className={selectClass} value={settings.mp3Bitrate} onChange={(e) => patch({ mp3Bitrate: Number(e.target.value) as 128 | 192 | 256 | 320 })}>
                  {BITRATE_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b} kbps
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {/* ID3 / metadata tags */}
          <div className="rounded-md border border-void-700 bg-void-850 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
              <Tag size={11} />
              ID3 / metadata tags
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Title">
                <input className={inputClass} value={settings.tags.title ?? ""} onChange={(e) => patchTags({ title: e.target.value })} placeholder="Song title" />
              </Field>
              <Field label="Artist">
                <input className={inputClass} value={settings.tags.artist ?? ""} onChange={(e) => patchTags({ artist: e.target.value })} placeholder="Artist" />
              </Field>
              <Field label="Album">
                <input className={inputClass} value={settings.tags.album ?? ""} onChange={(e) => patchTags({ album: e.target.value })} placeholder="Album" />
              </Field>
              <Field label="Year">
                <input className={inputClass} value={settings.tags.year ?? ""} onChange={(e) => patchTags({ year: e.target.value })} placeholder="2026" />
              </Field>
              <Field label="Genre">
                <input className={inputClass} value={settings.tags.genre ?? ""} onChange={(e) => patchTags({ genre: e.target.value })} placeholder="Genre" />
              </Field>
              <Field label="Comment">
                <input className={inputClass} value={settings.tags.comment ?? ""} onChange={(e) => patchTags({ comment: e.target.value })} placeholder="Comment" />
              </Field>
            </div>
          </div>

          {/* Batch queue */}
          <div className="rounded-md border border-void-700 bg-void-850 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-white/40">Batch export queue</span>
              <button
                onClick={addToBatch}
                className="flex items-center gap-1 rounded-md border border-void-600 bg-void-800 px-2 py-1 text-[10px] text-neon-cyan transition hover:border-neon-cyan/50"
              >
                <Plus size={11} />
                Add current settings
              </button>
            </div>
            {batchItems.length === 0 ? (
              <p className="text-[11px] text-white/30">
                Empty — exporting will use the settings above just once. Add multiple entries to render several
                formats/qualities in one pass.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {batchItems.map((item) => (
                  <span
                    key={item.id}
                    className="flex items-center gap-1.5 rounded-full border border-void-600 bg-void-800 px-2.5 py-1 text-[10px] text-white/70"
                  >
                    {item.label}
                    <button onClick={() => removeFromBatch(item.id)} className="text-white/30 hover:text-neon-red">
                      <Trash2 size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-xs text-neon-red">
              <AlertTriangle size={13} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-void-700 px-4 py-3">
          {isExporting && (
            <div className="mb-2">
              <div className="mb-1 flex justify-between text-[10px] text-white/40">
                <span>{progress?.detail ?? progress?.stage}</span>
                <span>{Math.round((progress?.progress ?? 0) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-void-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-pink transition-all"
                  style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/30">
              {mode === "stems"
                ? `${selectedTrackIds.length} stem${selectedTrackIds.length === 1 ? "" : "s"} selected`
                : "Renders the full project mixdown"}
            </span>
            <button
              onClick={run}
              disabled={isExporting || (mode === "stems" && selectedTrackIds.length === 0)}
              className="flex items-center gap-1.5 rounded-md border border-neon-cyan/50 bg-neon-cyan/10 px-4 py-2 text-xs font-semibold text-neon-cyan transition hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isExporting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : progress?.stage === "done" ? (
                <CheckCircle2 size={14} />
              ) : (
                <Download size={14} />
              )}
              {isExporting ? "Exporting…" : batchItems.length > 0 ? `Export Batch (${batchItems.length})` : "Export"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
