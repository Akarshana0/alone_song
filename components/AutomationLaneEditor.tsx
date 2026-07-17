"use client";

import { useRef, useState } from "react";
import type { AutomationLane, AutomationPoint } from "@/lib/audioEngine";

interface Props {
  label: string;
  color: string;
  lane: AutomationLane;
  duration: number;
  min: number;
  max: number;
  defaultValue: number;
  formatValue: (v: number) => string;
  onToggle: () => void;
  onAddPoint: (time: number, value: number) => void;
  onMovePoint: (id: string, time: number, value: number) => void;
  onRemovePoint: (id: string) => void;
  onClear: () => void;
}

/**
 * A small breakpoint-envelope editor for one automation lane (volume or
 * pan). Click empty space to drop a point, drag a point to move it,
 * double-click a point to delete it. Coordinates are purely percentage
 * based (time -> x%, value -> y%) so it doesn't need to match wavesurfer's
 * internal waveform scaling — it just fills the same-width container.
 */
export default function AutomationLaneEditor({
  label,
  color,
  lane,
  duration,
  min,
  max,
  defaultValue,
  formatValue,
  onToggle,
  onAddPoint,
  onMovePoint,
  onRemovePoint,
  onClear,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingId = useRef<string | null>(null);
  const [hoverValue, setHoverValue] = useState<string | null>(null);

  const toPercent = (p: AutomationPoint) => {
    const xPct = duration > 0 ? Math.min(100, Math.max(0, (p.time / duration) * 100)) : 0;
    const yPct = 100 - Math.min(100, Math.max(0, ((p.value - min) / (max - min)) * 100));
    return { xPct, yPct };
  };

  const fromClientPos = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { time: 0, value: defaultValue };
    const xFrac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const yFrac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { time: xFrac * duration, value: min + (1 - yFrac) * (max - min) };
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!lane.enabled || duration <= 0) return;
    if ((e.target as HTMLElement).dataset.point) return;
    const { time, value } = fromClientPos(e.clientX, e.clientY);
    onAddPoint(time, value);
  };

  const handlePointMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    draggingId.current = id;
    const move = (ev: MouseEvent) => {
      if (!draggingId.current) return;
      const { time, value } = fromClientPos(ev.clientX, ev.clientY);
      onMovePoint(draggingId.current, time, value);
      setHoverValue(formatValue(value));
    };
    const up = () => {
      draggingId.current = null;
      setHoverValue(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const sorted = [...lane.points].sort((a, b) => a.time - b.time);
  const polylinePoints = sorted
    .map((p) => {
      const { xPct, yPct } = toPercent(p);
      return `${xPct},${yPct}`;
    })
    .join(" ");
  const defaultLineTop = 100 - ((defaultValue - min) / (max - min)) * 100;

  return (
    <div className="mt-1 rounded-md border border-void-700 bg-void-950/60 p-2">
      <div className="mb-1 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          <input
            type="checkbox"
            checked={lane.enabled}
            onChange={onToggle}
            className="accent-current"
            style={{ color }}
          />
          {label} automation
        </label>
        <div className="flex items-center gap-2">
          {hoverValue && <span className="font-mono text-[10px] text-white/50">{hoverValue}</span>}
          {sorted.length > 0 && (
            <button
              onClick={onClear}
              className="text-[10px] text-white/30 transition hover:text-neon-red"
              title="Clear all points"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        onClick={handleContainerClick}
        className={`relative h-14 w-full overflow-hidden rounded ${
          lane.enabled ? "cursor-crosshair bg-void-900" : "cursor-not-allowed bg-void-900/40 opacity-50"
        }`}
      >
        <div
          className="absolute left-0 right-0 border-t border-dashed border-white/10"
          style={{ top: `${defaultLineTop}%` }}
        />

        {sorted.length > 0 && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={polylinePoints} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {sorted.map((p) => {
          const { xPct, yPct } = toPercent(p);
          return (
            <div
              key={p.id}
              data-point="true"
              onMouseDown={(e) => handlePointMouseDown(e, p.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onRemovePoint(p.id);
              }}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border border-white/70 shadow-sm active:cursor-grabbing"
              style={{ left: `${xPct}%`, top: `${yPct}%`, background: color }}
              title={`${p.time.toFixed(2)}s — ${formatValue(p.value)} (double-click to remove)`}
            />
          );
        })}

        {lane.enabled && sorted.length === 0 && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-white/25">
            {duration > 0 ? "Click to add automation points" : "Load audio first"}
          </span>
        )}
      </div>
    </div>
  );
}
