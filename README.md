# ALONE SONG — Web DAW

A browser-based Digital Audio Workstation built with Next.js, TypeScript, Tailwind CSS, Tone.js, Wavesurfer.js and FFmpeg.wasm.

## Phase 1 — what's included

- Dark, neon cyberpunk UI matching the ALONE SONG app icon (cyan / pink / violet / amber accents).
- Top navbar with logo, BPM field, and placeholder Export / AI Master buttons.
- Transport bar: Play, Pause, Stop, Record (armed state), Metronome, rewind, running timecode.
- Multitrack timeline: add unlimited Audio or MIDI track slots, per-track waveform via Wavesurfer.js, rename/delete tracks.
- Mixer panel: per-track volume fader + pan knob, mute/solo/arm, master fader — all live-wired to the Tone.js signal chain.
- `AudioEngine` singleton (`lib/audioEngine.ts`): Tone.Player → Tone.Panner → Tone.Gain → master bus per track, plus a metronome using Tone.Loop. This is the extension point for every DSP feature in later phases (EQ, compression, reverb, etc. all insert into this chain).
- Zustand store (`store/useDAWStore.ts`) is the single source of truth for tracks/transport — engine and UI both subscribe to it.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. Click **Add Audio Track**, then click the dashed drop zone to load a local audio file (mp3/wav/etc). Hit Play — the transport, waveform, fader and pan all stay in sync.

