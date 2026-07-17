"use client";

/**
 * Shared helpers for the three "productivity" features that persist data
 * outside the undo-history snapshot: Track Templates, Macros / Custom
 * Actions, and Cloud Sync. Kept in one file since all three lean on the
 * same two primitives: localStorage read/write, and blob-url <-> base64
 * conversion (needed so audio can travel inside a JSON project file).
 */

export const LOCAL_KEYS = {
  templates: "alone-song:track-templates",
  macros: "alone-song:macros",
  cloud: "alone-song:cloud-versions",
} as const;

/** Safe localStorage read — returns `fallback` on the server, on first run,
 *  or if the stored JSON is corrupt. */
export function loadLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Safe localStorage write. Silently no-ops on the server or if the quota
 *  is exceeded (e.g. a Cloud Sync snapshot with embedded audio got big). */
export function saveLocal<T>(key: string, value: T): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Converts a blob: URL (how every loaded/recorded/edited clip is stored
 *  in this app) into a base64 data URL, so it can be embedded in a plain
 *  JSON project file for Export / Share Code / Import. */
export async function blobUrlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Converts a base64 data URL back into a fresh blob: URL the audio engine
 *  and <audio>/WaveSurfer elements can actually load. */
export async function base64ToBlobUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Macros / Custom Actions catalog
// ---------------------------------------------------------------------------

export type MacroActionType =
  | "toggleReverse"
  | "timeStretch"
  | "noiseReduction"
  | "deClick"
  | "deClip"
  | "deReverb"
  | "setVolume"
  | "setPan"
  | "mute"
  | "unmute";

export interface MacroStep {
  id: string;
  action: MacroActionType;
  /** Meaning depends on the action — stretch rate, reduction amount 0-1,
   *  sensitivity 0-1, threshold 0-1, volume 0-1.2, pan -1..1. Unused for
   *  toggleReverse / mute / unmute. */
  amount?: number;
}

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export interface MacroActionDef {
  type: MacroActionType;
  label: string;
  needsAmount: boolean;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
  unit?: string;
}

/** Every action a Macro step can perform, matched 1:1 to a destructive or
 *  non-destructive track action already in useDAWStore — a macro is just a
 *  named, replayable chain of these run in order on a chosen track. */
export const MACRO_ACTIONS: MacroActionDef[] = [
  { type: "noiseReduction", label: "Reduce Noise", needsAmount: true, min: 0, max: 1, step: 0.05, default: 0.5 },
  { type: "deClick", label: "De-Click", needsAmount: true, min: 0, max: 1, step: 0.05, default: 0.5 },
  { type: "deClip", label: "De-Clip", needsAmount: true, min: 0, max: 1, step: 0.05, default: 0.5 },
  { type: "deReverb", label: "De-Reverb", needsAmount: true, min: 0, max: 1, step: 0.05, default: 0.4 },
  { type: "timeStretch", label: "Time-Stretch", needsAmount: true, min: 0.5, max: 2, step: 0.05, default: 1, unit: "x" },
  { type: "setVolume", label: "Set Volume", needsAmount: true, min: 0, max: 1.2, step: 0.05, default: 0.85 },
  { type: "setPan", label: "Set Pan", needsAmount: true, min: -1, max: 1, step: 0.05, default: 0 },
  { type: "toggleReverse", label: "Reverse", needsAmount: false },
  { type: "mute", label: "Mute", needsAmount: false },
  { type: "unmute", label: "Unmute", needsAmount: false },
];

export function macroActionDef(type: MacroActionType): MacroActionDef {
  return MACRO_ACTIONS.find((a) => a.type === type)!;
}
