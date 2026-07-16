/**
 * Export/Delivery pipeline.
 *
 * Builds on the existing `renderProjectOffline` (Tone.Offline mixdown -> WAV)
 * and adds everything after that: sample-rate/bit-depth conversion, dithered
 * bit-depth reduction, lossy encoding (MP3/OGG), FLAC, ID3/metadata tagging,
 * per-track stem rendering, and batch export — all via the ffmpeg.wasm
 * instance in lib/ffmpeg.ts. Stems and batch jobs are bundled into a single
 * .zip with the dependency-free writer in lib/zip.ts.
 */
import { getFFmpeg } from "@/lib/ffmpeg";
import { createZip, ZipEntry } from "@/lib/zip";
import { renderProjectOffline, RenderableTrack } from "@/lib/audioEngine";

export type ExportFormat = "wav" | "mp3" | "flac" | "ogg";
export type BitDepth = 16 | 24 | 32;
export type DitherMethod = "none" | "triangular" | "shibata" | "lipshitz";
export type SampleRateOption = 44100 | 48000 | 88200 | 96000 | 192000 | "source";

export interface ID3Tags {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  comment?: string;
  track?: string;
}

export interface ExportSettings {
  format: ExportFormat;
  sampleRate: SampleRateOption;
  bitDepth: BitDepth; // wav / flac only
  mp3Bitrate: 128 | 192 | 256 | 320; // mp3 / ogg (mapped to a quality)
  dither: DitherMethod; // only meaningful when reducing to 16-bit
  tags: ID3Tags;
}

export function defaultExportSettings(): ExportSettings {
  return {
    format: "wav",
    sampleRate: "source",
    bitDepth: 24,
    mp3Bitrate: 320,
    dither: "triangular",
    tags: {},
  };
}

/** A queued item in the batch-export list — its own independent settings. */
export interface BatchItem {
  id: string;
  label: string;
  settings: ExportSettings;
}

export type ExportStage =
  | "idle"
  | "mixing"
  | "loading-encoder"
  | "encoding"
  | "zipping"
  | "done"
  | "error";

export interface ExportProgress {
  stage: ExportStage;
  progress: number; // 0..1 overall
  detail?: string;
}

const EXT: Record<ExportFormat, string> = { wav: "wav", mp3: "mp3", flac: "flac", ogg: "ogg" };

/** Rough libvorbis -q:a mapping for the bitrate presets we expose in the UI. */
function oggQuality(bitrate: number): number {
  if (bitrate <= 128) return 4;
  if (bitrate <= 192) return 6;
  if (bitrate <= 256) return 8;
  return 9;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
}

/** Builds the ffmpeg argv for one input WAV -> one encoded output file. */
function buildFfmpegArgs(inputName: string, outputName: string, settings: ExportSettings): string[] {
  const args: string[] = ["-i", inputName, "-map_metadata", "-1"];

  // --- Resample + (optionally) dithered bit-depth reduction ---
  // Dithering only makes audible sense when truncating to 16-bit; at 24/32-bit
  // the added noise floor buys nothing, so it's only wired in for that case.
  const resampleParts: string[] = [];
  if (settings.sampleRate !== "source") resampleParts.push(`sample_rate=${settings.sampleRate}`);
  if (settings.format !== "mp3" && settings.format !== "ogg" && settings.bitDepth === 16) {
    resampleParts.push("out_sample_fmt=s16");
    resampleParts.push(`dither_method=${settings.dither === "none" ? "rectangular" : settings.dither}`);
  }
  if (resampleParts.length) args.push("-af", `aresample=${resampleParts.join(":")}`);

  // --- Codec / container ---
  switch (settings.format) {
    case "wav":
      args.push("-c:a", settings.bitDepth === 16 ? "pcm_s16le" : settings.bitDepth === 24 ? "pcm_s24le" : "pcm_f32le");
      break;
    case "flac":
      args.push("-c:a", "flac", "-sample_fmt", settings.bitDepth === 16 ? "s16" : "s32");
      break;
    case "mp3":
      args.push("-c:a", "libmp3lame", "-b:a", `${settings.mp3Bitrate}k`);
      break;
    case "ogg":
      args.push("-c:a", "libvorbis", "-q:a", String(oggQuality(settings.mp3Bitrate)));
      break;
  }

  // --- ID3 / container metadata tags ---
  const t = settings.tags;
  const pairs: [string, string | undefined][] = [
    ["title", t.title],
    ["artist", t.artist],
    ["album", t.album],
    ["date", t.year],
    ["genre", t.genre],
    ["comment", t.comment],
    ["track", t.track],
  ];
  for (const [key, value] of pairs) {
    if (value) args.push("-metadata", `${key}=${value.replace(/"/g, "'")}`);
  }
  if (settings.format === "mp3") args.push("-id3v2_version", "3", "-write_id3v1", "1");

  args.push(outputName);
  return args;
}

