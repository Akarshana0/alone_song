"use client";

import { Play, Pause, Square, Circle, Timer, SkipBack, Repeat } from "lucide-react";
import clsx from "clsx";
import { useDAWStore } from "@/store/useDAWStore";
import { audioEngine } from "@/lib/audioEngine";

function formatTime(t: number) {
  const m = Math.floor(t / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((t % 1) * 100)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}.${ms}`;
}

export default function Transport() {
  const isPlaying = useDAWStore((s) => s.isPlaying);
  const isRecording = useDAWStore((s) => s.isRecording);
  const metronomeOn = useDAWStore((s) => s.metronomeOn);
  const currentTime = useDAWStore((s) => s.currentTime);
  const loopEnabled = useDAWStore((s) => s.loopEnabled);
  const punchEnabled = useDAWStore((s) => s.punchEnabled);
  const play = useDAWStore((s) => s.play);
  const pause = useDAWStore((s) => s.pause);
  const stop = useDAWStore((s) => s.stop);
  const toggleMetronome = useDAWStore((s) => s.toggleMetronome);
  const seekPlayhead = useDAWStore((s) => s.seekPlayhead);
  const toggleLoop = useDAWStore((s) => s.toggleLoop);
  const startRecording = useDAWStore((s) => s.startRecording);
  const stopRecording = useDAWStore((s) => s.stopRecording);
  const preRollBars = useDAWStore((s) => s.preRollBars);
  const setPreRollBars = useDAWStore((s) => s.setPreRollBars);

  const handlePlay = async () => {
    await audioEngine.start();
    audioEngine.playAll();
    play();
  };

  const handlePause = () => {
    audioEngine.pauseAll();
    pause();
  };

  const handleStop = () => {
    audioEngine.stopAll();
    stop();
  };

  const handleRewind = () => {
    seekPlayhead(0);
    if (!useDAWStore.getState().isPlaying) stop();
  };

  const handleRecordToggle = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-void-700 bg-void-900 px-4">
      <div className="flex items-center gap-2">
        <button
          onClick={handleRewind}
          className="rounded-md border border-void-600 bg-void-850 p-2 text-white/60 transition hover:text-neon-cyan"
          title="Rewind to start"
        >
          <SkipBack size={16} />
        </button>

        {!isPlaying ? (
          <button
            onClick={handlePlay}
            className="rounded-md border border-neon-cyan/50 bg-neon-cyan/10 p-2 text-neon-cyan shadow-neon-cyan transition hover:bg-neon-cyan/20"
            title="Play"
          >
            <Play size={18} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="rounded-md border border-neon-amber/50 bg-neon-amber/10 p-2 text-neon-amber shadow-neon-amber transition hover:bg-neon-amber/20"
            title="Pause"
          >
            <Pause size={18} fill="currentColor" />
          </button>
        )}

        <button
          onClick={handleStop}
          className="rounded-md border border-void-600 bg-void-850 p-2 text-white/60 transition hover:text-white"
          title="Stop"
        >
          <Square size={16} fill="currentColor" />
        </button>

        <button
          onClick={handleRecordToggle}
          className={clsx(
            "rounded-md border p-2 transition",
            isRecording
              ? "border-neon-red/60 bg-neon-red/10 text-neon-red animate-pulseGlow"
              : "border-void-600 bg-void-850 text-white/60 hover:text-neon-red"
          )}
          title={punchEnabled ? "Record (Punch-in/out armed)" : loopEnabled ? "Record (Loop Comping armed)" : "Record"}
        >
          <Circle size={16} fill={isRecording ? "currentColor" : "none"} />
        </button>

        <div className="mx-2 h-8 w-px bg-void-700" />

        <button
          onClick={toggleMetronome}
          className={clsx(
            "flex items-center gap-1.5 rounded-md border p-2 text-xs transition",
            metronomeOn
              ? "border-neon-violet/50 bg-neon-violet/10 text-neon-violet"
              : "border-void-600 bg-void-850 text-white/60 hover:text-white"
          )}
          title="Metronome"
        >
          <Timer size={16} />
          <span className="hidden sm:inline">Metro</span>
        </button>

        <button
          onClick={toggleLoop}
          className={clsx(
            "flex items-center gap-1.5 rounded-md border p-2 text-xs transition",
            loopEnabled
              ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan"
              : "border-void-600 bg-void-850 text-white/60 hover:text-white"
          )}
          title="Loop Comping — set the region in the workflow bar below"
        >
          <Repeat size={16} />
          <span className="hidden sm:inline">Loop</span>
        </button>

        {/* Pre-roll: bars of metronome count-in before recording actually
            starts (0 = off). Only affects the plain free-record path. */}
        <label
          className={clsx(
            "flex items-center gap-1.5 rounded-md border p-2 text-xs transition",
            preRollBars > 0
              ? "border-neon-violet/50 bg-neon-violet/10 text-neon-violet"
              : "border-void-600 bg-void-850 text-white/60"
          )}
          title="Pre-roll — bars of count-in before recording starts"
        >
          <span className="hidden sm:inline">Pre-roll</span>
          <select
            value={preRollBars}
            onChange={(e) => setPreRollBars(Number(e.target.value))}
            className="bg-transparent text-xs outline-none"
          >
            <option value={0}>Off</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
            <option value={4}>4 bars</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-void-600 bg-void-850 px-4 py-2 font-mono text-xl tracking-wider text-neon-cyan">
        {formatTime(currentTime)}
      </div>
    </div>
  );
}
