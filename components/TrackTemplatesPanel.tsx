"use client";

import { useState } from "react";
import { X, LayoutTemplate, Save, PlusSquare, Wand2, Trash2 } from "lucide-react";
import { useDAWStore } from "@/store/useDAWStore";

export default function TrackTemplatesPanel() {
  const open = useDAWStore((s) => s.templatesPanelOpen);
  const toggle = useDAWStore((s) => s.toggleTemplatesPanel);
  const tracks = useDAWStore((s) => s.tracks);
  const selectedTrackId = useDAWStore((s) => s.selectedTrackId);
  const templates = useDAWStore((s) => s.trackTemplates);
  const saveTrackTemplate = useDAWStore((s) => s.saveTrackTemplate);
  const applyTrackTemplate = useDAWStore((s) => s.applyTrackTemplate);
  const createTrackFromTemplate = useDAWStore((s) => s.createTrackFromTemplate);
  const deleteTrackTemplate = useDAWStore((s) => s.deleteTrackTemplate);

  const [sourceTrackId, setSourceTrackId] = useState(selectedTrackId ?? tracks[0]?.id ?? "");
  const [name, setName] = useState("");

  if (!open) return null;

  const sourceTrack = tracks.find((t) => t.id === sourceTrackId) ?? tracks[0];
  const targetTrack = tracks.find((t) => t.id === selectedTrackId) ?? tracks[0];

  const handleSave = () => {
    if (!sourceTrack) return;
    saveTrackTemplate(sourceTrack.id, name.trim() || sourceTrack.name);
    setName("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[520px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-void-600 bg-void-900 shadow-panel">
        <div className="flex items-center justify-between border-b border-void-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <LayoutTemplate size={16} className="text-neon-cyan" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Track Templates</h2>
          </div>
          <button onClick={() => toggle(false)} className="rounded-md p-1 text-white/40 transition hover:bg-void-800 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Save current track as template */}
          <div className="rounded-md border border-void-700 bg-void-850 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-white/40">
              Save a track&apos;s sound design as a template
            </div>
            {tracks.length === 0 ? (
              <p className="text-xs text-white/30">No tracks in this project yet.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sourceTrackId}
                  onChange={(e) => setSourceTrackId(e.target.value)}
                  className="rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-neon-cyan/50"
                >
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={sourceTrack ? `${sourceTrack.name} template` : "Template name"}
                  className="min-w-[120px] flex-1 rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none placeholder:text-white/25 focus:border-neon-cyan/50"
                />
                <button
                  onClick={handleSave}
                  disabled={!sourceTrack}
                  className="flex items-center gap-1.5 rounded-md border border-neon-cyan/50 bg-neon-cyan/10 px-3 py-1.5 text-xs font-semibold text-neon-cyan transition hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save size={13} /> Save
                </button>
              </div>
            )}
            <p className="mt-2 text-[10px] text-white/30">
              Captures effects, instrument/synth engine, plugins&apos; slots, volume/pan and automation shape — not the
              audio/MIDI content itself, mute/solo/arm, or routing.
            </p>
          </div>

          {/* Template list */}
          <div className="space-y-2">
            {templates.length === 0 && (
              <p className="text-xs text-white/30">No templates saved yet — save one above to get started.</p>
            )}
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center gap-2 rounded-md border border-void-700 bg-void-850 px-3 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tpl.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-white/80">{tpl.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/30">{tpl.kind}</div>
                </div>
                <button
                  onClick={() => targetTrack && applyTrackTemplate(targetTrack.id, tpl.id)}
                  disabled={!targetTrack}
                  title={targetTrack ? `Apply to selected track (${targetTrack.name})` : "Select a track first"}
                  className="flex items-center gap-1 rounded-md border border-void-600 bg-void-800 px-2 py-1 text-[10px] text-white/70 transition hover:border-neon-amber/50 hover:text-neon-amber disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Wand2 size={11} /> Apply
                </button>
                <button
                  onClick={() => createTrackFromTemplate(tpl.id)}
                  title="Create a new track from this template"
                  className="flex items-center gap-1 rounded-md border border-void-600 bg-void-800 px-2 py-1 text-[10px] text-white/70 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
                >
                  <PlusSquare size={11} /> New Track
                </button>
                <button
                  onClick={() => deleteTrackTemplate(tpl.id)}
                  title="Delete template"
                  className="rounded-md p-1 text-white/30 transition hover:text-neon-red"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
