export type PosterFormat = 'png' | 'jpeg' | 'webp';

export const POSTER_FORMAT_LABELS: Record<PosterFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };

export const POSTER_FORMATS = Object.keys(POSTER_FORMAT_LABELS) as PosterFormat[];

export const DEFAULT_POSTER_FORMAT: PosterFormat = 'jpeg';

export const LOSSY_QUALITY = 0.9;

export const PNG_TYPE = 'image/png';

export const PNG_EXTENSION = 'png';

const TYPE_BY_FORMAT: Record<PosterFormat, string> = { png: PNG_TYPE, jpeg: 'image/jpeg', webp: 'image/webp' };

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = { [PNG_TYPE]: PNG_EXTENSION, 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export interface EncodeHost {
  createBitmap: (blob: Blob) => Promise<ImageBitmap>;
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
}

export const extensionOf = (blob: Blob): string => EXTENSION_BY_TYPE[blob.type] ?? PNG_EXTENSION;

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the poster canvas produced no image'))), type, quality);
  });
}

export async function encodePoster(png: Blob, format: PosterFormat, host: EncodeHost): Promise<Blob> {
  if (format === 'png') return png;
  const bitmap = await host.createBitmap(png);
  try {
    const canvas = host.createCanvas(bitmap.width, bitmap.height);
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('the poster canvas has no 2D context');
    drawing.drawImage(bitmap, 0, 0);
    return await canvasBlob(canvas, TYPE_BY_FORMAT[format], LOSSY_QUALITY);
  } finally {
    bitmap.close();
  }
}
