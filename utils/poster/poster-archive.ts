import { zipSync, type Zippable } from 'fflate';

export interface ArchiveEntry {
  name: string;
  blob: Blob;
}

export const ARCHIVE_TYPE = 'application/zip';

export async function packArchive(entries: readonly ArchiveEntry[]): Promise<Blob> {
  const files: Zippable = {};
  for (const entry of entries) files[entry.name] = [new Uint8Array(await entry.blob.arrayBuffer()), { level: 0 }];
  return new Blob([zipSync(files)], { type: ARCHIVE_TYPE });
}
