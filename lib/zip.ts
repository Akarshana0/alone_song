/**
 * A tiny, dependency-free ZIP writer (STORE method — no compression).
 *
 * Stems/batch export need to hand the user back a single .zip containing
 * several audio files. Pulling in a full zip library (JSZip etc.) for that
 * one job is overkill, and this project already has no zip dependency in
 * package.json, so this implements just enough of the ZIP spec: local file
 * headers, an End Of Central Directory record, and CRC-32 checksums.
 * Audio is already compressed (mp3/ogg) or intentionally uncompressed
 * (wav/flac already compresses internally), so STORE (no deflate) costs
 * nothing in practice and keeps this file tiny and dependency-free.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time packed into the 16+16 bits ZIP local headers expect. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

function writeUint16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}
function writeUint32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

/** Builds a .zip Blob (STORE method) from a list of named byte buffers. */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());

  const localChunks: Uint8Array<ArrayBuffer>[] = [];
  const centralChunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // --- Local file header (30 bytes + name) ---
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    writeUint32LE(lv, 0, 0x04034b50); // local file header signature
    writeUint16LE(lv, 4, 20); // version needed
    writeUint16LE(lv, 6, 0); // flags
    writeUint16LE(lv, 8, 0); // method: 0 = store
    writeUint16LE(lv, 10, time);
    writeUint16LE(lv, 12, date);
    writeUint32LE(lv, 14, crc);
    writeUint32LE(lv, 18, size); // compressed size
    writeUint32LE(lv, 22, size); // uncompressed size
    writeUint16LE(lv, 26, nameBytes.length);
    writeUint16LE(lv, 28, 0); // extra field length
    local.set(nameBytes, 30);

    localChunks.push(local, entry.data);

    // --- Central directory record (46 bytes + name) ---
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    writeUint32LE(cv, 0, 0x02014b50); // central directory signature
    writeUint16LE(cv, 4, 20); // version made by
    writeUint16LE(cv, 6, 20); // version needed
    writeUint16LE(cv, 8, 0); // flags
    writeUint16LE(cv, 10, 0); // method: store
    writeUint16LE(cv, 12, time);
    writeUint16LE(cv, 14, date);
    writeUint32LE(cv, 16, crc);
    writeUint32LE(cv, 20, size);
    writeUint32LE(cv, 24, size);
    writeUint16LE(cv, 28, nameBytes.length);
    writeUint16LE(cv, 30, 0); // extra field length
    writeUint16LE(cv, 32, 0); // comment length
    writeUint16LE(cv, 34, 0); // disk number start
    writeUint16LE(cv, 36, 0); // internal attrs
    writeUint32LE(cv, 38, 0); // external attrs
    writeUint32LE(cv, 42, offset); // offset of local header
    central.set(nameBytes, 46);

    centralChunks.push(central);

    offset += local.length + entry.data.length;
  }

  const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  writeUint32LE(ev, 0, 0x06054b50); // end of central directory signature
  writeUint16LE(ev, 4, 0); // disk number
  writeUint16LE(ev, 6, 0); // disk with central dir
  writeUint16LE(ev, 8, entries.length); // entries on this disk
  writeUint16LE(ev, 10, entries.length); // total entries
  writeUint32LE(ev, 12, centralSize);
  writeUint32LE(ev, 16, centralOffset);
  writeUint16LE(ev, 20, 0); // comment length

  return new Blob([...localChunks, ...centralChunks, end], { type: "application/zip" });
}