> Note: `next.config.js` sets `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers. These are required later for FFmpeg.wasm (SharedArrayBuffer) — keep them in place even though Phase 1 doesn't use FFmpeg yet.

## Folder structure

```
alone-song/
├── app/
│   ├── layout.tsx        # root layout, fonts, metadata, app icon
│   ├── page.tsx           # composes Navbar + Transport + Timeline + Mixer
│   ├── globals.css        # dark theme, fader/knob styling, grid bg
│   └── icon.png            # app icon (Next.js auto favicon route)
├── components/
│   ├── Navbar.tsx
│   ├── Transport.tsx
│   ├── EditToolbar.tsx      # Cut / Copy / Paste / Trim / Split / Merge / Silence buttons
│   ├── Timeline.tsx
│   ├── Track.tsx           # wavesurfer.js waveform + drag-to-select region + track controls
│   ├── Mixer.tsx
│   └── ExportPanel.tsx     # Export/Delivery: mix/stems, batch queue, format/dither/ID3 (Phase 7)
├── hooks/
│   └── useAudioEngine.ts   # syncs Zustand store -> Tone.js engine
├── lib/
│   ├── audioEngine.ts      # Tone.js signal-chain singleton (the "engine")
│   ├── audioEditing.ts     # pure AudioBuffer helpers: slice/remove/silence/insert/split/merge
│   ├── exportEngine.ts     # Export/Delivery orchestration (stems, batch, ffmpeg args) — Phase 7
│   ├── ffmpeg.ts           # lazy singleton ffmpeg.wasm loader (MT core if cross-origin-isolated) — Phase 7
│   └── zip.ts              # dependency-free ZIP (STORE) writer for stems/batch bundles — Phase 7
├── store/
│   └── useDAWStore.ts      # Zustand: tracks, transport, mixer state
├── public/
│   ├── icon.png
│   └── logo.png
├── next.config.js          # COOP/COEP headers for future ffmpeg.wasm use
├── tailwind.config.ts       # neon color tokens
└── package.json
```

## Architecture notes for scaling to 100 features

- **Signal chain is the extension point.** Every per-track DSP feature (EQ, compressor, gate, reverb, distortion, pitch shift, etc.) is just another Tone.js node inserted between `panner` and `gain` in `AudioEngine.loadTrack`. Keep the chain array-based (not hardcoded) once Phase 2/3 land so effects can be reordered.
- **Store stays flat and serializable.** `Track` in the Zustand store intentionally holds only plain data (numbers/strings/booleans), never Tone.js node references — that keeps it easy to serialize for project save/load and undo/redo (Phase 1 roadmap item #1).
- **FFmpeg.wasm** is for anything Tone.js/Web Audio can't do in real time: format conversion, batch export, dithering, sample-rate/bit-depth conversion, ID3 tagging (category 13). It runs in a Web Worker; wire it up as a separate `lib/ffmpegEngine.ts` in the export phase.
- **MIDI (category 8)** will need a second parallel engine (`Tone.PolySynth` / `Tone.Sampler` driven by a piano-roll data model), separate from the audio-player chain but mixed through the same master bus.
- **Metering (category 12)** taps `Tone.Analyser` / `Tone.Meter` nodes off the master bus and per-track gains — non-destructive, can be added incrementally.

## 100-feature roadmap (tracked by category)

| # | Category | Status |
|---|----------|--------|
| 1 | Basic Editing (cut/copy/paste/trim/split/fades/undo) | **Done** — Fade In/Out, Reverse, Undo/Redo (Ctrl+Z / Ctrl+Shift+Z), and now Cut/Copy/Paste/Trim/Split/Merge/Silence, all driven by a drag-to-select range on each track's waveform (see "Phase 3" below). |
| 2 | Volume & Dynamics (gain, normalize, compressor, limiter, gate, expander) | **Done** — Gain, Normalize (peak-to -1dB), Compressor, Limiter, Noise Gate all real DSP. Expander is an approximation (reuses the Gate node; Tone.js has no native expander) — noted in code comments. |
| 3 | EQ & Filters | **Done** — 3-band EQ, switchable Low/High/Band-pass/Notch filter, De-esser (dual-band split + compression). |
| 4 | Pitch & Time (pitch shift, time stretch, auto-tune, harmonizer, vocoder, reverse) | **Partial** — Pitch Shift and Reverse done. Time Stretch, Auto-Tune, Harmonizer, Vocoder need phase-vocoder / pitch-tracking DSP — Phase 3. |
| 5 | Effects (reverb, delay, chorus, flanger, phaser, distortion, saturation, tremolo, vibrato) | **Done** — all nine implemented per-track in the FX Rack. |
| 6 | Mixing & Automation | **Done** — mixer + master bus, plus **Buses** (submix groups: route any track to a bus from its header dropdown, mix it with a shared volume/pan/mute/solo channel strip in the Mixer panel, delete a bus to fall back to master) and **Automation lines/curves** (per-track Volume/Pan envelopes — toggle the Activity icon on a track to draw breakpoints directly under its waveform; click to add a point, drag to move it, double-click to delete). See "Phase 4" below for how these are wired. |
| 7 | Restoration (noise reduction, de-click, de-clip, de-reverb) | Not started — needs spectral/ML-based processing, out of scope for real-time Web Audio — Phase 4. |
| 8 | Advanced & MIDI (VST/WAM, piano roll, spectrum analyzer, metronome, rendering) | **Mostly done** — Metronome and Spectrum Analyzer done (see Mixer). New in Phase 5: **MIDI Piano Roll** (per-track note grid + built-in synth), **Quantize** (snap notes to a grid subdivision), **VST/Plugin support** via a real Web Audio Modules host (load any WAM 2.0 plugin by URL), and **Rendering** (bounce the project to a WAV via Tone.Offline, wired to the Export button). See "Phase 5" below. |
| 9 | Workflow (punch in/out, loop comping, sidechain, markers, grouping, snap, nudge) | Partial — Markers and Track Grouping data models added to the store (not yet wired to UI). Rest — Phase 3. |
| 10 | Advanced FX (multiband comp, dynamic EQ, transient shaper, stereo imager, bitcrusher, tape stop) | Partial — **Bitcrusher done**. Rest need more elaborate multiband routing — Phase 3. |
| 11 | Sound Design (arpeggiator, LFO, sample slicing, granular synthesis) | Not started — needs a MIDI/synthesis engine — Phase 4. |
| 12 | Metering (LUFS, phase correlation, goniometer, true peak, tuner) | **Done** — tabbed **Metering** panel in the Mixer (`components/meters/`) with LUFS-style stereo level bars + peak-hold (surfaces the existing `getMasterLevelDb`/`getMasterChannelLevelsDb`), **True Peak** (4x-oversampled inter-sample-peak estimate, dBTP, with a latching clip indicator), **Phase Correlation** (-1..+1 gauge from L/R cross-correlation), a **Goniometer** (45°-rotated mid/side vectorscope, canvas-drawn), and a **Tuner** (note name + cents, reusing the Auto-Tune autocorrelation pitch detector). All read off a new stereo `Split → L/R Analyser` tap on the master bus in `lib/audioEngine.ts` (see "Phase 6" below). |
| 13 | Export/Delivery (stems, batch export, dithering, sample-rate/bit-depth conversion, ID3) | **Done** — full Export/Delivery panel wired to ffmpeg.wasm: Full Mix or per-track Stems, a Batch export queue (multiple format/quality combos in one pass, zipped together), WAV/FLAC/MP3/OGG conversion, sample-rate + bit-depth conversion, dithering (Triangular/Shibata/Lipshitz) when truncating to 16-bit, and ID3/metadata tagging. See "Phase 7" below. |

### What Phase 2 added
- `lib/audioEngine.ts`: full per-track effect chain (Gate → EQ3 → Filter → Compressor → Limiter → Distortion → Saturation → Bitcrusher → Chorus → custom Flanger → Phaser → Tremolo → Vibrato → PitchShift → De-esser → Delay → Reverb → Panner → Gain → Meter), plus a proper Master bus (Compressor → Limiter → Meter).
- `components/FXRack.tsx`: collapsible per-track FX panel (toggle with the sliders icon on each track) exposing every parameter above.
- Reverse (⇄ icon) and Normalize (gauge icon) buttons per track.
- Solo now actually mutes other tracks; Mute/Solo/Volume changes are pushed to the engine centrally from `useAudioEngine.ts`.
- Undo/Redo with Ctrl+Z / Ctrl+Shift+Z, wired through a track-state history stack in the store.

### Phase 3 — Cut / Copy / Paste / Trim / Split / Merge / Silence
Since each track holds a single audio file rather than multiple clips, these tools operate on a
**time-range selection** made directly on a track's waveform, plus the playhead:

- Drag across any track's waveform to mark a range (uses Wavesurfer's Regions plugin). The range
  shows as a highlighted overlay and a small time badge; click the badge's ✕ (or the one in the
  toolbar) to clear it.
- The new **EditToolbar** (below the transport bar) exposes the seven tools. Buttons grey out
  automatically when their precondition isn't met (e.g. Paste needs something on the clipboard;
  Cut/Copy/Trim/Silence need an active selection).
- **Cut / Copy** decode the track's audio, lift out the selected range into an in-memory clipboard
  (`buffer`, not persisted across reloads), and (for Cut) splice the remainder back together.
- **Paste** inserts the clipboard clip at the selection start if one is active on the target track,
  otherwise at the current playhead position.
- **Trim** discards everything outside the selection.
- **Split** cuts the track in two at the selection start (or the playhead if no selection), leaving
  the original in place and inserting a new "(split)" track right after it — same effects/volume/pan.
- **Silence** zeroes out the selected range in place without changing the track's duration.
- **Merge** ("Merge Down") mixes a track with the one directly below it into a single new track,
  respecting each track's volume/pan, and removes the second track.

All of these run through `lib/audioEditing.ts` (pure, synchronous AudioBuffer transforms — no
Tone.js/store coupling) and `store/useDAWStore.ts` (the async actions `cutSelection`,
`copySelection`, `pasteAtPlayhead`, `trimToSelection`, `splitTrack`, `silenceSelection`,
`mergeDown`), which re-encode the result to a WAV blob URL via `audioBufferToUrl` and hand it back
to the track via `setTrackFileUrl`. Track.tsx already reloads the waveform + Tone.js player whenever
`fileUrl` changes, so no extra wiring was needed there. Every one of these operations also runs
through the existing undo/redo history stack.

### Phase 4 — Buses & Automation lines/curves

**Buses** (`store/useDAWStore.ts` `Bus` type + `buses` array, `Track.busId`):
- A bus is plain, serializable data (id/name/color/volume/pan/muted/solo) — same philosophy as tracks.
- `lib/audioEngine.ts` owns the real nodes: `createBus`/`disposeBus` build/tear down a `Gain -> Panner -> Meter -> masterGain` chain per bus id. `routeTrackToBus(trackId, busId)` disconnects a track's post-fader `gain` node from wherever it currently feeds (master or another bus) and reconnects it to the target — remembered in a `trackBusId` map so it's reapplied automatically if a track's nodes get rebuilt (Reverse, Time-Stretch) or if the bus is created *after* the track was assigned to it.
- `hooks/useAudioEngine.ts` creates/disposes engine bus nodes to match the store's `buses` array and keeps volume/pan/mute/solo (including bus-level solo-isolation) synced, mirroring the existing track solo logic.
- UI: `components/Mixer.tsx` renders a bus channel strip row (add/rename/delete/mute/solo/fader/pan, with a live count of routed tracks) between the track strips and the master strip. Each track's header in `components/Track.tsx` gets a `→ Master / → <Bus>` dropdown.

**Automation lines/curves** (`AutomationLane`/`TrackAutomation` types + helpers in `lib/audioEngine.ts`, actions in the store):
- Each track has independent Volume and Pan automation lanes: `{ enabled, points: [{ id, time, value }] }`.
- `components/AutomationLaneEditor.tsx` is a small breakpoint-envelope editor (percentage-based, so it doesn't need to match wavesurfer's internal waveform scaling) — click empty space to add a point, drag a point to move it, double-click to delete it. Toggled per-track via the Activity icon in `Track.tsx`, rendered directly under that track's waveform.
- Scheduling happens in the engine, not the UI: `setTrackAutomation` just stores the lanes; `scheduleAllAutomation()` (called from `playAll()`) walks each enabled lane from the current Transport position forward, snaps the param to the correctly-interpolated value for that position (so starting playback mid-song still lands on the curve), then schedules a native `AudioParam.linearRampToValueAtTime` for every future point via `Tone.Transport.schedule`.
- **Known limitation**: those ramps are anchored to real `AudioContext` time once scheduled, so pausing `Tone.Transport` mid-ramp doesn't freeze it (a normal Web-Audio-automation gotcha). `pauseAll()`/`stopAll()` explicitly cancel scheduled values and snap every automated param back to its plain fader/pan value to compensate — the same "documented approximation" pattern already used for the de-esser/expander/auto-tune in Phase 2.

### Phase 5 — MIDI Piano Roll, Quantize, WAM Plugin Hosting, Rendering

**MIDI Piano Roll & Quantize** (`MidiNote`/`SynthWaveform`/`QuantizeGrid` types + `quantizeMidiNotes`/`midiToNoteName` in `lib/audioEngine.ts`, `components/PianoRoll.tsx`):
- A MIDI track (`kind: "midi"`) now shows a click-to-add piano roll instead of the audio waveform/upload area. Notes are stored as plain `{ pitch, start, duration, velocity }` (absolute seconds, not beats) on `Track.notes` — click the grid to drop a note at that exact pitch/time, click a note to delete it, drag its right edge to resize.
- Playback is a parallel engine path: `loadMidiTrack`/`disposeMidiTrack`/`scheduleMidiTrack` build a `Tone.PolySynth` -> `Panner` -> `Gain` -> `Meter` -> master chain and drive it from a `Tone.Part` built from the note array, wired up per-track in `components/Track.tsx`. Mute/Solo/Volume/Pan already work for MIDI tracks since `setVolume`/`setPan`/`applySoloState` now check both the audio-track and MIDI-track node maps.
- **Quantize** is a separate, explicit action (`quantizeNotes` in the store) rather than snapping on every click, so free-time note placement stays possible — pick a grid subdivision (1/4 down to 1/16 triplet) and it snaps every note's start time using the project's current BPM.
- Instrument choice is just an oscillator waveform (sine/triangle/square/saw) on the built-in synth — there's no sample playback/soundfont here, so it won't sound like a real instrument, just a clean synth tone to sketch melodies and rhythms with.

**VST/Plugin support via Web Audio Modules** (`PluginSlot` type in `lib/audioEngine.ts`, `loadPlugin`/`unloadPlugin`/`setPluginBypass`/`rebuildPluginChain` on `AudioEngine`, `components/PluginRack.tsx`):
- This is a real host for the [Web Audio Modules](https://www.webaudiomodules.org) spec, not a mock — WAM plugins ship as a plain ES module, so `loadPlugin` does a runtime `import(url)` of the plugin's published bundle URL and calls its static `createInstance(groupId, audioContext)`, then splices the returned `audioNode` into the track's chain.
- The insertion point is a pair of native `GainNode`s (`pluginsIn`/`pluginsOut`, not Tone-wrapped, since a hosted WAM's node is a raw `AudioNode`) spliced between the vocoder stage and the panner in `loadTrack`. With zero plugins loaded it's a straight passthrough; adding/removing/bypassing a plugin calls `rebuildPluginChain` to re-wire the chain in order.
- UI: toggle the new Plug icon on an **audio** track's header to open `PluginRack`, paste a plugin's bundle URL (+ optional display name), hit Load. Each slot shows loading/ready/error status and has bypass + remove controls. Not yet wired for MIDI tracks (scope note below).
- Loaded plugins persist across a track's audio nodes being rebuilt (Reverse, Time-Stretch) the same way bus routing already does — `pluginChains` is keyed by trackId, independent of the `TrackNodes` bundle, and `rebuildPluginChain` re-splices it into the fresh `pluginsIn`/`pluginsOut` pair after every `loadTrack`.

**Rendering / Export** (`renderProjectOffline` in `lib/audioEngine.ts`, `renderProject` action in the store, wired to the Export button in `components/Navbar.tsx`):
- Export now does a real offline bounce using `Tone.Offline` (a genuine `OfflineAudioContext`, rendered as fast as the machine allows, not real-time capture), encodes the result with the existing `audioBufferToWav` helper, and triggers a browser download of a `.wav` file. The Navbar button shows a spinner while rendering and a check/warning icon on completion/error.
- **Known limitation, documented deliberately rather than half-implemented**: the render is a plain mixdown of each track's volume/pan/mute/solo (and MIDI notes through the same synth used for live playback). It does **not** replay the live per-track FX rack, bus routing, automation curves, or WAM plugin chain — those all live on real-time `Tone.Context` nodes built in `loadTrack`/`createBus`, which can't be reused inside `Tone.Offline`'s temporary offline context without rebuilding that entire node graph a second time. Flagging this as a clear follow-up (share the `loadTrack` chain-building logic between the live and offline paths) rather than attempting a partial, silently-incomplete bounce.

### Phase 6 — Metering Suite (LUFS, True Peak, Phase Correlation, Goniometer, Tuner)

**Engine additions** (`lib/audioEngine.ts`):
- A new passive stereo tap on the master bus: `masterLimiter` now also feeds a `Tone.Split` into a dedicated `Tone.Analyser("waveform")` per channel (`masterWaveformL`/`masterWaveformR`), alongside the pre-existing FFT tap and `Tone.Meter`. Same non-invasive pattern as the Spectrum Analyzer — it's a read-only fan-out, nothing sits in the actual signal path.
- `getMasterStereoWaveforms()` exposes the raw L/R sample buffers; `getMasterChannelLevelsDb()`, `getPhaseCorrelation()`, `getMasterTruePeakDb()`, and `getTunerPitch()` are all derived from those same two buffers, so the four meters + the level bars stay perfectly in sync with each other.
- **True Peak** is a lightweight approximation of ITU-R BS.1770-style true-peak metering: `estimateTruePeakLinear` 4x-oversamples each waveform buffer with linear interpolation between samples and takes the max absolute value, catching inter-sample peaks a plain sample-peak reading would miss. It's not a full polyphase-FIR resampler, so very sharp transients can be slightly understated — noted in the code comment.
- **Phase Correlation** is a direct normalized cross-correlation of the L/R buffers (`Σ(L·R) / √(Σ L² · Σ R²)`), +1 = mono-compatible, -1 = will cancel in mono.
- **Tuner** reuses the exact same `detectPitch` autocorrelation function that drives Auto-Tune, run on a mono downmix of the L/R taps — so "in tune" here means the same thing Auto-Tune would correct toward. Works best on a soloed monophonic source; a full mix will mostly show no confident pitch, which is expected.

**UI** (`components/meters/`): `MeteringPanel.tsx` is a tabbed panel (LUFS / True Peak / Phase / Gonio / Tuner) mounted in the Mixer between the Spectrum Analyzer and the Master channel strip. `LufsMeter.tsx` surfaces the level metering that already existed in the engine (`getMasterLevelDb`) but had no UI, with peak-hold bars per channel; `TruePeakMeter.tsx` adds a latching "Over" indicator at the standard -1 dBTP ceiling; `PhaseCorrelationMeter.tsx` is a -1..+1 gauge; `Goniometer.tsx` is a canvas-drawn, 45°-rotated mid/side vectorscope with a phosphor-trail effect; `Tuner.tsx` shows note name + cents deviation with an in-tune zone highlight.

### Known limitations to flag (Phase 5 additions)
- **Not build-tested**, same caveat as every previous phase — no network access here to run `npm install`. The WAM hosting in particular depends on the exact shape of a real WAM 2.0 plugin's exported module (`createInstance` returning `{ audioNode }`); this matches the published spec, but hasn't been tried against an actual plugin bundle.
- The piano roll's click-and-drag note editor doesn't yet support dragging a note to change its pitch/start time (only resizing duration) — delete-and-recreate is the workaround for now.
- MIDI tracks don't yet have their own automation lanes, FX rack, or plugin chain — only volume/pan/mute/solo are wired to the MIDI synth's gain/panner nodes.
- Quantize only snaps note **start** times, not durations — a quantized note can still end slightly off-grid.

- **Not build-tested**: this environment has no network access to run `npm install`, so the code hasn't been compiled/run. Please run `npm install && npm run dev` and report any TypeScript/runtime errors — Tone.js v14 API surface was matched from documentation, but a small property name may need adjusting (e.g. `BitCrusher.bits`). This also applies to the Phase 3 editing tools (`lib/audioEditing.ts`, `components/EditToolbar.tsx`, the Regions-plugin wiring in `Track.tsx`) and the Phase 4 Buses/Automation code (`components/AutomationLaneEditor.tsx`, the bus routing/automation-scheduling additions in `lib/audioEngine.ts`, `store/useDAWStore.ts`, `hooks/useAudioEngine.ts`, `components/Mixer.tsx`, `components/Track.tsx`) — none of it was run locally either.
- Cut/Copy/Paste/Trim/Split/Silence read the selection's start/end in seconds and re-decode/re-encode the whole track buffer each time — fine for typical song-length clips, but a very large file (many minutes, especially at high sample rates) will feel a beat slower per edit since it's not a streaming/chunked operation.
- Merge Down forces the result to stereo and simple linear (not equal-power) panning — good enough for a quick bounce, but not broadcast-grade gain-staging.
- Effects are "disabled" by neutralizing parameters (wet=0, threshold=0dB, etc.) rather than physically unplugging nodes, to keep the audio graph static and avoid rewiring bugs. This is standard practice but means a disabled effect still consumes a small amount of CPU.
- The de-esser and expander are simplified/approximated implementations, documented as such in code comments — not full production-grade DSP.
- Automation ramps are scheduled as native Web Audio `AudioParam` automation anchored to real time once `playAll()` runs; pausing mid-ramp doesn't freeze it (see "Phase 4" above) — `pauseAll()`/`stopAll()` compensate by cancelling and snapping back, but a mid-ramp value can still be briefly stale immediately after a pause on a very slow device.
- Buses are intentionally simple (volume/pan/mute/solo only, no per-bus FX rack) — routing a track to a bus does not currently carry that track's automation lanes with it; automation still targets the track's own gain/pan node regardless of which bus it feeds into.
- **Phase 6 metering suite, also not build-tested**: `Tone.Split`'s two-output `connect(dest, outputIndex, inputIndex)` wiring was matched from Tone.js v14 docs the same way the rest of the engine was — worth double-checking against the installed version if the L/R taps come back silent or swapped. The Tuner's autocorrelation range (~65–1000Hz, shared with Auto-Tune) means it won't track very low bass notes or a full polyphonic mix; that's expected, not a bug.

### Phase 7 — Export/Delivery (ffmpeg.wasm wired up)

`@ffmpeg/ffmpeg` and `@ffmpeg/util` were already dependencies but unused; this phase actually wires them in.

- **`lib/ffmpeg.ts`** — a lazy singleton loader. Nothing loads ffmpeg.wasm's ~30MB core until the first export that actually needs it (anything beyond a plain 16-bit/source-rate WAV). Since `next.config.js` already sets COOP/COEP headers (`crossOriginIsolated`) specifically for this, it loads the multi-threaded `@ffmpeg/core-mt` build when that's active, and falls back to the single-threaded `@ffmpeg/core` build otherwise (e.g. behind a proxy that strips those headers) so export never just breaks.
- **`lib/exportEngine.ts`** — the orchestration layer, built on the existing `renderProjectOffline`:
  - `encodeMixdown` builds the ffmpeg argv: `-af aresample=sample_rate=…:out_sample_fmt=s16:dither_method=…` handles resampling and dithered bit-depth reduction in one filter pass (dithering only engages when actually truncating to 16-bit — at 24/32-bit it would just add noise for no benefit); codec/container selection (`pcm_s16le`/`pcm_s24le`/`pcm_f32le` for WAV, `flac` with `-sample_fmt`, `libmp3lame` with a bitrate, `libvorbis` with a quality level); and `-metadata` tags plus `-id3v2_version 3` for MP3.
  - `exportStems` re-renders `renderProjectOffline` once per selected track (soloed in isolation — same offline mixer, no new rendering path needed), encodes each, and zips them.
  - `exportBatch` renders the source audio (mixdown or every selected stem) **once**, then reuses that WAV for every queued format/quality combination instead of re-rendering per item — only the ffmpeg encode step repeats.
  - The "keep everything at 16-bit WAV, source rate, no tags" case skips ffmpeg entirely and returns the existing `audioBufferToWav` output directly, so the common quick-export path stays instant.
- **`lib/zip.ts`** — a small dependency-free ZIP writer (STORE method, CRC-32, no compression) so stems/batch results bundle into one `.zip` without adding a JSZip-style dependency; audio's already compressed (mp3/ogg) or self-contained (wav/flac), so skipping deflate costs nothing here.
- **`components/ExportPanel.tsx`** — replaces the old one-click "bounce to WAV" Export button with a modal: **Full Mix** or **Stems** (checkbox track picker), Format/Sample-rate/Bit-depth/Dither/Bitrate controls (fields show/hide based on format), an ID3/metadata tag section, and a **Batch export queue** (add the current settings as a chip, queue as many as you want, exports them all in one pass). Progress bar reflects the actual pipeline stage (mixing → loading encoder → encoding → zipping). Opened from the Navbar's Export button (`toggleExportPanel` in the store).

**Known limitations (Phase 7)**:
- **Not build-tested** — same standing caveat as every phase: no network access in this environment to `npm install` or run `next build`. The ffmpeg.wasm CDN URLs (`unpkg.com/@ffmpeg/core[-mt]@0.12.6`), its `on`/`off`/`exec`/`writeFile`/`readFile` API surface, and the `aresample` filter's `out_sample_fmt`/`dither_method` options were all matched against `@ffmpeg/ffmpeg` 0.12.x's documented API and standard ffmpeg CLI options — worth a real run to confirm before shipping.
- Stems inherit the same limitation `renderProjectOffline` already has: a plain volume/pan/mute/solo bounce, without the live per-track FX rack, bus routing, automation, or WAM plugins (see Phase 5's rendering note) — a stem sounds like the dry/pre-FX signal, not what you hear during playback.
- Dithering is only wired in for the 16-bit WAV/FLAC case; MP3/OGG's own lossy encoders handle their internal quantization themselves, so the dither selector is hidden for those formats rather than silently doing nothing.
- ID3 tags are written via ffmpeg's generic `-metadata` flag for every format (with `-id3v2_version 3` added specifically for MP3); WAV's metadata support varies more by player than MP3/FLAC/OGG's does, so tags are most reliable on the lossy/FLAC outputs.
- The multi-thread ffmpeg-core path depends on `next.config.js`'s COOP/COEP headers actually reaching the browser (some hosts/proxies strip custom headers) — `lib/ffmpeg.ts` checks `window.crossOriginIsolated` at runtime and falls back to the single-thread core automatically, but that fallback path is untested for the same no-network reason as everything else here.

### Phase 8 — Arpeggiator, Sample Slicing, Wavetable/Granular Synthesis, Dynamic EQ, Tape Stop, Time Warping

- **Arpeggiator** (`ArpeggiatorSettings`/`applyArpeggiator` in `lib/audioEngine.ts`, panel in `PianoRoll.tsx`) — a pure note-transform on MIDI tracks: groups overlapping notes into "chords", then re-expands each into a stepped sequence (Up / Down / Up-Down / As played / Random, 1–4 octaves, 1/4–1/16 triplet rates, gate length). It's applied to a *copy* of the notes right before scheduling (`Track.tsx`), so the piano roll always shows exactly what was drawn — turning the arp off always gets you back the original part.
- **Sample Slicing** (`sliceIntoPads` in `lib/audioEditing.ts`, `components/PadSlicer.tsx`) — an MPC-style pad grid (4/8/16 pads) dividing an audio track into equal slices; click a pad or press its mapped key to preview, or bounce any slice out to its own new track for independent editing/re-sequencing. Equal-division slicing is the simple default — transient-snapped slicing is a natural follow-up.
- **Wavetable / Granular Synthesis** (`InstrumentEngine`/`WavetableSettings`/`GranularSettings` in `lib/audioEngine.ts`, engine selector in `PianoRoll.tsx`) — MIDI tracks can now pick an "Engine" alongside the original oscillator:
  - *Wavetable*: morphs the PolySynth's custom periodic wave across four fixed harmonic tables (sine → hollow/odd-harmonic → sawtooth-ish → buzzy/square-ish) via a single Position knob, instead of a fixed oscillator shape.
  - *Granular*: loads a sample and plays it through a small round-robin pool of `Tone.GrainPlayer`s, pitched per note by playback rate, with Grain size and Spread (start-position jitter) controls. "Density" has no direct one-to-one Tone.GrainPlayer knob and is approximated via grain size/overlap rather than a true grains-per-second scheduler — flagged as a simplification below.
- **Dynamic EQ** (`dynamicEq` in `TrackEffectsSettings`, node graph in `AudioEngine.loadTrack`/`setDynamicEq`) — three bands (low/mid/high), each behind its own `Tone.Compressor`, so a band only ducks when *that band's own level* crosses its threshold. Deliberately a different tool from the static EQ3 (fixed cut/boost) and from a whole-signal Compressor: it has per-band frequency *and* threshold/ratio controls, and reads more like "an EQ that reacts to level" than "a compressor split by frequency". Bypasses cleanly via a dry/wet crossfade rather than actually removing the band-split filters, so toggling it off doesn't touch phase response.
- **Tape Stop / Tape Start** (`AudioEngine.triggerTapeStop`/`triggerTapeStart`, live-trigger box in `FXRack.tsx`) — a triggered playback-rate ramp (exponential or linear) down to near-zero and back, mimicking a tape machine's motor decelerating/accelerating. Implemented as an rAF-driven ramp on `Tone.Player.playbackRate` rather than a Tone signal ramp — see the limitation note below.
- **Time Warping** (`lib/timeWarp.ts`, `components/WarpEditor.tsx`) — elastic-audio warp markers, distinct from the existing single-rate Time Stretch tool: each marker pins a point in the source audio to a point on the timeline, and every in-between segment is WSOLA-stretched independently to fit, so one clip can speed up in one section and slow down in another (e.g. snapping a loose take onto a click track piece by piece). The editor is a numeric marker list rather than drag-on-waveform handles — a deliberate scope simplification (see below).

**Known limitations (Phase 8 additions)**:
- **Not build-tested**, same standing caveat as every phase — no network access here for `npm install`/`next build`. `Tone.GrainPlayer`'s constructor options, `Tone.Compressor`'s per-instance params, and `Tone.PolySynth`'s `oscillator: { type: "custom", partials }` API were matched against Tone.js 14.9's documented surface but not run.
- Tape Stop/Start assumes `Tone.Player.playbackRate` is a plain number property on this Tone.js version (not an automatable `Tone.Param`), so the ramp is driven by `requestAnimationFrame` rather than a sample-accurate audio-rate ramp — audibly fine for a manual performance trigger, but it won't line up with other automation to sub-frame precision the way a real Tone signal ramp would.
- Granular "density" doesn't have a direct one-to-one control on `Tone.GrainPlayer`; it's approximated through grain size and start-position jitter rather than a true grains-per-second voice scheduler.
- Time Warp's per-segment WSOLA passes are independent (no shared analysis window across a marker boundary), so very tightly-spaced markers on percussive material can leave a faint click right at the seam — a single continuous time-varying-hop WSOLA pass would remove this, at a lot more implementation complexity.
- The Warp Editor is a numeric source-time/timeline-time list rather than draggable markers directly on the waveform; functionally equivalent, but less immediate than a canvas-based drag UI would be.
- Sample Slicing divides the clip into equal-length pads; it doesn't (yet) snap pad boundaries to detected transients.

### Phase 9 — Retrospective Recording, Phase Inversion, DC Offset Removal, Spatial Audio (3D/Surround)

- **Retrospective Recording / Capture MIDI** (`lib/midiInput.ts`, controls in `components/PianoRoll.tsx`) — a background listener (`midiCapture`) that buffers incoming note events continuously, whether or not anything is armed to record: a real MIDI controller via the Web MIDI API, *and* a QWERTY "computer keyboard as piano" fallback (A–L row = white/black keys, base note C4) so it works with no MIDI hardware at all. Toggle **Capture MIDI** on a MIDI track, play something, then hit **Capture last Ns** — it drops everything from the rolling buffer onto that track's piano roll, anchored so the most recently played note lands at the current playhead. The buffer itself tracks wall-clock time (`performance.now()`), independent of `Tone.Transport`, since input can arrive with the transport stopped.
- **Phase Inversion / Polarity Flip** (`polarityInverted` in `TrackEffectsSettings`, `polarity` node + `AudioEngine.setPolarity`, toggle in `FXRack.tsx`) — a unity/-1 `Tone.Gain` sitting right after the `Player`, ahead of every other node in the chain, so flipping it inverts the raw source rather than some already-processed version of it. Classic use: two mics on the same source partially cancelling when summed — flipping one track's polarity restores the lost energy (mostly low end). Purely a live sign flip, so toggling it back is lossless (unlike the Restoration tools, which are destructive).
- **DC Offset Removal** (`removeDcOffset` in `lib/audioEditing.ts`, wired through `applyDcOffsetRemoval` in the store, "Apply" box in `FXRack.tsx`) — re-centers a waveform that has drifted off the zero line (a symptom of some audio interfaces/preamps). Implemented as a very-low-cutoff (~0.05 Hz) single-pole high-pass per channel rather than a single global mean-subtraction, so it also removes a *slowly drifting* offset across a long recording, not just one fixed value — same destructive "decode → transform → re-encode" pattern as the rest of the Restoration suite.
- **Spatial Audio / 3D & Surround** (`spatial` in `TrackEffectsSettings`, `spatialPanner`/`spatialDry`/`spatialWet` nodes + `AudioEngine.setSpatial`, "Spatial Audio (3D)" section in `FXRack.tsx`) — positions a track at an (x, y, z) point around the listener using a real HRTF `Tone.Panner3D` (a thin wrapper on the native Web Audio `PannerNode`), crossfaded in against the existing plain stereo `Panner` so enabling/disabling it is a true bypass. This is genuinely the same underlying technique object-based formats like Dolby Atmos use to render a 3D mix over ordinary stereo output (headphones or two speakers) — full binaural 3D imaging, not a gimmick. **Known, deliberate scope limit**: true discrete 5.1/7.1 *hardware* output isn't something a browser tab can reliably guarantee (it depends on the OS audio device's channel layout and isn't standard on typical consumer setups), so rather than half-implement a channel-count selector that would silently downmix to stereo on most machines, this ships the binaural HRTF path as the practical, always-works substitute for "surround" — it's genuinely spatial, just rendered through 2 channels instead of discrete 6/8.

**Known limitations (Phase 9 additions)**:
- **Not build-tested**, same standing caveat as every phase — `Tone.Panner3D`'s constructor options (`panningModel`, `positionX/Y/Z`, `distanceModel`, `refDistance`, `rolloffFactor`) were matched against Tone.js 14.9's documented surface but not run; if `positionX` etc. aren't exposed as `Param`s on the installed version, `AudioEngine.setSpatial` falls back to the older `setPosition(x, y, z)` method.
- Web MIDI (`navigator.requestMIDIAccess`) isn't supported in every browser (Safari's support has historically been patchy/behind a flag) — the UI reports this and falls back to the computer-keyboard input, which still feeds the same retrospective buffer.
- The computer-keyboard fallback isn't velocity-sensitive (every note captures at a fixed velocity) and only covers about two octaves at once — it's meant for sketching a quick idea, not full keyboard performance.
- The retrospective buffer keeps at most 180 seconds of history and is capped to whatever a given browser tab's memory/GC comfortably handles for a note-event array; it's an in-memory ring buffer, not a persisted recording, so it's cleared on page reload.
- Spatial positioning is per-track only; there's no global "room"/reverb-per-distance model beyond the PannerNode's own built-in distance attenuation (`refDistance`/`rolloffFactor`) — pairing it with the existing Convolution Reverb (Phase 8) for a sense of space is a natural manual combination rather than something wired together automatically.
- DC Offset Removal's single-pole high-pass, at ~0.05 Hz, is deliberately far below audible range so it never colors the tone — but on extremely short clips (well under a second) the filter may not have time to fully settle; fine for normal song-length material.

