"use client";

import { useRef, useState } from "react";
import { X, CloudUpload, CloudDownload, Trash2, Download, Upload, Link2, Copy, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useDAWStore } from "@/store/useDAWStore";

function formatWhen(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CloudSyncPanel() {
  const open = useDAWStore((s) => s.cloudPanelOpen);
  const toggle = useDAWStore((s) => s.toggleCloudPanel);
  const cloudVersions = useDAWStore((s) => s.cloudVersions);
  const cloudBusy = useDAWStore((s) => s.cloudBusy);
  const cloudError = useDAWStore((s) => s.cloudError);
  const pushToCloud = useDAWStore((s) => s.pushToCloud);
  const pullFromCloud = useDAWStore((s) => s.pullFromCloud);
  const deleteCloudVersion = useDAWStore((s) => s.deleteCloudVersion);
  const exportProjectFile = useDAWStore((s) => s.exportProjectFile);
  const importProjectFile = useDAWStore((s) => s.importProjectFile);
  const copyShareCode = useDAWStore((s) => s.copyShareCode);
  const pasteShareCode = useDAWStore((s) => s.pasteShareCode);

  const [versionName, setVersionName] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handlePush = async () => {
    await pushToCloud(versionName.trim() || `Version ${cloudVersions.length + 1}`);
    setVersionName("");
  };

  const handleGetCode = async () => {
    const code = await copyShareCode();
    setShareCode(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importProjectFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-void-600 bg-void-900 shadow-panel">
        <div className="flex items-center justify-between border-b border-void-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <CloudUpload size={16} className="text-neon-violet" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Cloud Sync / Collaboration</h2>
          </div>
          <button onClick={() => toggle(false)} className="rounded-md p-1 text-white/40 transition hover:bg-void-800 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {cloudError && (
            <div className="flex items-center gap-2 rounded-md border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-xs text-neon-red">
              <AlertTriangle size={13} /> {cloudError}
            </div>
          )}

          {/* Push / version history */}
          <div className="rounded-md border border-void-700 bg-void-850 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-white/40">Save a version to this browser&apos;s cloud</div>
            <div className="flex items-center gap-2">
              <input
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                placeholder="Version name (e.g. Mix v3)"
                className="flex-1 rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none placeholder:text-white/25 focus:border-neon-violet/50"
              />
              <button
                onClick={handlePush}
                disabled={cloudBusy}
                className="flex items-center gap-1.5 rounded-md border border-neon-violet/50 bg-neon-violet/10 px-3 py-1.5 text-xs font-semibold text-neon-violet transition hover:bg-neon-violet/20 disabled:opacity-40"
              >
                {cloudBusy ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
                Save
              </button>
            </div>
            <p className="mt-2 text-[10px] text-white/30">
              Snapshots session structure (tracks, effects, buses, markers, macros, templates) instantly. Audio itself
              stays in this browser for these quick saves — use Export or Share Code below to move the actual audio.
            </p>

            {cloudVersions.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {cloudVersions.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 rounded-md border border-void-700 bg-void-800 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-white/80">{v.name}</div>
                      <div className="text-[10px] text-white/30">{formatWhen(v.savedAt)}</div>
                    </div>
                    <button
                      onClick={() => pullFromCloud(v.id)}
                      title="Load this version (replaces current session)"
                      className="flex items-center gap-1 rounded-md border border-void-600 bg-void-850 px-2 py-1 text-[10px] text-white/70 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
                    >
                      <CloudDownload size={11} /> Load
                    </button>
                    <button onClick={() => deleteCloudVersion(v.id)} className="rounded-md p-1 text-white/30 transition hover:text-neon-red">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Export / Import full project file (includes audio) */}
          <div className="rounded-md border border-void-700 bg-void-850 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-white/40">
              Portable project file — includes audio, for real backups or handing off to a collaborator
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={exportProjectFile}
                disabled={cloudBusy}
                className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-800 px-3 py-1.5 text-xs text-white/80 transition hover:border-neon-cyan/50 hover:text-neon-cyan disabled:opacity-40"
              >
                {cloudBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export .json
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={cloudBusy}
                className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-800 px-3 py-1.5 text-xs text-white/80 transition hover:border-neon-pink/50 hover:text-neon-pink disabled:opacity-40"
              >
                <Upload size={13} /> Import .json
              </button>
              <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
            </div>
            <p className="mt-2 text-[10px] text-white/30">
              Importing replaces the current session — export first if you want to keep it.
            </p>
          </div>

          {/* Share code */}
          <div className="rounded-md border border-void-700 bg-void-850 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
              <Link2 size={11} /> Share code — paste the whole project (with audio) as text
            </div>
            <button
              onClick={handleGetCode}
              disabled={cloudBusy}
              className="flex items-center gap-1.5 rounded-md border border-void-600 bg-void-800 px-3 py-1.5 text-xs text-white/80 transition hover:border-neon-violet/50 hover:text-neon-violet disabled:opacity-40"
            >
              {copied ? <CheckCircle2 size={13} className="text-neon-cyan" /> : <Copy size={13} />}
              {copied ? "Copied to clipboard" : "Generate + Copy Code"}
            </button>
            {shareCode && (
              <textarea
                readOnly
                value={shareCode}
                onFocus={(e) => e.target.select()}
                className="mt-2 h-16 w-full resize-none rounded-md border border-void-600 bg-void-800 px-2 py-1.5 font-mono text-[9px] text-white/50 outline-none"
              />
            )}
            <div className="mt-3 flex items-center gap-2">
              <input
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste a share code here to load it"
                className="flex-1 rounded-md border border-void-600 bg-void-800 px-2 py-1.5 font-mono text-[10px] text-white/70 outline-none placeholder:font-sans placeholder:text-white/25 focus:border-neon-violet/50"
              />
              <button
                onClick={() => pasteText.trim() && pasteShareCode(pasteText.trim())}
                disabled={!pasteText.trim() || cloudBusy}
                className="flex items-center gap-1.5 rounded-md border border-neon-violet/50 bg-neon-violet/10 px-3 py-1.5 text-xs font-semibold text-neon-violet transition hover:bg-neon-violet/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Load
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
