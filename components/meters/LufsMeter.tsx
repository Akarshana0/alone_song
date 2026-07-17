"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";

const MIN_DB = -60;
const MAX_DB = 0;
const PEAK_HOLD_DECAY_DB_PER_SEC = 20; // classic DAW peak-hold fall rate

function dbToPercent(db: number) {
  if (!isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));
}

function zoneColor(db: number) {
  if (db > -6) return "#ff5c6c"; // neon-red: hot
  if (db > -18) return "#ffb84f"; // neon-amber: healthy but loud
  return "#3ee6e0"; // neon-cyan: comfortable headroom
}

function formatDb(db: number) {
  if (!isFinite(db)) return "-inf";
  return db.toFixed(1);
}

/** A single vertical channel bar with a fill + a peak-hold tick that falls back over time. */
function ChannelBar({
  label,
  fillRef,
  peakRef,
}: {
  label: string;
  fillRef: React.RefObject<HTMLDivElement>;
  peakRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <div className="relative h-24 w-3 overflow-hidden rounded-full bg-void-950">
        <div
          ref={peakRef}
          className="absolute left-0 right-0 h-[2px] bg-white/70"
          style={{ bottom: "0%" }}
        />
        <div
          ref={fillRef}
          className="absolute bottom-0 left-0 right-0 rounded-full transition-[background-color] duration-150"
          style={{ height: "0%", background: "#3ee6e0" }}
        />
      </div>
      <span className="text-[8px] uppercase tracking-wider text-white/30">{label}</span>
    </div>
  );
}

/**
 * Stereo level meter with peak-hold, reading the AudioEngine's existing
 * Tone.Meter-based dB readouts (getMasterLevelDb for the headline number,
 * getMasterChannelLevelsDb for the L/R bars). No new DSP — this component is
 * purely the missing UI for level metering that was already computed.
 */
export default function LufsMeter() {
  const fillL = useRef<HTMLDivElement>(null);
  const fillR = useRef<HTMLDivElement>(null);
  const peakL = useRef<HTMLDivElement>(null);
  const peakR = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const peakHoldDb = useRef({ l: -Infinity, r: -Infinity });
  const lastTime = useRef<number | undefined>(undefined);

  useEffect(() => {
    const tick = (t: number) => {
      const dt = lastTime.current ? (t - lastTime.current) / 1000 : 0;
      lastTime.current = t;

      const overall = audioEngine.getMasterLevelDb();
      const { left, right } = audioEngine.getMasterChannelLevelsDb();

      const decay = PEAK_HOLD_DECAY_DB_PER_SEC * dt;
      peakHoldDb.current.l = Math.max(left, peakHoldDb.current.l - decay);
      peakHoldDb.current.r = Math.max(right, peakHoldDb.current.r - decay);

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
      if (readoutRef.current) {
        readoutRef.current.textContent = isFinite(overall) ? `${overall.toFixed(1)} LUFS` : "-inf LUFS";
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
        <span className="text-[9px] uppercase tracking-wider text-white/40">Program Level</span>
        <span ref={readoutRef} className="font-mono text-sm font-semibold text-white/80">
          -inf LUFS
        </span>
      </div>
      <div className="flex gap-3 rounded bg-void-950/60 p-2">
        <ChannelBar label="L" fillRef={fillL} peakRef={peakL} />
        <ChannelBar label="R" fillRef={fillR} peakRef={peakR} />
        <div className="flex flex-1 flex-col justify-between py-0.5 text-right font-mono text-[8px] text-white/25">
          <span>0</span>
          <span>-18</span>
          <span>-60</span>
        </div>
      </div>
    </div>
  );
}

// exported for reuse/testing by other meters that want consistent dB->color mapping
export { formatDb, zoneColor, dbToPercent };
