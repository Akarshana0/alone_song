"use client";

import { useEffect, useRef } from "react";
import { Transport } from "tone";
import { audioEngine } from "@/lib/audioEngine";
import { useDAWStore } from "@/store/useDAWStore";

/**
 * Mount once (in the top-level DAW page) to keep the AudioEngine in sync
 * with the Zustand store: bpm changes, metronome toggling, and the
 * playhead clock used to drive the timeline UI.
 */
export function useAudioEngine() {
  const bpm = useDAWStore((s) => s.bpm);
  const tempoEvents = useDAWStore((s) => s.tempoEvents);
  const metronomeOn = useDAWStore((s) => s.metronomeOn);
  const isPlaying = useDAWStore((s) => s.isPlaying);
  const masterVolume = useDAWStore((s) => s.masterVolume);
  const setCurrentTime = useDAWStore((s) => s.setCurrentTime);
  const tracks = useDAWStore((s) => s.tracks);
  const buses = useDAWStore((s) => s.buses);
  const undo = useDAWStore((s) => s.undo);
  const redo = useDAWStore((s) => s.redo);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    audioEngine.setBpm(bpm);
  }, [bpm]);

  // Tempo Track / Time Signature Map: re-schedule the bpm ramp whenever the
  // event list changes, or whenever playback (re)starts so a fresh run
  // always begins from event[0] rather than wherever the last run left off.
  useEffect(() => {
    audioEngine.applyTempoMap(tempoEvents, bpm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tempoEvents), isPlaying]);

  useEffect(() => {
    audioEngine.toggleMetronome(metronomeOn);
  }, [metronomeOn]);

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  // Recompute audible tracks whenever any track's mute/solo/volume changes.
  useEffect(() => {
    const allIds = tracks.map((t) => t.id);
    const soloedIds = tracks.filter((t) => t.solo).map((t) => t.id);
    const muted: Record<string, boolean> = {};
    const volumes: Record<string, number> = {};
    tracks.forEach((t) => {
      muted[t.id] = t.muted;
      volumes[t.id] = t.volume;
    });
    audioEngine.applySoloState(allIds, soloedIds, muted, volumes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => `${t.id}:${t.muted}:${t.solo}:${t.volume}`).join(",")]);

  // Create/dispose engine bus nodes to match the store's bus list.
  const busIdsKey = buses.map((b) => b.id).join(",");
  useEffect(() => {
    const currentIds = new Set(buses.map((b) => b.id));
    buses.forEach((b) => audioEngine.createBus(b.id));
    audioEngine.getBusIds().forEach((id) => {
      if (!currentIds.has(id)) audioEngine.disposeBus(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busIdsKey]);

  // Keep bus volume/pan/mute/solo synced, and recompute audible buses.
  useEffect(() => {
    buses.forEach((b) => {
      audioEngine.setBusVolume(b.id, b.volume);
      audioEngine.setBusPan(b.id, b.pan);
    });
    const allIds = buses.map((b) => b.id);
    const soloedIds = buses.filter((b) => b.solo).map((b) => b.id);
    const muted: Record<string, boolean> = {};
    const volumes: Record<string, number> = {};
    buses.forEach((b) => {
      muted[b.id] = b.muted;
      volumes[b.id] = b.volume;
    });
    audioEngine.applyBusSoloState(allIds, soloedIds, muted, volumes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buses.map((b) => `${b.id}:${b.volume}:${b.pan}:${b.muted}:${b.solo}`).join(",")]);

  // Route each track into its assigned bus (or back to master).
  useEffect(() => {
    tracks.forEach((t) => audioEngine.routeTrackToBus(t.id, t.busId ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => `${t.id}:${t.busId ?? "master"}`).join(","), busIdsKey]);

  // Push automation lanes (volume/pan curves) into the engine; actual
  // scheduling against Tone.Transport happens on play.
  useEffect(() => {
    tracks.forEach((t) => audioEngine.setTrackAutomation(t.id, t.automation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => `${t.id}:${JSON.stringify(t.automation)}`).join(",")]);

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Workflow: Input Monitoring — live mic passthrough is active whenever
  // some track is both armed and monitor-enabled.
  const monitorKey = tracks.map((t) => `${t.id}:${t.armed}:${t.monitorEnabled}`).join(",");
  useEffect(() => {
    const active = tracks.some((t) => t.armed && t.monitorEnabled);
    audioEngine.setMonitorActive(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorKey]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      setCurrentTime(Transport.seconds);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, setCurrentTime]);

  return { audioEngine };
}
