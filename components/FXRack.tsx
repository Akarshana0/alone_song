"use client";

import { TrackEffectsSettings } from "@/lib/audioEngine";
import clsx from "clsx";
import { ReactNode } from "react";

interface FXRackProps {
  effects: TrackEffectsSettings;
  color: string;
  /** Other tracks in the project, for the Sidechain source picker. */
  otherTracks: { id: string; name: string }[];
  onChange: (updater: (fx: TrackEffectsSettings) => TrackEffectsSettings) => void;
  onApplyTimeStretch: (rate: number) => void;
  onApplyNoiseReduction: (amount: number) => void;
  onApplyDeClick: (sensitivity: number) => void;
  onApplyDeClip: (threshold: number) => void;
  onApplyDeReverb: (amount: number) => void;
  onApplyDcOffsetRemoval: () => void;
  onTriggerTapeStop: () => void;
  onTriggerTapeStart: () => void;
}

function Section({ title, enabled, onToggle, children }: {
  title: string;
  enabled?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-w-[190px] rounded-md border border-void-700 bg-void-850 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">{title}</span>
        {onToggle && (
          <button
            onClick={onToggle}
            className={clsx(
              "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase transition",
              enabled ? "bg-neon-cyan/20 text-neon-cyan" : "bg-void-800 text-white/30"
            )}
          >
            {enabled ? "On" : "Off"}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value, min, max, step, onChange, unit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[9px] text-white/40">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-white/50">
          {value.toFixed(step < 1 ? 2 : 0)}
          {unit ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fx-slider w-full"
      />
    </label>
  );
}

function OfflineToolBox({
  title,
  applyLabel,
  disabled,
  onApply,
  children,
}: {
  title: string;
  applyLabel: string;
  disabled?: boolean;
  onApply: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-w-[190px] rounded-md border border-void-700 bg-void-850 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">{title}</span>
        <span className="rounded bg-void-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white/30">
          Offline
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {children}
        <button
          onClick={onApply}
          disabled={disabled}
          className="mt-1 rounded bg-neon-cyan/15 px-2 py-1 text-[9px] font-bold uppercase text-neon-cyan transition hover:bg-neon-cyan/25 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {applyLabel}
        </button>
      </div>
    </div>
  );
}

export default function FXRack({
  effects,
  otherTracks,
  onChange,
  onApplyTimeStretch,
  onApplyNoiseReduction,
  onApplyDeClick,
  onApplyDeClip,
  onApplyDeReverb,
  onApplyDcOffsetRemoval,
  onTriggerTapeStop,
  onTriggerTapeStart,
}: FXRackProps) {
  const set = onChange;

  return (
    <div className="flex flex-wrap gap-2 border-t border-void-700 bg-void-900/60 p-3">
      <Section title="Fades">
        <Row label="Fade In" value={effects.fadeIn} min={0} max={5} step={0.05}
          onChange={(v) => set((fx) => ({ ...fx, fadeIn: v }))} unit="s" />
        <Row label="Fade Out" value={effects.fadeOut} min={0} max={5} step={0.05}
          onChange={(v) => set((fx) => ({ ...fx, fadeOut: v }))} unit="s" />
        {/* Crossfade curve — shapes how fade in/out taper (linear ramp vs a
            gentler equal-power-ish exponential curve, the shape typically
            used for clip-to-clip crossfades). */}
        <select
          value={effects.fadeInCurve}
          onChange={(e) => set((fx) => ({ ...fx, fadeInCurve: e.target.value as any, fadeOutCurve: e.target.value as any }))}
          className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
        >
          <option value="linear">Crossfade: Linear</option>
          <option value="equalPower">Crossfade: Equal Power</option>
          <option value="exponential">Crossfade: Exponential</option>
        </select>
      </Section>

      <div className="min-w-[190px] rounded-md border border-void-700 bg-void-850 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">Time Stretch</span>
          <span className="rounded bg-void-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white/30">
            Offline
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Row label="Rate" value={effects.timeStretch.rate} min={0.5} max={2} step={0.01}
            onChange={(v) => set((fx) => ({ ...fx, timeStretch: { rate: v } }))} unit="x" />
          <button
            onClick={() => onApplyTimeStretch(effects.timeStretch.rate)}
            disabled={effects.timeStretch.rate === 1}
            className="mt-1 rounded bg-neon-cyan/15 px-2 py-1 text-[9px] font-bold uppercase text-neon-cyan transition hover:bg-neon-cyan/25 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Apply (WSOLA, pitch kept)
          </button>
        </div>
      </div>

      <OfflineToolBox
        title="Noise Reduction"
        applyLabel="Apply (spectral subtraction)"
        onApply={() => onApplyNoiseReduction(effects.restoration.noiseReduction.amount)}
      >
        <Row label="Amount" value={effects.restoration.noiseReduction.amount} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, restoration: { ...fx.restoration, noiseReduction: { amount: v } } }))} />
      </OfflineToolBox>

      <OfflineToolBox
        title="De-click"
        applyLabel="Apply (detect + repair)"
        onApply={() => onApplyDeClick(effects.restoration.deClick.sensitivity)}
      >
        <Row label="Sensitivity" value={effects.restoration.deClick.sensitivity} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, restoration: { ...fx.restoration, deClick: { sensitivity: v } } }))} />
      </OfflineToolBox>

      <OfflineToolBox
        title="De-clip"
        applyLabel="Apply (rebuild peaks)"
        onApply={() => onApplyDeClip(effects.restoration.deClip.threshold)}
      >
        <Row label="Ceiling" value={effects.restoration.deClip.threshold} min={0.5} max={0.999} step={0.001}
          onChange={(v) => set((fx) => ({ ...fx, restoration: { ...fx.restoration, deClip: { threshold: v } } }))} />
      </OfflineToolBox>

      <OfflineToolBox
        title="De-reverb"
        applyLabel="Apply (tail suppression)"
        onApply={() => onApplyDeReverb(effects.restoration.deReverb.amount)}
      >
        <Row label="Amount" value={effects.restoration.deReverb.amount} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, restoration: { ...fx.restoration, deReverb: { amount: v } } }))} />
      </OfflineToolBox>

      <OfflineToolBox
        title="DC Offset Removal"
        applyLabel="Apply (re-center on 0)"
        onApply={onApplyDcOffsetRemoval}
      >
        <p className="text-[9px] leading-snug text-white/40">
          Re-centers the waveform on the zero line if it has drifted off-center
          (a common symptom of a faulty audio interface/mic preamp).
        </p>
      </OfflineToolBox>

      <Section title="Polarity" enabled={effects.polarityInverted}
        onToggle={() => set((fx) => ({ ...fx, polarityInverted: !fx.polarityInverted }))}>
        <p className="text-[9px] leading-snug text-white/40">
          Flips the signal 180° (Phase Inversion). Use when summing two mics
          on the same source causes cancellation — flipping one mic&apos;s
          polarity can restore lost low end.
        </p>
      </Section>

      <Section title="Spatial Audio (3D)" enabled={effects.spatial.enabled}
        onToggle={() => set((fx) => ({ ...fx, spatial: { ...fx.spatial, enabled: !fx.spatial.enabled } }))}>
        <Row label="Left / Right" value={effects.spatial.x} min={-10} max={10} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, spatial: { ...fx.spatial, x: v } }))} unit="m" />
        <Row label="Down / Up" value={effects.spatial.y} min={-10} max={10} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, spatial: { ...fx.spatial, y: v } }))} unit="m" />
        <Row label="Behind / Front" value={-effects.spatial.z} min={-10} max={10} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, spatial: { ...fx.spatial, z: -v } }))} unit="m" />
        <p className="text-[9px] leading-snug text-white/40">
          Positions this track in 3D space around the listener using the
          browser&apos;s native HRTF binaural renderer — the same headphone/
          stereo rendering approach object-based formats like Dolby Atmos
          use. True discrete 5.1/7.1 hardware output isn&apos;t reliably
          available from a browser tab, so this binaural 3D field is the
          practical, always-works substitute (see docs).
        </p>
      </Section>

      <Section title="Noise Gate" enabled={effects.gate.enabled}
        onToggle={() => set((fx) => ({ ...fx, gate: { ...fx.gate, enabled: !fx.gate.enabled } }))}>
        <Row label="Threshold" value={effects.gate.threshold} min={-80} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, gate: { ...fx.gate, threshold: v } }))} unit="dB" />
      </Section>

      <Section title="Expander" enabled={effects.expander.enabled}
        onToggle={() => set((fx) => ({ ...fx, expander: { ...fx.expander, enabled: !fx.expander.enabled } }))}>
        <Row label="Threshold" value={effects.expander.threshold} min={-80} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, expander: { ...fx.expander, threshold: v } }))} unit="dB" />
      </Section>

      <Section title="EQ (3-band)">
        <Row label="Low" value={effects.eq.low} min={-20} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, eq: { ...fx.eq, low: v } }))} unit="dB" />
        <Row label="Mid" value={effects.eq.mid} min={-20} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, eq: { ...fx.eq, mid: v } }))} unit="dB" />
        <Row label="High" value={effects.eq.high} min={-20} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, eq: { ...fx.eq, high: v } }))} unit="dB" />
      </Section>

      {/* Dynamic EQ: 3 independent bands, each ducking only when its own
          band crosses threshold — a different tool from both the static
          EQ above (fixed cut/boost) and a whole-signal Compressor. */}
      <Section title="Dynamic EQ" enabled={effects.dynamicEq.enabled}
        onToggle={() => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, enabled: !fx.dynamicEq.enabled } }))}>
        <span className="text-[9px] uppercase tracking-wider text-white/30">Low band</span>
        <Row label="Freq" value={effects.dynamicEq.low.freq} min={40} max={1000} step={5}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, low: { ...fx.dynamicEq.low, freq: v } } }))} unit="Hz" />
        <Row label="Threshold" value={effects.dynamicEq.low.threshold} min={-60} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, low: { ...fx.dynamicEq.low, threshold: v } } }))} unit="dB" />
        <Row label="Ratio" value={effects.dynamicEq.low.ratio} min={1} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, low: { ...fx.dynamicEq.low, ratio: v } } }))} unit=":1" />
        <span className="mt-1 text-[9px] uppercase tracking-wider text-white/30">Mid band</span>
        <Row label="Lo cut" value={effects.dynamicEq.mid.freqLow} min={40} max={2000} step={10}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, mid: { ...fx.dynamicEq.mid, freqLow: v } } }))} unit="Hz" />
        <Row label="Hi cut" value={effects.dynamicEq.mid.freqHigh} min={500} max={10000} step={50}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, mid: { ...fx.dynamicEq.mid, freqHigh: v } } }))} unit="Hz" />
        <Row label="Threshold" value={effects.dynamicEq.mid.threshold} min={-60} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, mid: { ...fx.dynamicEq.mid, threshold: v } } }))} unit="dB" />
        <Row label="Ratio" value={effects.dynamicEq.mid.ratio} min={1} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, mid: { ...fx.dynamicEq.mid, ratio: v } } }))} unit=":1" />
        <span className="mt-1 text-[9px] uppercase tracking-wider text-white/30">High band</span>
        <Row label="Freq" value={effects.dynamicEq.high.freq} min={1000} max={16000} step={100}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, high: { ...fx.dynamicEq.high, freq: v } } }))} unit="Hz" />
        <Row label="Threshold" value={effects.dynamicEq.high.threshold} min={-60} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, high: { ...fx.dynamicEq.high, threshold: v } } }))} unit="dB" />
        <Row label="Ratio" value={effects.dynamicEq.high.ratio} min={1} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, high: { ...fx.dynamicEq.high, ratio: v } } }))} unit=":1" />
        <Row label="Mix" value={effects.dynamicEq.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, dynamicEq: { ...fx.dynamicEq, wet: v } }))} />
      </Section>

      <div className="min-w-[190px] rounded-md border border-void-700 bg-void-850 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">Tape Stop</span>
          <span className="rounded bg-neon-pink/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-neon-pink">
            Live
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <select
            value={effects.tapeStop.curve}
            onChange={(e) => set((fx) => ({ ...fx, tapeStop: { ...fx.tapeStop, curve: e.target.value as any } }))}
            className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
          >
            <option value="exponential">Exponential (tape-like)</option>
            <option value="linear">Linear</option>
          </select>
          <Row label="Stop time" value={effects.tapeStop.stopDuration} min={0.1} max={4} step={0.05}
            onChange={(v) => set((fx) => ({ ...fx, tapeStop: { ...fx.tapeStop, stopDuration: v } }))} unit="s" />
          <Row label="Start time" value={effects.tapeStop.startDuration} min={0.1} max={4} step={0.05}
            onChange={(v) => set((fx) => ({ ...fx, tapeStop: { ...fx.tapeStop, startDuration: v } }))} unit="s" />
          <div className="flex gap-1">
            <button
              onClick={onTriggerTapeStop}
              className="flex-1 rounded bg-neon-pink/15 px-2 py-1 text-[9px] font-bold uppercase text-neon-pink transition hover:bg-neon-pink/25"
            >
              Stop
            </button>
            <button
              onClick={onTriggerTapeStart}
              className="flex-1 rounded bg-neon-cyan/15 px-2 py-1 text-[9px] font-bold uppercase text-neon-cyan transition hover:bg-neon-cyan/25"
            >
              Start
            </button>
          </div>
        </div>
      </div>

      <Section title="Filter" enabled={effects.filter.enabled}
        onToggle={() => set((fx) => ({ ...fx, filter: { ...fx.filter, enabled: !fx.filter.enabled } }))}>
        <select
          value={effects.filter.type}
          onChange={(e) => set((fx) => ({ ...fx, filter: { ...fx.filter, type: e.target.value as any } }))}
          className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
        >
          <option value="lowpass">Low-pass</option>
          <option value="highpass">High-pass</option>
          <option value="bandpass">Band-pass</option>
          <option value="notch">Notch</option>
        </select>
        <Row label="Frequency" value={effects.filter.frequency} min={20} max={20000} step={10}
          onChange={(v) => set((fx) => ({ ...fx, filter: { ...fx.filter, frequency: v } }))} unit="Hz" />
        <Row label="Q" value={effects.filter.q} min={0.1} max={20} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, filter: { ...fx.filter, q: v } }))} />
      </Section>

      <Section title="Compressor" enabled={effects.compressor.enabled}
        onToggle={() => set((fx) => ({ ...fx, compressor: { ...fx.compressor, enabled: !fx.compressor.enabled } }))}>
        <Row label="Threshold" value={effects.compressor.threshold} min={-60} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, compressor: { ...fx.compressor, threshold: v } }))} unit="dB" />
        <Row label="Ratio" value={effects.compressor.ratio} min={1} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, compressor: { ...fx.compressor, ratio: v } }))} unit=":1" />
        <Row label="Attack" value={effects.compressor.attack} min={0.001} max={1} step={0.001}
          onChange={(v) => set((fx) => ({ ...fx, compressor: { ...fx.compressor, attack: v } }))} unit="s" />
        <Row label="Release" value={effects.compressor.release} min={0.01} max={2} step={0.01}
          onChange={(v) => set((fx) => ({ ...fx, compressor: { ...fx.compressor, release: v } }))} unit="s" />
      </Section>

      <Section title="Limiter" enabled={effects.limiter.enabled}
        onToggle={() => set((fx) => ({ ...fx, limiter: { ...fx.limiter, enabled: !fx.limiter.enabled } }))}>
        <Row label="Threshold" value={effects.limiter.threshold} min={-20} max={0} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, limiter: { ...fx.limiter, threshold: v } }))} unit="dB" />
      </Section>

      {/* Workflow: Sidechaining — ducks this track's gain off another
          track's level (envelope follower, since Web Audio has no native
          keyed compressor input). Classic use: bass ducking under a kick. */}
      <Section title="Sidechain" enabled={effects.sidechain.enabled}
        onToggle={() => set((fx) => ({ ...fx, sidechain: { ...fx.sidechain, enabled: !fx.sidechain.enabled } }))}>
        <select
          value={effects.sidechain.sourceTrackId ?? ""}
          onChange={(e) => set((fx) => ({ ...fx, sidechain: { ...fx.sidechain, sourceTrackId: e.target.value || null } }))}
          className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
        >
          <option value="">Duck from…</option>
          {otherTracks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <Row label="Amount" value={effects.sidechain.amount} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, sidechain: { ...fx.sidechain, amount: v } }))} />
      </Section>

      <Section title="De-esser" enabled={effects.deEsser.enabled}
        onToggle={() => set((fx) => ({ ...fx, deEsser: { ...fx.deEsser, enabled: !fx.deEsser.enabled } }))}>
        <Row label="Frequency" value={effects.deEsser.frequency} min={2000} max={12000} step={100}
          onChange={(v) => set((fx) => ({ ...fx, deEsser: { ...fx.deEsser, frequency: v } }))} unit="Hz" />
        <Row label="Reduction" value={effects.deEsser.reduction} min={0} max={24} step={1}
          onChange={(v) => set((fx) => ({ ...fx, deEsser: { ...fx.deEsser, reduction: v } }))} unit="dB" />
      </Section>

      <Section title="Distortion" enabled={effects.distortion.enabled}
        onToggle={() => set((fx) => ({ ...fx, distortion: { ...fx.distortion, enabled: !fx.distortion.enabled } }))}>
        <Row label="Amount" value={effects.distortion.amount} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, distortion: { ...fx.distortion, amount: v } }))} />
      </Section>

      <Section title="Saturation" enabled={effects.saturation.enabled}
        onToggle={() => set((fx) => ({ ...fx, saturation: { ...fx.saturation, enabled: !fx.saturation.enabled } }))}>
        <Row label="Amount" value={effects.saturation.amount} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, saturation: { ...fx.saturation, amount: v } }))} />
      </Section>

      <Section title="Bitcrusher" enabled={effects.bitcrusher.enabled}
        onToggle={() => set((fx) => ({ ...fx, bitcrusher: { ...fx.bitcrusher, enabled: !fx.bitcrusher.enabled } }))}>
        <Row label="Bit depth" value={effects.bitcrusher.bits} min={1} max={16} step={1}
          onChange={(v) => set((fx) => ({ ...fx, bitcrusher: { ...fx.bitcrusher, bits: v } }))} unit="bit" />
      </Section>

      <Section title="Chorus" enabled={effects.chorus.enabled}
        onToggle={() => set((fx) => ({ ...fx, chorus: { ...fx.chorus, enabled: !fx.chorus.enabled } }))}>
        <Row label="Rate" value={effects.chorus.frequency} min={0.1} max={10} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, chorus: { ...fx.chorus, frequency: v } }))} unit="Hz" />
        <Row label="Depth" value={effects.chorus.depth} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, chorus: { ...fx.chorus, depth: v } }))} />
        <Row label="Mix" value={effects.chorus.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, chorus: { ...fx.chorus, wet: v } }))} />
      </Section>

      <Section title="Flanger" enabled={effects.flanger.enabled}
        onToggle={() => set((fx) => ({ ...fx, flanger: { ...fx.flanger, enabled: !fx.flanger.enabled } }))}>
        <Row label="Rate" value={effects.flanger.rate} min={0.05} max={5} step={0.05}
          onChange={(v) => set((fx) => ({ ...fx, flanger: { ...fx.flanger, rate: v } }))} unit="Hz" />
        <Row label="Depth" value={effects.flanger.depth} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, flanger: { ...fx.flanger, depth: v } }))} />
        <Row label="Feedback" value={effects.flanger.feedback} min={0} max={0.9} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, flanger: { ...fx.flanger, feedback: v } }))} />
        <Row label="Mix" value={effects.flanger.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, flanger: { ...fx.flanger, wet: v } }))} />
      </Section>

      <Section title="Mod LFO" enabled={effects.modLfo.enabled}
        onToggle={() => set((fx) => ({ ...fx, modLfo: { ...fx.modLfo, enabled: !fx.modLfo.enabled } }))}>
        <label className="flex flex-col gap-0.5 text-[9px] text-white/40">
          <span>Target</span>
          <select
            value={effects.modLfo.target}
            onChange={(e) => set((fx) => ({ ...fx, modLfo: { ...fx.modLfo, target: e.target.value as any } }))}
            className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
          >
            <option value="off">Off</option>
            <option value="filterCutoff">Filter Cutoff</option>
            <option value="pan">Pan</option>
            <option value="volume">Volume</option>
            <option value="delayTime">Delay Time</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[9px] text-white/40">
          <span>Shape</span>
          <select
            value={effects.modLfo.shape}
            onChange={(e) => set((fx) => ({ ...fx, modLfo: { ...fx.modLfo, shape: e.target.value as any } }))}
            className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
          >
            <option value="sine">Sine</option>
            <option value="triangle">Triangle</option>
            <option value="square">Square</option>
            <option value="sawtooth">Sawtooth</option>
          </select>
        </label>
        <Row label="Rate" value={effects.modLfo.rate} min={0.02} max={20} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, modLfo: { ...fx.modLfo, rate: v } }))} unit="Hz" />
        <Row label="Depth" value={effects.modLfo.depth} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, modLfo: { ...fx.modLfo, depth: v } }))} />
      </Section>

      <Section title="Phaser" enabled={effects.phaser.enabled}
        onToggle={() => set((fx) => ({ ...fx, phaser: { ...fx.phaser, enabled: !fx.phaser.enabled } }))}>
        <Row label="Rate" value={effects.phaser.frequency} min={0.05} max={5} step={0.05}
          onChange={(v) => set((fx) => ({ ...fx, phaser: { ...fx.phaser, frequency: v } }))} unit="Hz" />
        <Row label="Octaves" value={effects.phaser.octaves} min={1} max={6} step={1}
          onChange={(v) => set((fx) => ({ ...fx, phaser: { ...fx.phaser, octaves: v } }))} />
        <Row label="Mix" value={effects.phaser.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, phaser: { ...fx.phaser, wet: v } }))} />
      </Section>

      <Section title="Tremolo" enabled={effects.tremolo.enabled}
        onToggle={() => set((fx) => ({ ...fx, tremolo: { ...fx.tremolo, enabled: !fx.tremolo.enabled } }))}>
        <Row label="Rate" value={effects.tremolo.frequency} min={0.1} max={20} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, tremolo: { ...fx.tremolo, frequency: v } }))} unit="Hz" />
        <Row label="Depth" value={effects.tremolo.depth} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, tremolo: { ...fx.tremolo, depth: v } }))} />
      </Section>

      <Section title="Vibrato" enabled={effects.vibrato.enabled}
        onToggle={() => set((fx) => ({ ...fx, vibrato: { ...fx.vibrato, enabled: !fx.vibrato.enabled } }))}>
        <Row label="Rate" value={effects.vibrato.frequency} min={0.1} max={20} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, vibrato: { ...fx.vibrato, frequency: v } }))} unit="Hz" />
        <Row label="Depth" value={effects.vibrato.depth} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, vibrato: { ...fx.vibrato, depth: v } }))} />
      </Section>

      <Section title="Pitch Shift" enabled={effects.pitchShift.enabled}
        onToggle={() => set((fx) => ({ ...fx, pitchShift: { ...fx.pitchShift, enabled: !fx.pitchShift.enabled } }))}>
        <Row label="Semitones" value={effects.pitchShift.semitones} min={-12} max={12} step={1}
          onChange={(v) => set((fx) => ({ ...fx, pitchShift: { ...fx.pitchShift, semitones: v } }))} unit="st" />
        <Row label="Mix" value={effects.pitchShift.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, pitchShift: { ...fx.pitchShift, wet: v } }))} />
      </Section>

      <Section title="Auto-Tune" enabled={effects.autoTune.enabled}
        onToggle={() => set((fx) => ({ ...fx, autoTune: { ...fx.autoTune, enabled: !fx.autoTune.enabled } }))}>
        <div className="flex gap-1">
          <select
            value={effects.autoTune.key}
            onChange={(e) => set((fx) => ({ ...fx, autoTune: { ...fx.autoTune, key: Number(e.target.value) } }))}
            className="flex-1 rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
          >
            {["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].map((n, i) => (
              <option key={n} value={i}>{n}</option>
            ))}
          </select>
          <select
            value={effects.autoTune.scale}
            onChange={(e) => set((fx) => ({ ...fx, autoTune: { ...fx.autoTune, scale: e.target.value as any } }))}
            className="flex-1 rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
          >
            <option value="chromatic">Chromatic</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
          </select>
        </div>
        <Row label="Retune Speed" value={effects.autoTune.retune} min={0.05} max={1} step={0.05}
          onChange={(v) => set((fx) => ({ ...fx, autoTune: { ...fx.autoTune, retune: v } }))} />
        <Row label="Mix" value={effects.autoTune.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, autoTune: { ...fx.autoTune, wet: v } }))} />
      </Section>

      <Section title="Harmonizer" enabled={effects.harmonizer.enabled}
        onToggle={() => set((fx) => ({ ...fx, harmonizer: { ...fx.harmonizer, enabled: !fx.harmonizer.enabled } }))}>
        <Row label="Voice 1" value={effects.harmonizer.voice1} min={-12} max={12} step={1}
          onChange={(v) => set((fx) => ({ ...fx, harmonizer: { ...fx.harmonizer, voice1: v } }))} unit="st" />
        <Row label="Voice 1 Mix" value={effects.harmonizer.voice1Wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, harmonizer: { ...fx.harmonizer, voice1Wet: v } }))} />
        <Row label="Voice 2" value={effects.harmonizer.voice2} min={-12} max={12} step={1}
          onChange={(v) => set((fx) => ({ ...fx, harmonizer: { ...fx.harmonizer, voice2: v } }))} unit="st" />
        <Row label="Voice 2 Mix" value={effects.harmonizer.voice2Wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, harmonizer: { ...fx.harmonizer, voice2Wet: v } }))} />
      </Section>

      <Section title="Delay" enabled={effects.delay.enabled}
        onToggle={() => set((fx) => ({ ...fx, delay: { ...fx.delay, enabled: !fx.delay.enabled } }))}>
        <Row label="Time" value={effects.delay.time} min={0.01} max={1} step={0.01}
          onChange={(v) => set((fx) => ({ ...fx, delay: { ...fx.delay, time: v } }))} unit="s" />
        <Row label="Feedback" value={effects.delay.feedback} min={0} max={0.9} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, delay: { ...fx.delay, feedback: v } }))} />
        <Row label="Mix" value={effects.delay.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, delay: { ...fx.delay, wet: v } }))} />
      </Section>

      <Section title="Reverb" enabled={effects.reverb.enabled}
        onToggle={() => set((fx) => ({ ...fx, reverb: { ...fx.reverb, enabled: !fx.reverb.enabled } }))}>
        <Row label="Decay" value={effects.reverb.decay} min={0.1} max={10} step={0.1}
          onChange={(v) => set((fx) => ({ ...fx, reverb: { ...fx.reverb, decay: v } }))} unit="s" />
        <Row label="Mix" value={effects.reverb.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, reverb: { ...fx.reverb, wet: v } }))} />
      </Section>

      <Section title="Vocoder (8-band)" enabled={effects.vocoder.enabled}
        onToggle={() => set((fx) => ({ ...fx, vocoder: { ...fx.vocoder, enabled: !fx.vocoder.enabled } }))}>
        <select
          value={effects.vocoder.carrier}
          onChange={(e) => set((fx) => ({ ...fx, vocoder: { ...fx.vocoder, carrier: e.target.value as any } }))}
          className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
        >
          <option value="sawtooth">Sawtooth</option>
          <option value="square">Square</option>
          <option value="pulse">Pulse</option>
        </select>
        <Row label="Carrier Pitch" value={effects.vocoder.carrierNote} min={40} max={220} step={1}
          onChange={(v) => set((fx) => ({ ...fx, vocoder: { ...fx.vocoder, carrierNote: v } }))} unit="Hz" />
        <Row label="Mix" value={effects.vocoder.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, vocoder: { ...fx.vocoder, wet: v } }))} />
      </Section>

      <Section title="Multiband Comp" enabled={effects.multibandCompressor.enabled}
        onToggle={() => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, enabled: !fx.multibandCompressor.enabled } }))}>
        <Row label="Low/Mid Split" value={effects.multibandCompressor.lowFreq} min={40} max={800} step={10}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, lowFreq: v } }))} unit="Hz" />
        <Row label="Mid/High Split" value={effects.multibandCompressor.highFreq} min={800} max={10000} step={50}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, highFreq: v } }))} unit="Hz" />
        <Row label="Low Thresh" value={effects.multibandCompressor.low.threshold} min={-60} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, low: { ...fx.multibandCompressor.low, threshold: v } } }))} unit="dB" />
        <Row label="Low Ratio" value={effects.multibandCompressor.low.ratio} min={1} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, low: { ...fx.multibandCompressor.low, ratio: v } } }))} unit=":1" />
        <Row label="Mid Thresh" value={effects.multibandCompressor.mid.threshold} min={-60} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, mid: { ...fx.multibandCompressor.mid, threshold: v } } }))} unit="dB" />
        <Row label="Mid Ratio" value={effects.multibandCompressor.mid.ratio} min={1} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, mid: { ...fx.multibandCompressor.mid, ratio: v } } }))} unit=":1" />
        <Row label="High Thresh" value={effects.multibandCompressor.high.threshold} min={-60} max={0} step={1}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, high: { ...fx.multibandCompressor.high, threshold: v } } }))} unit="dB" />
        <Row label="High Ratio" value={effects.multibandCompressor.high.ratio} min={1} max={20} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, multibandCompressor: { ...fx.multibandCompressor, high: { ...fx.multibandCompressor.high, ratio: v } } }))} unit=":1" />
      </Section>

      <Section title="Transient Shaper" enabled={effects.transientShaper.enabled}
        onToggle={() => set((fx) => ({ ...fx, transientShaper: { ...fx.transientShaper, enabled: !fx.transientShaper.enabled } }))}>
        <Row label="Attack" value={effects.transientShaper.attack} min={-1} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, transientShaper: { ...fx.transientShaper, attack: v } }))} />
        <Row label="Sustain" value={effects.transientShaper.sustain} min={-1} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, transientShaper: { ...fx.transientShaper, sustain: v } }))} />
      </Section>

      <Section title="Stereo Imager" enabled={effects.stereoImager.enabled}
        onToggle={() => set((fx) => ({ ...fx, stereoImager: { ...fx.stereoImager, enabled: !fx.stereoImager.enabled } }))}>
        <Row label="Width" value={effects.stereoImager.width} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, stereoImager: { ...fx.stereoImager, width: v } }))} />
      </Section>

      <Section title="Exciter" enabled={effects.exciter.enabled}
        onToggle={() => set((fx) => ({ ...fx, exciter: { ...fx.exciter, enabled: !fx.exciter.enabled } }))}>
        <Row label="Frequency" value={effects.exciter.frequency} min={1000} max={12000} step={100}
          onChange={(v) => set((fx) => ({ ...fx, exciter: { ...fx.exciter, frequency: v } }))} unit="Hz" />
        <Row label="Amount" value={effects.exciter.amount} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, exciter: { ...fx.exciter, amount: v } }))} />
        <Row label="Mix" value={effects.exciter.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, exciter: { ...fx.exciter, wet: v } }))} />
      </Section>

      <Section title="Formant Shift" enabled={effects.formantShift.enabled}
        onToggle={() => set((fx) => ({ ...fx, formantShift: { ...fx.formantShift, enabled: !fx.formantShift.enabled } }))}>
        <Row label="Shift" value={effects.formantShift.shift} min={-12} max={12} step={0.5}
          onChange={(v) => set((fx) => ({ ...fx, formantShift: { ...fx.formantShift, shift: v } }))} unit="st" />
        <Row label="Mix" value={effects.formantShift.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, formantShift: { ...fx.formantShift, wet: v } }))} />
      </Section>

      <Section title="Convolution Reverb" enabled={effects.convolutionReverb.enabled}
        onToggle={() => set((fx) => ({ ...fx, convolutionReverb: { ...fx.convolutionReverb, enabled: !fx.convolutionReverb.enabled } }))}>
        <select
          value={effects.convolutionReverb.irType}
          onChange={(e) => set((fx) => ({ ...fx, convolutionReverb: { ...fx.convolutionReverb, irType: e.target.value as any } }))}
          className="rounded bg-void-800 px-1 py-0.5 text-[9px] text-white/70"
        >
          <option value="room">Room</option>
          <option value="hall">Hall</option>
          <option value="plate">Plate</option>
          <option value="cathedral">Cathedral</option>
        </select>
        <Row label="Mix" value={effects.convolutionReverb.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, convolutionReverb: { ...fx.convolutionReverb, wet: v } }))} />
      </Section>

      <Section title="Ring Modulation" enabled={effects.ringMod.enabled}
        onToggle={() => set((fx) => ({ ...fx, ringMod: { ...fx.ringMod, enabled: !fx.ringMod.enabled } }))}>
        <Row label="Frequency" value={effects.ringMod.frequency} min={1} max={2000} step={1}
          onChange={(v) => set((fx) => ({ ...fx, ringMod: { ...fx.ringMod, frequency: v } }))} unit="Hz" />
        <Row label="Mix" value={effects.ringMod.wet} min={0} max={1} step={0.02}
          onChange={(v) => set((fx) => ({ ...fx, ringMod: { ...fx.ringMod, wet: v } }))} />
      </Section>
    </div>
  );
}
