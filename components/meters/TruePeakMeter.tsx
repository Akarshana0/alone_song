"use client";

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/lib/audioEngine";

const MIN_DB = -48;
const MAX_DB = 3;
const CLIP_THRESHOLD_DBTP = -1; // standard streaming/broadcast true-peak ceiling
const PEAK_HOLD_DECAY_DB_PER_SEC = 12;

function dbToPercent(db: number) {
  if (!isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));
}

function zoneColor(db: number) {
  if (db > CLIP_THRESHOLD_DBTP) return "#ff5c6c";
  if (db > -6) return "#ffb84f";
  return "#3ee6e0";
}

function ChannelReadout({
  label,
  fillRef,
  peakRef,
  numberRef,
}: {
  label: string;
  fillRef: React.RefObject<HTMLDivElement>;
  peakRef: React.RefObject<HTMLDivElement>;
  numberRef: React.RefObject<HTMLSpanElement>;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <div className="relative h-20 w-3 overflow-hidden rounded-full bg-void-950">
        <div ref={peakRef} className="absolute left-0 right-0 h-[2px] bg-white/70" style={{ bottom: "0%" }} />
        <div
          ref={fillRef}
          className="absolute bottom-0 left-0 right-0 rounded-full"
          style={{ height: "0%", background: "#3ee6e0" }}
        />
      </div>
      <span ref={numberRef} className="font-mono text-[9px] text-white/50">
        -inf
      </span>
      <span className="text-[8px] uppercase tracking-wider text-white/30">{label}</span>
    </div>
  );
}

/**
 * True-peak (dBTP) meter for the master bus. Reads AudioEngine's 4x-
 * oversampled inter-sample-peak estimate for L/R (see estimateTruePeakLinear
 * in lib/audioEngine.ts) and shows a latching "OVER" indicator whenever
 * either channel crosses the -1 dBTP ceiling — click it to reset.
 */
export default function TruePeakMeter() {
  const fillL = useRef<HTMLDivElement>(null);
  const fillR = useRef<HTMLDivElement>(null);
  const peakL = useRef<HTMLDivElement>(null);
  const peakR = useRef<HTMLDivElement>(null);
  const numL = useRef<HTMLSpanElement>(null);
  const numR = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const peakHoldDb = useRef({ l: -Infinity, r: -Infinity });
  const lastTime = useRef<number | undefined>(undefined);
  const hasClipped = useRef(false);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const tick = (t: number) => {
      const dt = lastTime.current ? (t - lastTime.current) / 1000 : 0;
      lastTime.current = t;

      const { left, right } = audioEngine.getMasterTruePeakDb();
      const decay = PEAK_HOLD_DECAY_DB_PER_SEC * dt;
      peakHoldDb.current.l = Math.max(left, peakHoldDb.current.l - decay);
      peakHoldDb.current.r = Math.max(right, peakHoldDb.current.r - decay);

      if (left > CLIP_THRESHOLD_DBTP || right > CLIP_THRESHOLD_DBTP) {
        if (!hasClipped.current) {
          hasClipped.current = true;
          setClipped(true);
        }
      }

      if (fillL.current) {
        fillL.current.style.height = `${dbToPercent(left)}%`;
        fillL.current.style.background = zoneColor(left);
      }
      if (fillR.current) {
        fillR.current.style.height = `${dbToPercent(right)}%`;
        fillR.current.style.background = zoneColor(right);
      }
      if (peakL.current) peakL.current.style.bottom = `${dbToPercent(peakHoldDb.current.l)}%`;
      if (peakR.current) peakR.current.style.bottom = `${dbToPercent(peakHoldDb.current.r)}%`;
      if (numL.current) numL.current.textContent = isFinite(left) ? left.toFixed(1) : "-inf";
      if (numR.current) numR.current.textContent = isFinite(right) ? right.toFixed(1) : "-inf";

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider text-white/40">True Peak (dBTP)</span>
        <button
          onClick={() => {
            hasClipped.current = false;
            setClipped(false);
          }}
          className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider transition ${
            clipped ? "bg-neon-red/25 text-neon-red animate-pulseGlow" : "bg-void-800 text-white/25"
          }`}
          title="Click to reset clip indicator"
        >
          {clipped ? "Over" : "OK"}
        </button>
      </div>
      <div className="flex justify-center gap-4 rounded bg-void-950/60 p-2">
        <ChannelReadout label="L" fillRef={fillL} peakRef={peakL} numberRef={numL} />
        <ChannelReadout label="R" fillRef={fillR} peakRef={peakR} numberRef={numR} />
      </div>
    </div>
  );
}
