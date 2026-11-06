import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ARCHIVE_TYPE, packArchive } from '../utils/poster/poster-archive';

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const pngOf = (fill: number, length: number): Blob =>
  new Blob([new Uint8Array([...PNG_SIGNATURE, ...Array.from({ length }, () => fill)])], { type: 'image/png' });

const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

interface LocalEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
}

function localEntriesOf(bytes: Uint8Array): LocalEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: LocalEntry[] = [];
  let offset = 0;
  while (offset + LOCAL_HEADER_SIZE <= bytes.length && view.getUint32(offset, true) === LOCAL_HEADER_SIGNATURE) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + LOCAL_HEADER_SIZE, offset + LOCAL_HEADER_SIZE + nameLength));
    entries.push({ name, method: view.getUint16(offset + 8, true), compressedSize, size: view.getUint32(offset + 22, true) });
    offset += LOCAL_HEADER_SIZE + nameLength + extraLength + compressedSize;
  }
  return entries;
}

describe('packArchive', () => {
  it('returns a zip blob holding every entry under its name with its bytes', async () => {
    const archive = await packArchive([
      { name: 'senkutools-poster-sena-1.png', blob: pngOf(1, 40) },
      { name: 'senkutools-poster-sena-2.png', blob: pngOf(2, 25) },
    ]);
    expect(archive.type).toBe(ARCHIVE_TYPE);
    const unpacked = unzipSync(await bytesOf(archive));
    expect(Object.keys(unpacked)).toEqual(['senkutools-poster-sena-1.png', 'senkutools-poster-sena-2.png']);
    expect(unpacked['senkutools-poster-sena-1.png']).toEqual(await bytesOf(pngOf(1, 40)));
    expect(unpacked['senkutools-poster-sena-2.png']).toEqual(await bytesOf(pngOf(2, 25)));
  });

  it('stores every entry without compression, as a PNG is already compressed', async () => {
    const archive = await packArchive([
      { name: 'one.png', blob: pngOf(7, 5000) },
      { name: 'two.png', blob: pngOf(9, 3000) },
    ]);
    const entries = localEntriesOf(await bytesOf(archive));
    expect(entries.map((entry) => entry.name)).toEqual(['one.png', 'two.png']);
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(entry.compressedSize).toBe(entry.size);
    }
    expect(entries.map((entry) => entry.size)).toEqual([PNG_SIGNATURE.length + 5000, PNG_SIGNATURE.length + 3000]);
  });

  it('keeps the order of the entries it is given', async () => {
    const archive = await packArchive(['c.png', 'a.png', 'b.png'].map((name) => ({ name, blob: pngOf(1, 3) })));
    expect(localEntriesOf(await bytesOf(archive)).map((entry) => entry.name)).toEqual(['c.png', 'a.png', 'b.png']);
  });
});
