import type { Database } from '../shared/database';
import { element } from '../shared/dom';
import type { Settings } from '../shared/settings';
import { fetchPosterArt, loadArtImage } from './poster-art';
import type { PosterDialogHost } from './poster-dialog';
import { readPosterTheme, renderPoster } from './poster-render';

const IMAGE_FETCH_OPTIONS = { cache: 'reload', credentials: 'omit' } as const;

export interface PosterHostSources {
  pageDocument: Document;
  database: Database;
  settings: Pick<Settings, 'commission'>;
  fetchNickname: PosterDialogHost['fetchNickname'];
  nextFrame: (run: () => void) => void;
}

export function downloadBlob(pageDocument: Document, blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  pageDocument.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const copyImageBlob = (blob: Blob): Promise<void> => navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);

function createCanvas(pageDocument: Document, width: number, height: number): HTMLCanvasElement {
  const canvas = pageDocument.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createPosterDialogHost(sources: PosterHostSources): PosterDialogHost {
  const { pageDocument } = sources;
  return {
    pageDocument,
    database: sources.database,
    settings: sources.settings,
    fetchArt: (slugs, signal) => fetchPosterArt(slugs, undefined, signal),
    loadImage: (art) => loadArtImage(art, { fetchImage: (url) => fetch(url, IMAGE_FETCH_OPTIONS), createBitmap: (blob) => createImageBitmap(blob) }),
    fetchNickname: sources.fetchNickname,
    render: (content) => renderPoster(content, readPosterTheme(pageDocument), { createCanvas: (width, height) => createCanvas(pageDocument, width, height) }),
    nextFrame: sources.nextFrame,
    download: (blob, fileName) => downloadBlob(pageDocument, blob, fileName),
    copyImage: copyImageBlob,
  };
}
