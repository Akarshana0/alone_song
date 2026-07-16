"use client";

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/lib/audioEngine";
import { freqToNote } from "./noteUtils";

const IN_TUNE_CENTS = 5;
const DETECT_INTERVAL_MS = 60; // autocorrelation pitch detection is too costly to run every rAF frame

/**
 * Chromatic tuner for whatever's coming out of the master bus — best on a
 * single monophonic source (a soloed vocal, guitar, or bass track). Reuses
 * AudioEngine.getTunerPitch(), the same autocorrelation detector that drives
 * Auto-Tune, so "in tune" here means the same thing Auto-Tune corrects toward.
 */
export default function Tuner() {
  const [note, setNote] = useState<{ name: string; cents: number } | null>(null);
  const [freq, setFreq] = useState<number>(-1);
  const lastConfident = useRef<{ name: string; cents: number } | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const f = audioEngine.getTunerPitch();
      setFreq(f);
      if (f > 0) {
        const info = freqToNote(f);
        lastConfident.current = info;
        setNote(info);
      } else {
        setNote(null);
      }
    }, DETECT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const displayed = note ?? lastConfident.current;
  const cents = displayed?.cents ?? 0;
  const clampedCents = Math.max(-50, Math.min(50, cents));
  const markerPct = ((clampedCents + 50) / 100) * 100;
  const inTune = note !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const active = note !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-wider text-white/40">Tuner</span>
        <span className="font-mono text-[9px] text-white/30">
          {freq > 0 ? `${freq.toFixed(1)} Hz` : "—"}
        </span>
      </div>

      <div className="flex flex-col items-center gap-1 rounded bg-void-950/60 py-3">
        <span
          className="font-mono text-3xl font-bold transition-colors"
          style={{
            color: !active ? "rgba(255,255,255,0.2)" : inTune ? "#3ee6e0" : "#ffb84f",
            textShadow: active && inTune ? "0 0 12px rgba(62,230,224,0.6)" : "none",
          }}
        >
          {displayed?.name ?? "--"}
        </span>

        <div className="relative mt-1 h-2 w-40 max-w-full overflow-hidden rounded-full bg-void-800">
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
          {/* +-5 cent "in tune" zone */}
          <div
            className="absolute inset-y-0 rounded-full bg-neon-cyan/15"
            style={{ left: `${((50 - IN_TUNE_CENTS) / 100) * 100}%`, width: `${((IN_TUNE_CENTS * 2) / 100) * 100}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-100"
            style={{
              left: `${active ? markerPct : 50}%`,
              background: !active ? "rgba(255,255,255,0.25)" : inTune ? "#3ee6e0" : "#ffb84f",
              boxShadow: active ? "0 0 6px rgba(255,255,255,0.6)" : "none",
            }}
          />
        </div>
        <span className="font-mono text-[8px] text-white/25">
          {active ? `${cents > 0 ? "+" : ""}${cents.toFixed(0)}¢` : "no signal"}
        </span>
      </div>
    </div>
  );
}
