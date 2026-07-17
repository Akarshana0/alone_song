"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";
import { useDAWStore } from "@/store/useDAWStore";

/**
 * Master-bus spectrum analyzer. Reads FFT bins (in dB) from the AudioEngine's
 * analyser tap every animation frame and draws a log-scaled bar graph on a
 * canvas — no extra DSP, just Tone.Analyser("fft") + canvas as planned.
 */
export default function SpectrumAnalyzer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const isPlaying = useDAWStore((s) => s.isPlaying);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const minDb = -100;
    const maxDb = 0;
    const sampleRate = 48000; // Tone's context default; only used to place the axis labels

    const draw = () => {
      const bins = audioEngine.getMasterSpectrum();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // subtle grid to match the app's grid-fade background
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      if (bins.length > 1) {
        const n = bins.length;
        // Log-scale bin -> x position so low end (bass) isn't crushed into a sliver.
        const barCount = Math.min(96, n);
        const barWidth = w / barCount;
        const nyquist = sampleRate / 2;

        for (let i = 0; i < barCount; i++) {
          const t0 = i / barCount;
          const t1 = (i + 1) / barCount;
          // map [0,1] log-ish across the bin range, skipping bin 0 (DC)
          const startBin = Math.max(1, Math.floor(Math.pow(n, t0)));
          const endBin = Math.max(startBin + 1, Math.floor(Math.pow(n, t1)));
          let peak = -Infinity;
          for (let b = startBin; b < Math.min(endBin, n); b++) {
            if (bins[b] > peak) peak = bins[b];
          }
          if (!isFinite(peak)) peak = minDb;
          const norm = Math.max(0, Math.min(1, (peak - minDb) / (maxDb - minDb)));
          const barH = norm * h;

          const hue = 185 - norm * 140; // cyan (185) -> pink/violet as level rises
          ctx.fillStyle = `hsla(${hue}, 90%, 60%, ${0.35 + norm * 0.55})`;
          ctx.fillRect(i * barWidth, h - barH, Math.max(1, barWidth - 1), barH);
        }
        void nyquist;
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-void-700 bg-void-850 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">
          Spectrum
        </span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isPlaying ? "bg-neon-cyan shadow-neon-cyan animate-pulseGlow" : "bg-white/15"
          }`}
        />
      </div>
      <canvas
        ref={canvasRef}
        className="h-24 w-full rounded bg-void-950"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="flex justify-between text-[8px] font-mono text-white/25">
        <span>20Hz</span>
        <span>1kHz</span>
        <span>20kHz</span>
      </div>
    </div>
  );
}
