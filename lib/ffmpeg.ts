/**
 * Lazily loads a single shared ffmpeg.wasm instance (client-side only). It's
 * pulled in the first time Export/Delivery actually needs it — sample rate
 * or bit depth conversion, MP3/FLAC/OGG encoding, or ID3 tagging — so the
 * ~30MB core never loads for people who only ever export plain WAV mixes.
 *
 * next.config.js already sets Cross-Origin-Opener-Policy/Embedder-Policy
 * (crossOriginIsolated), which was put there specifically so ffmpeg.wasm can
 * use SharedArrayBuffer — so this loads the multi-threaded `@ffmpeg/core-mt`
 * build rather than the single-threaded one, to actually take advantage of
 * that. Falls back to the single-thread core if cross-origin isolation
 * isn't actually active (e.g. running behind a proxy that strips headers).
 */
import type { FFmpeg } from "@ffmpeg/ffmpeg";

const CORE_VERSION = "0.12.6";
const MT_BASE = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`;
const ST_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onLog?: (message: string) => void): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);

    const ff = new FFmpeg();
    if (onLog) {
      ff.on("log", ({ message }) => onLog(message));
    }

    const crossOriginIsolated =
      typeof window !== "undefined" && (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated;

    if (crossOriginIsolated) {
      await ff.load({
        coreURL: await toBlobURL(`${MT_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${MT_BASE}/ffmpeg-core.wasm`, "application/wasm"),
        workerURL: await toBlobURL(`${MT_BASE}/ffmpeg-core.worker.js`, "text/javascript"),
      });
    } else {
      await ff.load({
        coreURL: await toBlobURL(`${ST_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${ST_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
    }

    instance = ff;
    return ff;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** True once ffmpeg.wasm has actually finished loading (for UI hints). */
export function isFFmpegReady(): boolean {
  return instance !== null;
}
