"use client";

import { useState } from "react";
import { v4 as uuid } from "uuid";
import { X, Zap, Plus, Trash2, Play, Loader2 } from "lucide-react";
import { useDAWStore } from "@/store/useDAWStore";
import { MACRO_ACTIONS, MacroActionType, MacroStep, macroActionDef } from "@/lib/projectSync";

export default function MacrosPanel() {
  const open = useDAWStore((s) => s.macrosPanelOpen);
  const toggle = useDAWStore((s) => s.toggleMacrosPanel);
  const tracks = useDAWStore((s) => s.tracks);
  const selectedTrackId = useDAWStore((s) => s.selectedTrackId);
  const macros = useDAWStore((s) => s.macros);
  const saveMacro = useDAWStore((s) => s.saveMacro);
  const deleteMacro = useDAWStore((s) => s.deleteMacro);
  const runMacro = useDAWStore((s) => s.runMacro);
  const runningMacroId = useDAWStore((s) => s.runningMacroId);

  const [builderSteps, setBuilderSteps] = useState<MacroStep[]>([]);
  const [macroName, setMacroName] = useState("");
  const [pickAction, setPickAction] = useState<MacroActionType>(MACRO_ACTIONS[0].type);
  const [pickAmount, setPickAmount] = useState<number>(MACRO_ACTIONS[0].default ?? 0);
  const [runTargets, setRunTargets] = useState<Record<string, string>>({});

  if (!open) return null;

  const currentDef = macroActionDef(pickAction);

  const addStep = () => {
    setBuilderSteps((steps) => [
      ...steps,
      { id: uuid(), action: pickAction, amount: currentDef.needsAmount ? pickAmount : undefined },
    ]);
  };
  const removeStep = (id: string) => setBuilderSteps((steps) => steps.filter((s) => s.id !== id));

  const handleSave = () => {
    if (builderSteps.length === 0) return;
    saveMacro(macroName.trim() || `Macro ${macros.length + 1}`, builderSteps);
    setBuilderSteps([]);
    setMacroName("");
  };

  const targetFor = (macroId: string) => runTargets[macroId] ?? selectedTrackId ?? tracks[0]?.id ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-void-600 bg-void-900 shadow-panel">
        <div className="flex items-center justify-between border-b border-void-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-neon-pink" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">Macros / Custom Actions</h2>
          </div>
          <button onClick={() => toggle(false)} className="rounded-md p-1 text-white/40 transition hover:bg-void-800 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Builder */}
          <div className="rounded-md border border-void-700 bg-void-850 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-white/40">
              Build a chain of actions, then save it as a macro
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={pickAction}
                onChange={(e) => {
                  const type = e.target.value as MacroActionType;
                  setPickAction(type);
                  setPickAmount(macroActionDef(type).default ?? 0);
                }}
                className="rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-neon-pink/50"
              >
                {MACRO_ACTIONS.map((a) => (
                  <option key={a.type} value={a.type}>
                    {a.label}
                  </option>
                ))}
              </select>
              {currentDef.needsAmount && (
                <input
                  type="number"
                  value={pickAmount}
                  min={currentDef.min}
                  max={currentDef.max}
                  step={currentDef.step}
                  onChange={(e) => setPickAmount(Number(e.target.value))}
                  className="w-20 rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-neon-pink/50"
                />
              )}
              {currentDef.unit && <span className="text-[10px] text-white/30">{currentDef.unit}</span>}
              <button
                onClick={addStep}
                className="flex items-center gap-1 rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-[10px] text-neon-pink transition hover:border-neon-pink/50"
              >
                <Plus size={11} /> Add Step
              </button>
            </div>

            {builderSteps.length > 0 && (
              <ol className="mt-3 space-y-1">
                {builderSteps.map((step, i) => {
                  const def = macroActionDef(step.action);
                  return (
                    <li
                      key={step.id}
                      className="flex items-center gap-2 rounded-md border border-void-700 bg-void-800 px-2 py-1 text-[11px] text-white/70"
                    >
                      <span className="text-white/30">{i + 1}.</span>
                      <span className="flex-1">
                        {def.label}
                        {def.needsAmount && step.amount !== undefined ? ` — ${step.amount}${def.unit ?? ""}` : ""}
                      </span>
                      <button onClick={() => removeStep(step.id)} className="text-white/30 hover:text-neon-red">
                        <Trash2 size={11} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-3 flex items-center gap-2">
              <input
                value={macroName}
                onChange={(e) => setMacroName(e.target.value)}
                placeholder="Macro name"
                className="flex-1 rounded-md border border-void-600 bg-void-800 px-2 py-1.5 text-xs text-white/80 outline-none placeholder:text-white/25 focus:border-neon-pink/50"
              />
              <button
                onClick={handleSave}
                disabled={builderSteps.length === 0}
                className="flex items-center gap-1.5 rounded-md border border-neon-pink/50 bg-neon-pink/10 px-3 py-1.5 text-xs font-semibold text-neon-pink transition hover:bg-neon-pink/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Macro
              </button>
            </div>
          </div>

          {/* Saved macros */}
          <div className="space-y-2">
            {macros.length === 0 && <p className="text-xs text-white/30">No macros saved yet — build one above.</p>}
            {macros.map((macro) => (
              <div key={macro.id} className="rounded-md border border-void-700 bg-void-850 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-white/80">{macro.name}</div>
                    <div className="truncate text-[10px] text-white/30">
                      {macro.steps.map((s) => macroActionDef(s.action).label).join(" → ")}
                    </div>
                  </div>
                  <select
                    value={targetFor(macro.id)}
                    onChange={(e) => setRunTargets((m) => ({ ...m, [macro.id]: e.target.value }))}
                    className="rounded-md border border-void-600 bg-void-800 px-1.5 py-1 text-[10px] text-white/70"
                  >
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => runMacro(macro.id, targetFor(macro.id))}
                    disabled={!targetFor(macro.id) || runningMacroId !== null}
                    className="flex items-center gap-1 rounded-md border border-neon-cyan/50 bg-neon-cyan/10 px-2 py-1 text-[10px] font-semibold text-neon-cyan transition hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {runningMacroId === macro.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                    Run
                  </button>
                  <button onClick={() => deleteMacro(macro.id)} className="rounded-md p-1 text-white/30 transition hover:text-neon-red">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
