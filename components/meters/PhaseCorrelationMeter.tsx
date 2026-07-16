"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";

/**
 * Stereo phase correlation gauge. Reads AudioEngine.getPhaseCorrelation()
 * (a normalized cross-correlation of the L/R waveform taps, -1..+1) every
 * frame and lightly smooths it so the needle doesn't flicker on transients.
 */
export default function PhaseCorrelationMeter() {
  const markerRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const smoothed = useRef(1);

  useEffect(() => {
    const tick = () => {
      const raw = audioEngine.getPhaseCorrelation();
      smoothed.current += (raw - smoothed.current) * 0.15;
      const pct = ((smoothed.current + 1) / 2) * 100;

      if (markerRef.current) markerRef.current.style.left = `${pct}%`;
      if (numberRef.current) {
        numberRef.current.textContent = smoothed.current.toFixed(2);
        numberRef.current.style.color =
          smoothed.current < -0.2 ? "#ff5c6c" : smoothed.current < 0.4 ? "#ffb84f" : "rgba(255,255,255,0.8)";
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-wider text-white/40">Phase Correlation</span>
        <span ref={numberRef} className="font-mono text-sm font-semibold text-white/80">
          1.00
        </span>
      </div>
      <div
        className="relative h-3 w-full overflow-hidden rounded-full"
        style={{ background: "linear-gradient(to right, #ff5c6c 0%, #ffb84f 38%, #3ee6e0 55%, #3ee6e0 100%)" }}
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/40" />
        <div
          ref={markerRef}
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ left: "100%", boxShadow: "0 0 6px rgba(255,255,255,0.8)" }}
        />
      </div>
      <div className="flex justify-between text-[8px] font-mono text-white/25">
        <span>-1 cancels</span>
        <span>0</span>
        <span>+1 mono</span>
      </div>
    </div>
  );
}
