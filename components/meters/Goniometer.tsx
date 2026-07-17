"use client";

import { useEffect, useRef } from "react";
import { audioEngine } from "@/lib/audioEngine";
import { useDAWStore } from "@/store/useDAWStore";

const SQRT_HALF = Math.SQRT1_2;

/**
 * Classic 45°-rotated goniometer (vectorscope): plots mid = (L+R)/√2 on the
 * vertical axis and side = (R-L)/√2 on the horizontal axis, so a mono signal
 * draws a vertical line and a fully out-of-phase signal draws a horizontal
 * line. Reads the same L/R waveform taps as the Phase Correlation and True
 * Peak meters. Uses a translucent clear each frame for a phosphor-trail look.
 */
export default function Goniometer() {
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

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) / 2.4;

      // Phosphor-style trail: paint a translucent layer instead of a hard clear.
      ctx.fillStyle = "rgba(8,8,11,0.35)";
      ctx.fillRect(0, 0, w, h);

      // Reference cross + circle
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, scale, 0, Math.PI * 2);
      ctx.stroke();

      const { left, right } = audioEngine.getMasterStereoWaveforms();
      const n = Math.min(left.length, right.length);

      if (n > 1) {
        ctx.fillStyle = "#3ee6e0";
        // Downsample: plotting every sample at 60fps is more density than the
        // eye needs and costs more than it's worth, so stride through the buffer.
        const stride = 3;
        for (let i = 0; i < n; i += stride) {
          const mid = (left[i] + right[i]) * SQRT_HALF;
          const side = (right[i] - left[i]) * SQRT_HALF;
          const x = cx + side * scale;
          const y = cy - mid * scale;
          const mag = Math.min(1, Math.abs(left[i]) + Math.abs(right[i]));
          ctx.globalAlpha = 0.25 + mag * 0.6;
          ctx.fillRect(x, y, 1.5 * dpr, 1.5 * dpr);
        }
        ctx.globalAlpha = 1;
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider text-white/40">Goniometer</span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isPlaying ? "bg-neon-cyan shadow-neon-cyan animate-pulseGlow" : "bg-white/15"
          }`}
        />
      </div>
      <canvas ref={canvasRef} className="aspect-square w-full rounded bg-void-950" />
      <div className="flex justify-between text-[8px] font-mono text-white/25">
        <span>M</span>
        <span>vertical = mono · horizontal = side</span>
      </div>
    </div>
  );
}
