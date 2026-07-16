"use client";

import { useState } from "react";
import LufsMeter from "./LufsMeter";
import TruePeakMeter from "./TruePeakMeter";
import PhaseCorrelationMeter from "./PhaseCorrelationMeter";
import Goniometer from "./Goniometer";
import Tuner from "./Tuner";

type Tab = "levels" | "peak" | "phase" | "gonio" | "tuner";

const TABS: { id: Tab; label: string }[] = [
  { id: "levels", label: "LUFS" },
  { id: "peak", label: "True Peak" },
  { id: "phase", label: "Phase" },
  { id: "gonio", label: "Gonio" },
  { id: "tuner", label: "Tuner" },
];

/**
 * Tabbed home for the metering suite: LUFS-style level bars, True Peak,
 * Phase Correlation, Goniometer, and Tuner. Each tab is a self-contained
 * component reading straight off AudioEngine's master-bus taps — switching
 * tabs is pure UI, all of them keep sampling in the background isn't
 * needed since only the active tab mounts.
 */
export default function MeteringPanel() {
  const [tab, setTab] = useState<Tab>("levels");

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-void-700 bg-void-850 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">Metering</span>
      </div>

      <div className="flex gap-1 rounded bg-void-950/60 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded px-1 py-1 text-[9px] font-semibold uppercase tracking-wider transition ${
              tab === t.id ? "bg-void-700 text-neon-cyan" : "text-white/35 hover:text-white/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[7.5rem]">
        {tab === "levels" && <LufsMeter />}
        {tab === "peak" && <TruePeakMeter />}
        {tab === "phase" && <PhaseCorrelationMeter />}
        {tab === "gonio" && <Goniometer />}
        {tab === "tuner" && <Tuner />}
      </div>
    </div>
  );
}