/** True for the plain, no-conversion-needed case — skip loading ffmpeg entirely. */
function isPassthroughWav(settings: ExportSettings): boolean {
  return (
    settings.format === "wav" &&
    settings.bitDepth === 16 &&
    settings.sampleRate === "source" &&
    Object.values(settings.tags).every((v) => !v)
  );
}

let jobCounter = 0;

/**
 * Runs one WAV mixdown blob through the format/sample-rate/bit-depth/tagging
 * pipeline and returns the encoded result.
 */
export async function encodeMixdown(
  wavBlob: Blob,
  settings: ExportSettings,
  onProgress?: (p: ExportProgress) => void
): Promise<Blob> {
  if (isPassthroughWav(settings)) return wavBlob;

  onProgress?.({ stage: "loading-encoder", progress: 0.05, detail: "Loading ffmpeg.wasm…" });
  const ffmpeg = await getFFmpeg();

  const jobId = jobCounter++;
  const inputName = `in_${jobId}.wav`;
  const outputName = `out_${jobId}.${EXT[settings.format]}`;

  const handleProgress = ({ progress }: { progress: number }) => {
    onProgress?.({ stage: "encoding", progress: 0.3 + Math.min(Math.max(progress, 0), 1) * 0.65 });
  };
  ffmpeg.on("progress", handleProgress);

  try {
    const { fetchFile } = await import("@ffmpeg/util");
    await ffmpeg.writeFile(inputName, await fetchFile(wavBlob));
    onProgress?.({ stage: "encoding", progress: 0.3, detail: `Encoding ${settings.format.toUpperCase()}…` });

    await ffmpeg.exec(buildFfmpegArgs(inputName, outputName, settings));

    const data = await ffmpeg.readFile(outputName);
    const bytes = new Uint8Array(data as Uint8Array);
    return new Blob([bytes], { type: `audio/${settings.format === "wav" ? "wav" : settings.format}` });
  } finally {
    ffmpeg.off("progress", handleProgress);
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
}

/** Renders a single track in isolation (everyone else muted) via the same offline mixer. */
async function renderTrackStem(track: RenderableTrack, bpm: number): Promise<Blob> {
  const solo: RenderableTrack = { ...track, muted: false, solo: false };
  return renderProjectOffline([solo], bpm);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Full-mix export: one file, one set of settings, straight to the browser download. */
export async function exportMixdown(
  tracks: RenderableTrack[],
  bpm: number,
  settings: ExportSettings,
  baseName: string,
  onProgress?: (p: ExportProgress) => void
): Promise<void> {
  onProgress?.({ stage: "mixing", progress: 0, detail: "Rendering mixdown…" });
  const wav = await renderProjectOffline(tracks, bpm, (p) => onProgress?.({ stage: "mixing", progress: p * 0.3 }));
  const encoded = await encodeMixdown(wav, settings, onProgress);
  onProgress?.({ stage: "done", progress: 1 });
  triggerDownload(encoded, `${sanitizeFileName(baseName)}.${EXT[settings.format]}`);
}

/** Stems export: renders + encodes every selected track, zips them together. */
export async function exportStems(
  tracks: (RenderableTrack & { name: string })[],
  bpm: number,
  trackIds: string[],
  settings: ExportSettings,
  baseName: string,
  onProgress?: (p: ExportProgress) => void
): Promise<void> {
  const selected = tracks.filter((t) => trackIds.includes(t.id));
  if (selected.length === 0) throw new Error("Select at least one track to export as a stem.");

  const entries: ZipEntry[] = [];
  for (let i = 0; i < selected.length; i++) {
    const track = selected[i];
    const base = i / selected.length;
    const span = 1 / selected.length;
    onProgress?.({ stage: "mixing", progress: base * 0.5, detail: `Rendering "${track.name}"…` });

    const wav = await renderTrackStem(track, bpm);
    const encoded = await encodeMixdown(wav, settings, (p) =>
      onProgress?.({ stage: "encoding", progress: 0.5 + base * 0.5 + (p.progress * span) / 2, detail: `Encoding "${track.name}"…` })
    );
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    entries.push({ name: `${String(i + 1).padStart(2, "0")}_${sanitizeFileName(track.name)}.${EXT[settings.format]}`, data: bytes });
  }

  onProgress?.({ stage: "zipping", progress: 0.95, detail: "Bundling stems…" });
  const zip = createZip(entries);
  onProgress?.({ stage: "done", progress: 1 });
  triggerDownload(zip, `${sanitizeFileName(baseName)}-stems.zip`);
}

/**
 * Batch export: renders the mixdown (or every stem) once, then runs it
 * through every queued format/quality combination. Bundled into a .zip
 * whenever there's more than one resulting file.
 */
export async function exportBatch(
  tracks: (RenderableTrack & { name: string })[],
  bpm: number,
  items: BatchItem[],
  opts: { stems: boolean; trackIds: string[] },
  baseName: string,
  onProgress?: (p: ExportProgress) => void
): Promise<void> {
  if (items.length === 0) throw new Error("Add at least one export to the batch.");

  const selectedTracks = opts.stems ? tracks.filter((t) => opts.trackIds.includes(t.id)) : [];
  if (opts.stems && selectedTracks.length === 0) throw new Error("Select at least one track for stems.");

  onProgress?.({ stage: "mixing", progress: 0, detail: "Rendering source audio…" });

  // Render each required source once (full mix, or one per selected stem),
  // then reuse that source WAV for every batch item instead of re-rendering.
  type Source = { name: string; wav: Blob };
  const sources: Source[] = [];
  if (opts.stems) {
    for (let i = 0; i < selectedTracks.length; i++) {
      const track = selectedTracks[i];
      onProgress?.({ stage: "mixing", progress: (i / selectedTracks.length) * 0.3, detail: `Rendering "${track.name}"…` });
      sources.push({ name: track.name, wav: await renderTrackStem(track, bpm) });
    }
  } else {
    const wav = await renderProjectOffline(tracks, bpm, (p) => onProgress?.({ stage: "mixing", progress: p * 0.3 }));
    sources.push({ name: baseName, wav });
  }

  const entries: ZipEntry[] = [];
  const totalJobs = sources.length * items.length;
  let done = 0;

  for (const source of sources) {
    for (const item of items) {
      onProgress?.({
        stage: "encoding",
        progress: 0.3 + (done / totalJobs) * 0.6,
        detail: `${source.name} — ${item.label}`,
      });
      const encoded = await encodeMixdown(source.wav, item.settings);
      const bytes = new Uint8Array(await encoded.arrayBuffer());
      const suffix = sanitizeFileName(item.label);
      entries.push({
        name: `${sanitizeFileName(source.name)}_${suffix}.${EXT[item.settings.format]}`,
        data: bytes,
      });
      done++;
    }
  }

  if (entries.length === 1) {
    onProgress?.({ stage: "done", progress: 1 });
    triggerDownload(new Blob([entries[0].data]), entries[0].name);
    return;
  }

  onProgress?.({ stage: "zipping", progress: 0.95, detail: "Bundling batch export…" });
  const zip = createZip(entries);
  onProgress?.({ stage: "done", progress: 1 });
  triggerDownload(zip, `${sanitizeFileName(baseName)}-batch.zip`);
}
