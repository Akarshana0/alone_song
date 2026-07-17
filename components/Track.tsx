"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Volume2, VolumeX, Headphones, Mic, Upload, Trash2, SlidersHorizontal, FlipHorizontal2, Gauge, X, Activity, Plug, Grid2x2, Waves, Snowflake, Folder, FolderOpen, ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { Track as TrackType, useDAWStore } from "@/store/useDAWStore";
import { audioEngine, applyArpeggiator } from "@/lib/audioEngine";
import FXRack from "./FXRack";
import AutomationLaneEditor from "./AutomationLaneEditor";
import PianoRoll from "./PianoRoll";
import PluginRack from "./PluginRack";
import PadSlicer from "./PadSlicer";
import WarpEditor from "./WarpEditor";

export default function Track({ track }: { track: TrackType }) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [warpOpen, setWarpOpen] = useState(false);
  const bpm = useDAWStore((s) => s.bpm);
  const padSlicerTrackId = useDAWStore((s) => s.padSlicerTrackId);
  const togglePadSlicer = useDAWStore((s) => s.togglePadSlicer);
  const triggerTapeStop = useDAWStore((s) => s.triggerTapeStop);
  const triggerTapeStart = useDAWStore((s) => s.triggerTapeStart);

  const selectedTrackId = useDAWStore((s) => s.selectedTrackId);
  const selectTrack = useDAWStore((s) => s.selectTrack);
  const loadFileToTrack = useDAWStore((s) => s.loadFileToTrack);
  const toggleMute = useDAWStore((s) => s.toggleMute);
  const toggleSolo = useDAWStore((s) => s.toggleSolo);
  const toggleArm = useDAWStore((s) => s.toggleArm);
  const removeTrack = useDAWStore((s) => s.removeTrack);
  const renameTrack = useDAWStore((s) => s.renameTrack);
  const toggleReverse = useDAWStore((s) => s.toggleReverse);
  const updateTrackEffects = useDAWStore((s) => s.updateTrackEffects);
  const applyTimeStretch = useDAWStore((s) => s.applyTimeStretch);
  const applyNoiseReduction = useDAWStore((s) => s.applyNoiseReduction);
  const applyDeClick = useDAWStore((s) => s.applyDeClick);
  const applyDeClip = useDAWStore((s) => s.applyDeClip);
  const applyDeReverb = useDAWStore((s) => s.applyDeReverb);
  const applyDcOffsetRemoval = useDAWStore((s) => s.applyDcOffsetRemoval);
  const selection = useDAWStore((s) => s.selection);
  const setSelection = useDAWStore((s) => s.setSelection);
  const clearSelection = useDAWStore((s) => s.clearSelection);
  const buses = useDAWStore((s) => s.buses);
  const assignTrackToBus = useDAWStore((s) => s.assignTrackToBus);
  const toggleAutomationLane = useDAWStore((s) => s.toggleAutomationLane);
  const addAutomationPoint = useDAWStore((s) => s.addAutomationPoint);
  const moveAutomationPoint = useDAWStore((s) => s.moveAutomationPoint);
  const removeAutomationPoint = useDAWStore((s) => s.removeAutomationPoint);
  const clearAutomationLane = useDAWStore((s) => s.clearAutomationLane);
  const allTracks = useDAWStore((s) => s.tracks);
  const groups = useDAWStore((s) => s.groups);
  const addGroup = useDAWStore((s) => s.addGroup);
  const setTrackGroup = useDAWStore((s) => s.setTrackGroup);
  const nudgeTrack = useDAWStore((s) => s.nudgeTrack);
  const toggleMonitor = useDAWStore((s) => s.toggleMonitor);
  const applyTake = useDAWStore((s) => s.applyTake);
  const removeTake = useDAWStore((s) => s.removeTake);
  const freezeTrack = useDAWStore((s) => s.freezeTrack);
  const unfreezeTrack = useDAWStore((s) => s.unfreezeTrack);
  const toggleFolderCollapse = useDAWStore((s) => s.toggleFolderCollapse);
  const setTrackParent = useDAWStore((s) => s.setTrackParent);
  const [freezing, setFreezing] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const isSelected = selectedTrackId === track.id;
  const mySelection = selection && selection.trackId === track.id ? selection : null;

  // Initialize / re-initialize wavesurfer whenever the track gets a file.
  useEffect(() => {
    if (!waveformRef.current || !track.fileUrl) return;

    setLoading(true);
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: `${track.color}55`,
      progressColor: track.color,
      cursorColor: "#ffffff",
      height: 64,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      url: track.fileUrl,
    });

    // Regions plugin drives the Cut/Copy/Trim/Split/Silence selection: drag
    // across the waveform to mark a range, which is mirrored into the store.
    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsRef.current = regions;
    regions.enableDragSelection({
      color: `${track.color}33`,
    });

    const syncRegion = (region: Region) => {
      // Only one active selection per track — drop any older region.
      regions.getRegions().forEach((r) => {
        if (r.id !== region.id) r.remove();
      });
      const snapTime = useDAWStore.getState().snapTime;
      setSelection({ trackId: track.id, start: snapTime(region.start), end: snapTime(region.end) });
    };
    regions.on("region-created", syncRegion);
    regions.on("region-updated", syncRegion);
    regions.on("region-removed", () => {
      if (useDAWStore.getState().selection?.trackId === track.id) clearSelection();
    });

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setLoading(false);
    });

    wavesurferRef.current = ws;

    // Feed the same file into the Tone.js engine chain for playback/mixing.
    audioEngine.loadTrack(track.id, track.fileUrl, track.effects.reversed).catch(() => {});

    return () => {
      ws.destroy();
      regionsRef.current = null;
      audioEngine.disposeTrack(track.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.fileUrl, track.effects.reversed]);

  // If the selection for this track was cleared elsewhere (e.g. after a
  // Cut/Trim tool ran, or the user hit the clear button), drop the visual
  // region too so the waveform doesn't show a stale highlight.
  useEffect(() => {
    if (mySelection) return;
    regionsRef.current?.getRegions().forEach((r) => r.remove());
  }, [mySelection]);

  // Keep engine volume/pan in sync with store.
  useEffect(() => {
    audioEngine.setVolume(track.id, track.muted ? 0 : track.volume);
  }, [track.id, track.volume, track.muted]);

  useEffect(() => {
    audioEngine.setPan(track.id, track.pan);
  }, [track.id, track.pan]);

  // Push the entire per-track effects chain into the engine whenever any
  // parameter changes. Cheap no-op sets are fine here since Tone.js params
  // just get re-assigned.
  useEffect(() => {
    const fx = track.effects;
    audioEngine.setFades(track.id, fx.fadeIn, fx.fadeOut, fx.fadeInCurve, fx.fadeOutCurve);
    audioEngine.setGate(track.id, fx.gate.enabled, fx.gate.threshold);
    audioEngine.setEQ(track.id, fx.eq.low, fx.eq.mid, fx.eq.high);
    audioEngine.setDynamicEq(track.id, fx.dynamicEq.enabled, fx.dynamicEq.low, fx.dynamicEq.mid, fx.dynamicEq.high, fx.dynamicEq.wet);
    audioEngine.setFilter(track.id, fx.filter.enabled, fx.filter.type, fx.filter.frequency, fx.filter.q);
    audioEngine.setCompressor(
      track.id, fx.compressor.enabled, fx.compressor.threshold, fx.compressor.ratio,
      fx.compressor.attack, fx.compressor.release, fx.compressor.knee
    );
    audioEngine.setLimiter(track.id, fx.limiter.enabled, fx.limiter.threshold);
    audioEngine.setExpander(track.id, fx.expander.enabled, fx.expander.threshold);
    audioEngine.setDeEsser(track.id, fx.deEsser.enabled, fx.deEsser.frequency, fx.deEsser.reduction);
    audioEngine.setDistortion(track.id, fx.distortion.enabled, fx.distortion.amount);
    audioEngine.setSaturation(track.id, fx.saturation.enabled, fx.saturation.amount);
    audioEngine.setBitcrusher(track.id, fx.bitcrusher.enabled, fx.bitcrusher.bits);
    audioEngine.setChorus(track.id, fx.chorus.enabled, fx.chorus.frequency, fx.chorus.depth, fx.chorus.wet);
    audioEngine.setFlanger(track.id, fx.flanger.enabled, fx.flanger.rate, fx.flanger.depth, fx.flanger.feedback, fx.flanger.wet);
    audioEngine.setModLfo(track.id, fx.modLfo.enabled, fx.modLfo.target, fx.modLfo.shape, fx.modLfo.rate, fx.modLfo.depth);
    audioEngine.setPhaser(track.id, fx.phaser.enabled, fx.phaser.frequency, fx.phaser.octaves, fx.phaser.baseFrequency, fx.phaser.wet);
    audioEngine.setTremolo(track.id, fx.tremolo.enabled, fx.tremolo.frequency, fx.tremolo.depth, fx.tremolo.wet);
    audioEngine.setVibrato(track.id, fx.vibrato.enabled, fx.vibrato.frequency, fx.vibrato.depth, fx.vibrato.wet);
    audioEngine.setPitchShift(track.id, fx.pitchShift.enabled, fx.pitchShift.semitones, fx.pitchShift.wet);
    audioEngine.setAutoTune(track.id, fx.autoTune.enabled, fx.autoTune.key, fx.autoTune.scale, fx.autoTune.retune, fx.autoTune.wet);
    audioEngine.setHarmonizer(track.id, fx.harmonizer.enabled, fx.harmonizer.voice1, fx.harmonizer.voice1Wet, fx.harmonizer.voice2, fx.harmonizer.voice2Wet);
    audioEngine.setVocoder(track.id, fx.vocoder.enabled, fx.vocoder.carrier, fx.vocoder.carrierNote, fx.vocoder.wet);
    audioEngine.setDelay(track.id, fx.delay.enabled, fx.delay.time, fx.delay.feedback, fx.delay.wet);
    audioEngine.setReverb(track.id, fx.reverb.enabled, fx.reverb.decay, fx.reverb.wet);
    audioEngine.setSidechain(track.id, fx.sidechain.enabled, fx.sidechain.sourceTrackId, fx.sidechain.amount);
    audioEngine.setMultibandCompressor(
      track.id, fx.multibandCompressor.enabled, fx.multibandCompressor.lowFreq, fx.multibandCompressor.highFreq,
      fx.multibandCompressor.low, fx.multibandCompressor.mid, fx.multibandCompressor.high
    );
    audioEngine.setTransientShaper(track.id, fx.transientShaper.enabled, fx.transientShaper.attack, fx.transientShaper.sustain);
    audioEngine.setStereoImager(track.id, fx.stereoImager.enabled, fx.stereoImager.width);
    audioEngine.setExciter(track.id, fx.exciter.enabled, fx.exciter.frequency, fx.exciter.amount, fx.exciter.wet);
    audioEngine.setFormantShift(track.id, fx.formantShift.enabled, fx.formantShift.shift, fx.formantShift.wet);
    audioEngine.setConvolutionReverb(track.id, fx.convolutionReverb.enabled, fx.convolutionReverb.irType, fx.convolutionReverb.wet);
    audioEngine.setRingMod(track.id, fx.ringMod.enabled, fx.ringMod.frequency, fx.ringMod.wet);
    audioEngine.setPolarity(track.id, fx.polarityInverted);
    audioEngine.setSpatial(track.id, fx.spatial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, JSON.stringify(track.effects)]);

  // Workflow: Nudge — push the current offset to the engine whenever it
  // changes (dragging the nudge buttons, undo/redo, project load, etc.).
  useEffect(() => {
    audioEngine.setTrackNudge(track.id, track.nudge);
  }, [track.id, track.nudge]);

  // MIDI tracks run through a parallel PolySynth engine (see loadMidiTrack)
  // instead of the wavesurfer/Player chain above. Mount the synth once per
  // track, tear it down on unmount, and keep it in sync with the piano roll.
  useEffect(() => {
    if (track.kind !== "midi") return;
    audioEngine.loadMidiTrack(track.id, track.instrument, track.instrumentEngine);
    return () => audioEngine.disposeMidiTrack(track.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.kind, track.instrumentEngine]);

  useEffect(() => {
    if (track.kind !== "midi" || track.instrumentEngine !== "subtractive") return;
    audioEngine.setMidiInstrument(track.id, track.instrument);
  }, [track.id, track.kind, track.instrument, track.instrumentEngine]);

  useEffect(() => {
    if (track.kind !== "midi" || track.instrumentEngine !== "wavetable") return;
    audioEngine.setWavetablePosition(track.id, track.wavetable.position);
  }, [track.id, track.kind, track.instrumentEngine, track.wavetable.position]);

  useEffect(() => {
    if (track.kind !== "midi" || track.instrumentEngine !== "granular" || !track.granular.sampleUrl) return;
    audioEngine.loadGranularSample(track.id, track.granular.sampleUrl).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.kind, track.instrumentEngine, track.granular.sampleUrl]);

  // Arpeggiator: transforms a copy of the raw notes before scheduling, so
  // the piano roll itself always shows what was actually drawn/played.
  useEffect(() => {
    if (track.kind !== "midi") return;
    const notes = track.arpeggiator.enabled ? applyArpeggiator(track.notes, bpm, track.arpeggiator) : track.notes;
    audioEngine.scheduleMidiTrack(track.id, notes, track.granular);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.kind, JSON.stringify(track.notes), JSON.stringify(track.arpeggiator), bpm, track.instrumentEngine, JSON.stringify(track.granular)]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFileToTrack(track.id, file);
  };

  return (
    <div
      onClick={() => selectTrack(track.id)}
      className={clsx(
        "flex border-b border-void-700 transition",
        isSelected ? "bg-void-800/70" : "bg-void-900/40 hover:bg-void-850"
      )}
      style={{ borderLeft: `3px solid ${track.color}`, marginLeft: track.parentId ? 16 : 0 }}
    >
      {/* Track header / controls */}
      <div className="flex w-48 shrink-0 flex-col justify-between gap-2 border-r border-void-700 p-3">
        <div className="flex items-center justify-between">
          {track.isFolder && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFolderCollapse(track.id);
              }}
              className="text-white/50 transition hover:text-white"
              title={track.collapsed ? "Expand folder" : "Collapse folder"}
            >
              {track.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          {track.isFolder ? (
            track.collapsed ? <Folder size={12} className="text-white/50" /> : <FolderOpen size={12} className="text-white/50" />
          ) : null}
          <input
            value={track.name}
            onChange={(e) => renameTrack(track.id, e.target.value)}
            className="w-28 truncate bg-transparent text-sm font-semibold text-white/90 outline-none focus:border-b focus:border-neon-cyan"
          />
          <div className="flex items-center gap-1.5">
            {!track.isFolder && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (track.frozen) {
                    unfreezeTrack(track.id);
                  } else {
                    setFreezing(true);
                    await freezeTrack(track.id);
                    setFreezing(false);
                  }
                }}
                disabled={freezing}
                className={clsx(
                  "transition",
                  track.frozen ? "text-neon-cyan" : "text-white/30 hover:text-neon-cyan",
                  freezing && "animate-pulse"
                )}
                title={track.frozen ? "Unfreeze track" : "Freeze track / Bounce to Audio"}
              >
                <Snowflake size={13} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTrack(track.id);
              }}
              className="text-white/30 transition hover:text-neon-red"
              title="Delete track"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Folder Tracks (nested): file this track into a folder, or lift
            it back out to the top level with "No folder". */}
        <select
          value={track.parentId ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setTrackParent(track.id, e.target.value || null)}
          className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/50"
        >
          <option value="">No folder</option>
          {allTracks.filter((t) => t.isFolder && t.id !== track.id).map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>

        <select
          value={track.busId ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => assignTrackToBus(track.id, e.target.value || null)}
          className="w-full rounded border border-void-700 bg-void-850 px-1.5 py-1 text-[10px] text-white/60 outline-none focus:border-neon-cyan/50"
          title="Route to bus"
        >
          <option value="">→ Master</option>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              → {b.name}
            </option>
          ))}
        </select>

        {/* Workflow: Track Grouping — join an existing group or spin up a
            new one; group-level Mute/Solo lives in the Groups strip above
            the track list. */}
        {groupPickerOpen ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const name = newGroupName.trim();
                if (!name) return;
                const id = addGroup(name);
                setTrackGroup(track.id, id);
                setNewGroupName("");
                setGroupPickerOpen(false);
              }}
              placeholder="New group name…"
              className="w-full rounded border border-void-700 bg-void-850 px-1.5 py-1 text-[10px] text-white/70 outline-none focus:border-neon-violet/50"
            />
            <button
              onClick={() => setGroupPickerOpen(false)}
              className="text-white/30 transition hover:text-neon-red"
              title="Cancel"
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <select
            value={track.groupId ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                setGroupPickerOpen(true);
                return;
              }
              setTrackGroup(track.id, e.target.value || null);
            }}
            className="w-full rounded border border-void-700 bg-void-850 px-1.5 py-1 text-[10px] outline-none focus:border-neon-violet/50"
            style={{ color: groups.find((g) => g.id === track.groupId)?.color }}
            title="Track group"
          >
            <option value="" className="text-white/60">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id} style={{ color: g.color }}>
                ● {g.name}
              </option>
            ))}
            <option value="__new__" className="text-white/60">+ New group…</option>
          </select>
        )}

        {/* Workflow: Nudge — shift this track's playback earlier/later
            without touching the audio itself; step follows the snap grid. */}
        <div className="flex items-center justify-between gap-1 text-[10px] text-white/40" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => nudgeTrack(track.id, -1)}
            className="rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-white/60 transition hover:border-neon-amber/50 hover:text-neon-amber"
            title="Nudge earlier"
          >
            ◀
          </button>
          <span className="font-mono" title="Playback offset">
            {track.nudge === 0 ? "0.000s" : `${track.nudge > 0 ? "+" : ""}${track.nudge.toFixed(3)}s`}
          </span>
          <button
            onClick={() => nudgeTrack(track.id, 1)}
            className="rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-white/60 transition hover:border-neon-amber/50 hover:text-neon-amber"
            title="Nudge later"
          >
            ▶
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMute(track.id);
            }}
            className={clsx(
              "rounded p-1.5 text-[11px] font-bold transition",
              track.muted
                ? "bg-neon-red/20 text-neon-red"
                : "bg-void-800 text-white/50 hover:text-white"
            )}
            title="Mute"
          >
            {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSolo(track.id);
            }}
            className={clsx(
              "rounded px-1.5 py-1 text-[11px] font-bold transition",
              track.solo
                ? "bg-neon-amber/20 text-neon-amber"
                : "bg-void-800 text-white/50 hover:text-white"
            )}
            title="Solo"
          >
            <Headphones size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleArm(track.id);
            }}
            className={clsx(
              "rounded p-1.5 text-[11px] font-bold transition",
              track.armed
                ? "bg-neon-red/20 text-neon-red animate-pulseGlow"
                : "bg-void-800 text-white/50 hover:text-white"
            )}
            title="Arm for recording"
          >
            <Mic size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMonitor(track.id);
            }}
            className={clsx(
              "rounded p-1.5 text-[11px] font-bold transition",
              track.monitorEnabled
                ? "bg-neon-cyan/20 text-neon-cyan"
                : "bg-void-800 text-white/50 hover:text-white"
            )}
            title="Input Monitoring — hear the live mic while armed"
          >
            <Headphones size={13} className={track.monitorEnabled ? "" : "opacity-50"} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFxOpen((o) => !o);
            }}
            className={clsx(
              "rounded p-1.5 text-[11px] font-bold transition",
              fxOpen ? "bg-neon-cyan/20 text-neon-cyan" : "bg-void-800 text-white/50 hover:text-white"
            )}
            title="FX Rack"
          >
            <SlidersHorizontal size={13} />
          </button>
          {track.kind === "audio" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPluginsOpen((o) => !o);
              }}
              className={clsx(
                "rounded p-1.5 text-[11px] font-bold transition",
                pluginsOpen ? "bg-neon-violet/20 text-neon-violet" : "bg-void-800 text-white/50 hover:text-white"
              )}
              title="Plugins (Web Audio Modules)"
            >
              <Plug size={13} />
            </button>
          )}
          {track.kind === "audio" && track.fileUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePadSlicer(padSlicerTrackId === track.id ? null : track.id);
              }}
              className={clsx(
                "rounded p-1.5 text-[11px] font-bold transition",
                padSlicerTrackId === track.id ? "bg-neon-amber/20 text-neon-amber" : "bg-void-800 text-white/50 hover:text-white"
              )}
              title="Sample Slicing (MPC-style pads)"
            >
              <Grid2x2 size={13} />
            </button>
          )}
          {track.kind === "audio" && track.fileUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setWarpOpen((o) => !o);
              }}
              className={clsx(
                "rounded p-1.5 text-[11px] font-bold transition",
                warpOpen ? "bg-neon-cyan/20 text-neon-cyan" : "bg-void-800 text-white/50 hover:text-white"
              )}
              title="Time Warping (elastic audio / warp markers)"
            >
              <Waves size={13} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAutomationOpen((o) => !o);
            }}
            className={clsx(
              "rounded p-1.5 text-[11px] font-bold transition",
              automationOpen ? "bg-neon-amber/20 text-neon-amber" : "bg-void-800 text-white/50 hover:text-white"
            )}
            title="Automation lines"
          >
            <Activity size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleReverse(track.id);
            }}
            className={clsx(
              "rounded p-1.5 text-[11px] font-bold transition",
              track.effects.reversed ? "bg-neon-violet/20 text-neon-violet" : "bg-void-800 text-white/50 hover:text-white"
            )}
            title="Reverse audio"
          >
            <FlipHorizontal2 size={13} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              audioEngine.normalize(track.id, -1);
            }}
            className="rounded p-1.5 text-[11px] font-bold bg-void-800 text-white/50 transition hover:text-white"
            title="Normalize to -1 dB peak"
          >
            <Gauge size={13} />
          </button>
        </div>
      </div>

      {/* Waveform + FX area */}
      <div className="flex flex-1 flex-col">
      <div className="relative flex flex-1 items-center px-3 py-2">
        {track.kind === "midi" ? (
          <PianoRoll track={track} />
        ) : !track.fileUrl ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-md border border-dashed border-void-600 text-xs text-white/40 transition hover:border-neon-cyan/50 hover:text-neon-cyan"
          >
            <Upload size={14} />
            Click to load an audio file
          </button>
        ) : (
          <div className="w-full">
            <div ref={waveformRef} className="w-full" />
            {loading && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] text-white/40">
                Decoding waveform…
              </span>
            )}
            {!loading && (
              <span className="absolute right-3 top-2 font-mono text-[10px] text-white/30">
                {duration.toFixed(2)}s
              </span>
            )}
            {mySelection && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearSelection();
                }}
                className="absolute left-3 top-2 flex items-center gap-1 rounded bg-void-950/80 px-1.5 py-0.5 font-mono text-[10px] text-neon-cyan"
                title="Clear selection"
              >
                {mySelection.start.toFixed(2)}s–{mySelection.end.toFixed(2)}s
                <X size={10} />
              </button>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Workflow: Loop Comping — passes recorded while looping land here as
          takes; pick the best one to become the track's real audio. */}
      {track.takes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-void-700 px-3 py-1.5">
          <span className="text-[10px] text-white/30">Takes:</span>
          {track.takes.map((take) => (
            <div
              key={take.id}
              className="flex items-center gap-1 rounded border border-void-700 bg-void-850 px-1.5 py-0.5 text-[10px] text-white/60"
            >
              <span>{take.label} · {take.duration.toFixed(2)}s</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  applyTake(track.id, take.id);
                }}
                className="text-neon-cyan/80 transition hover:text-neon-cyan"
                title="Use this take as the track's audio"
              >
                Use
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTake(track.id, take.id);
                }}
                className="text-white/30 transition hover:text-neon-red"
                title="Discard take"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {fxOpen && (
        <FXRack
          effects={track.effects}
          color={track.color}
          otherTracks={allTracks.filter((t) => t.id !== track.id).map((t) => ({ id: t.id, name: t.name }))}
          onChange={(updater) => updateTrackEffects(track.id, updater)}
          onApplyTimeStretch={(rate) => applyTimeStretch(track.id, rate)}
          onApplyNoiseReduction={(amount) => applyNoiseReduction(track.id, amount)}
          onApplyDeClick={(sensitivity) => applyDeClick(track.id, sensitivity)}
          onApplyDeClip={(threshold) => applyDeClip(track.id, threshold)}
          onApplyDeReverb={(amount) => applyDeReverb(track.id, amount)}
          onApplyDcOffsetRemoval={() => applyDcOffsetRemoval(track.id)}
          onTriggerTapeStop={() => triggerTapeStop(track.id)}
          onTriggerTapeStart={() => triggerTapeStart(track.id)}
        />
      )}
      {pluginsOpen && track.kind === "audio" && (
        <div className="border-t border-void-700 px-3 py-2">
          <PluginRack track={track} />
        </div>
      )}
      {padSlicerTrackId === track.id && track.kind === "audio" && track.fileUrl && (
        <div className="border-t border-void-700 px-3 py-2">
          <PadSlicer track={track} />
        </div>
      )}
      {warpOpen && track.kind === "audio" && track.fileUrl && (
        <div className="border-t border-void-700 px-3 py-2">
          <WarpEditor track={track} duration={duration} />
        </div>
      )}
      {automationOpen && (
        <div className="border-t border-void-700 px-3 py-2">
          <AutomationLaneEditor
            label="Volume"
            color={track.color}
            lane={track.automation.volume}
            duration={duration}
            min={0}
            max={1.2}
            defaultValue={track.volume}
            formatValue={(v) => `${Math.round(v * 100)}%`}
            onToggle={() => toggleAutomationLane(track.id, "volume")}
            onAddPoint={(time, value) => addAutomationPoint(track.id, "volume", time, value)}
            onMovePoint={(id, time, value) => moveAutomationPoint(track.id, "volume", id, time, value)}
            onRemovePoint={(id) => removeAutomationPoint(track.id, "volume", id)}
            onClear={() => clearAutomationLane(track.id, "volume")}
          />
          <AutomationLaneEditor
            label="Pan"
            color={track.color}
            lane={track.automation.pan}
            duration={duration}
            min={-1}
            max={1}
            defaultValue={track.pan}
            formatValue={(v) => (v === 0 ? "C" : v < 0 ? `L${Math.round(Math.abs(v) * 100)}` : `R${Math.round(v * 100)}`)}
            onToggle={() => toggleAutomationLane(track.id, "pan")}
            onAddPoint={(time, value) => addAutomationPoint(track.id, "pan", time, value)}
            onMovePoint={(id, time, value) => moveAutomationPoint(track.id, "pan", id, time, value)}
            onRemovePoint={(id) => removeAutomationPoint(track.id, "pan", id)}
            onClear={() => clearAutomationLane(track.id, "pan")}
          />
        </div>
      )}
      </div>
    </div>
  );
}
