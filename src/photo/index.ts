import exifr from 'exifr';
import type { AssetManifest, Coordinate, PhotoEdit, PhotoRecord, TimeEvidence } from '../domain';
import type { AssetStore } from '../storage';
import { hashBytes } from '../storage';
import { throwIfAborted } from '../runtime';

export const PHOTO_LIMITS = { maxFiles: 50, maxPixels: 48_000_000, maxBytes: 100 * 1024 * 1024, maxDimension: 32_768, thumbnailEdge: 256, proxyEdge: 1600 } as const;
export const PHOTO_ALGORITHM_VERSION = 'local-palette-1';
export interface ImageHeader { mime: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number; animated?: boolean }
export interface DecodedPhoto { image: CanvasImageSource; width: number; height: number; dispose(): void }
export interface ImportedPhoto { photo: PhotoRecord; assets: AssetManifest[]; coordinate?: Coordinate; time: TimeEvidence; duplicate: boolean; warnings: string[] }
function textAt(bytes: Uint8Array, start: number, count: number): string { return String.fromCharCode(...bytes.subarray(start, start + count)); }
function uint24(bytes: Uint8Array, at: number): number { return bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16; }

/** Validate declared dimensions before decoding to avoid unbounded image allocations. */
export function inspectImageHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 16) throw new Error('图片文件不完整。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: ImageHeader | undefined;
  if (bytes[0] === 0x89 && textAt(bytes, 1, 3) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes.length >= 24) {
    if (textAt(bytes, 12, 4) !== 'IHDR') throw new Error('PNG 缺少尺寸头。');
    header = { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    let cursor = 8;
    while (cursor + 12 <= bytes.length) {
      const length = view.getUint32(cursor), type = textAt(bytes, cursor + 4, 4);
      if (type === 'acTL' && cursor + 16 <= bytes.length) header.animated = view.getUint32(cursor + 8) > 1;
      if (type === 'IDAT') break;
      if (length > bytes.length - cursor - 12) break;
      cursor += length + 12;
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 4 <= bytes.length) {
      if (bytes[cursor] !== 0xff) { cursor++; continue; }
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (cursor + 2 > bytes.length) break;
      const length = view.getUint16(cursor);
      if (length < 2 || cursor + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        header = { mime: 'image/jpeg', height: view.getUint16(cursor + 3), width: view.getUint16(cursor + 5) }; break;
      }
      cursor += length;
    }
  } else if (textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP') {
    let cursor = 12;
    while (cursor + 12 <= bytes.length) {
      const type = textAt(bytes, cursor, 4), size = view.getUint32(cursor + 4, true), at = cursor + 8;
      if (type === 'VP8X' && cursor + 18 <= bytes.length) { header = { mime: 'image/webp', width: uint24(bytes, at + 4) + 1, height: uint24(bytes, at + 7) + 1, animated: !!(bytes[at] & 2) }; break; }
      if (type === 'VP8 ' && at + 10 <= bytes.length && bytes[at + 3] === 0x9d && bytes[at + 4] === 1 && bytes[at + 5] === 0x2a) { header = { mime: 'image/webp', width: view.getUint16(at + 6, true) & 0x3fff, height: view.getUint16(at + 8, true) & 0x3fff }; break; }
      if (type === 'VP8L' && at + 5 <= bytes.length && bytes[at] === 0x2f) { const bits = view.getUint32(at + 1, true); header = { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1 }; break; }
      cursor += 8 + size + (size % 2);
    }
  } else if (textAt(bytes, 4, 4) === 'ftyp') {
    throw new Error('此版本不解码 HEIC/HEIF/AVIF，请先转换为 JPEG、PNG 或 WebP。原文件未修改。');
  }
  if (!header) throw new Error('仅支持可读取尺寸的 JPEG、PNG、WebP 静态图片；文件扩展名不能代替实际格式。');
  if (!header.width || !header.height || header.width * header.height > PHOTO_LIMITS.maxPixels || Math.max(header.width, header.height) > PHOTO_LIMITS.maxDimension) throw new Error('图片超过 48 MP 或浏览器尺寸预算，请先缩小后导入。');
  if (header.animated) throw new Error('请将动画图片导出为静态 JPEG、PNG 或 WebP 后导入。');
  return header;
}

export function timeFromExif(metadata: Record<string, unknown>): TimeEvidence {
  const raw = typeof metadata.DateTimeOriginal === 'string' ? metadata.DateTimeOriginal.trim() : undefined;
  if (!raw) return { precision: 'unknown', source: 'unknown' };
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(raw);
  if (!match) return { precision: 'unknown', source: 'exif', raw };
  const [, year, month, day, hour, minute, second] = match;
  const date = `${year}-${month}-${day}`;
  const check = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date) return { precision: 'unknown', source: 'exif', raw };
  if (hour === undefined) return { value: date, precision: 'date', source: 'exif', raw };
  if (+hour > 23 || +minute > 59 || +second > 59) return { precision: 'unknown', source: 'exif', raw };
  const subsecond = typeof metadata.SubSecTimeOriginal === 'string' || typeof metadata.SubSecTimeOriginal === 'number' ? String(metadata.SubSecTimeOriginal).trim() : undefined;
  const fraction = subsecond && /^\d{1,9}$/.test(subsecond) ? `.${subsecond}` : '';
  const value = `${date}T${hour}:${minute}:${second}${fraction}`;
  const offset = typeof metadata.OffsetTimeOriginal === 'string' ? metadata.OffsetTimeOriginal.trim() : undefined;
  if (offset && /^(?:[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00|Z)$/.test(offset)) {
    const instant = new Date(value + offset);
    if (Number.isFinite(instant.getTime())) return { value, precision: 'instant', source: 'exif', raw, offset, subsecond, utc: instant.toISOString() };
  }
  return { value, precision: 'local', source: 'exif', raw, subsecond };
}

export async function decodePhoto(blob: Blob, signal?: AbortSignal): Promise<DecodedPhoto> {
  throwIfAborted(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
      if (signal?.aborted) { bitmap.close(); throwIfAborted(signal); }
      return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch (error) { if (signal?.aborted || typeof document === 'undefined') throw error; }
  }
  if (typeof document === 'undefined') throw new Error('当前环境没有图片解码能力。');
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    image.src = url;
    await image.decode();
    throwIfAborted(signal);
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => { URL.revokeObjectURL(url); image.src = ''; } };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') throw new Error('图片处理需要浏览器 Canvas。');
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height)); return canvas;
}
function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', willReadFrequently: true });
  if (!context) throw new Error('浏览器无法分配图片处理画布，请减小图片后重试。');
  return context;
}
function resized(width: number, height: number, edge: number): { width: number; height: number } { const ratio = Math.min(1, edge / Math.max(width, height)); return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }; }
export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = .92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败或画布超过设备限制。')), type, quality));
}
async function createProxy(decoded: DecodedPhoto, edge: number): Promise<{ blob: Blob; width: number; height: number }> {
  const size = resized(decoded.width, decoded.height, edge), canvas = makeCanvas(size.width, size.height);
  try { const ctx = contextFor(canvas); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(decoded.image, 0, 0, size.width, size.height); return { blob: await canvasToBlob(canvas, 'image/webp', .85), ...size }; }
  finally { canvas.width = 1; canvas.height = 1; }
}
export async function importPhoto(file: File | Blob, store: AssetStore, signal?: AbortSignal): Promise<ImportedPhoto> {
  throwIfAborted(signal);
  if (!file.size || file.size > PHOTO_LIMITS.maxBytes) throw new Error('单张图片须介于 1 字节和 100 MiB 之间。');
  const header = inspectImageHeader(new Uint8Array(await file.slice(0, 1_048_576).arrayBuffer()));
  const hash = await hashBytes(file);
  const existing = await store.getManifest(hash);
  const name = file instanceof File ? file.name : '本地照片';
  const warnings: string[] = [];
  let metadata: Record<string, unknown> = {};
  try {
    // reviveValues:false is intentional: an unknown camera timezone must stay unknown.
    metadata = await exifr.parse(file, { pick: ['Orientation', 'DateTimeOriginal', 'SubSecTimeOriginal', 'OffsetTimeOriginal', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'], translateValues: false, reviveValues: false }) ?? {};
  } catch { warnings.push('未读取到完整 EXIF；照片可继续编辑，请核对位置和拍摄日期。'); }
  throwIfAborted(signal);
  const time = timeFromExif(metadata);
  let coordinate: Coordinate | undefined;
  const gps = (value: unknown, ref: unknown): number | undefined => {
    if (typeof value === 'number') return value;
    if (Array.isArray(value) && value.length === 3 && value.every(part => typeof part === 'number' && Number.isFinite(part))) return (value[0] + value[1] / 60 + value[2] / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1);
    return undefined;
  };
  const latitude = typeof metadata.latitude === 'number' ? metadata.latitude : gps(metadata.GPSLatitude, metadata.GPSLatitudeRef);
  const longitude = typeof metadata.longitude === 'number' ? metadata.longitude : gps(metadata.GPSLongitude, metadata.GPSLongitudeRef);
  if (latitude !== undefined && longitude !== undefined && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) coordinate = [longitude, latitude];
  const original = existing ?? await store.putAsset(file.slice(0, file.size, header.mime), { kind: 'original', mime: header.mime, name, width: header.width, height: header.height, license: 'user-owned' });
  const allAssets = existing ? await store.listAssets() : [];
  let thumbnail = allAssets.find(asset => asset.sourceAssetId === original.id && asset.kind === 'thumbnail');
  let proxy = allAssets.find(asset => asset.sourceAssetId === original.id && asset.kind === 'proxy');
  let width = header.width, height = header.height;
  if (!thumbnail || !proxy) {
    const decoded = await decodePhoto(file, signal);
    try {
      width = decoded.width; height = decoded.height;
      if (width * height > PHOTO_LIMITS.maxPixels) throw new Error('解码图片超过 48 MP 预算。');
      const thumb = await createProxy(decoded, PHOTO_LIMITS.thumbnailEdge); throwIfAborted(signal);
      thumbnail = await store.putAsset(thumb.blob, { kind: 'thumbnail', sourceAssetId: original.id, width: thumb.width, height: thumb.height, license: 'user-owned' });
      const preview = await createProxy(decoded, PHOTO_LIMITS.proxyEdge); throwIfAborted(signal);
      proxy = await store.putAsset(preview.blob, { kind: 'proxy', sourceAssetId: original.id, width: preview.width, height: preview.height, license: 'user-owned' });
    } finally { decoded.dispose(); }
  } else if (Number(metadata.Orientation) >= 5 && Number(metadata.Orientation) <= 8) { width = header.height; height = header.width; }
  const exif: NonNullable<PhotoRecord['exif']> = {};
  if (typeof metadata.DateTimeOriginal === 'string') exif.DateTimeOriginal = metadata.DateTimeOriginal;
  if (metadata.SubSecTimeOriginal !== undefined) exif.SubSecTimeOriginal = String(metadata.SubSecTimeOriginal);
  if (typeof metadata.OffsetTimeOriginal === 'string') exif.OffsetTimeOriginal = metadata.OffsetTimeOriginal;
  if (typeof metadata.Orientation === 'number') exif.Orientation = metadata.Orientation;
  if (coordinate) { exif.GPSLongitude = coordinate[0]; exif.GPSLatitude = coordinate[1]; }
  const photo: PhotoRecord = { id: `photo-${hash}`, assetId: original.id, thumbnailAssetId: thumbnail.id, proxyAssetId: proxy.id, name, mime: header.mime, width, height, time, exif, createdAt: new Date().toISOString() };
  return { photo, assets: [...new Map([original, thumbnail, proxy].map(asset => [asset.id, asset])).values()], coordinate, time, duplicate: !!existing, warnings };
}

export async function importPhotos(files: File[], store: AssetStore, options: { signal?: AbortSignal; onFile?: (index: number, total: number, name: string) => void } = {}): Promise<{ imported: ImportedPhoto[]; errors: Array<{ name: string; message: string }> }> {
  if (files.length > PHOTO_LIMITS.maxFiles) throw new Error('每批最多导入 50 张照片。请分批处理。');
  const imported: ImportedPhoto[] = [], errors: Array<{ name: string; message: string }> = [];
  for (let index = 0; index < files.length; index++) {
    throwIfAborted(options.signal); options.onFile?.(index, files.length, files[index].name);
    try { imported.push(await importPhoto(files[index], store, options.signal)); }
    catch (error) { if (options.signal?.aborted) throw error; errors.push({ name: files[index].name, message: error instanceof Error ? error.message : String(error) }); }
  }
  return { imported, errors };
}

function clamp(value: number, low: number, high: number): number { return Math.min(high, Math.max(low, value)); }
function canonicalStyle(style: string): string { return ({ inkwash: 'ink', handdrawn: 'sketch', minimal: 'modern' } as Record<string, string>)[style] ?? style; }

/** Local, versioned color/edge recipe. Crop/slot transforms remain Composition's responsibility. */
export async function processPhoto(blob: Blob, edits: Partial<PhotoEdit> = {}, styleId = 'modern', size: number | { width: number; height: number } = 1600, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  throwIfAborted(signal);
  const decoded = await decodePhoto(blob, signal);
  const maximumEdge = typeof size === 'number' ? size : Math.max(size.width, size.height);
  if (!Number.isFinite(maximumEdge) || maximumEdge < 1 || maximumEdge > 8192) { decoded.dispose(); throw new Error('照片处理长边必须介于 1 和 8192 像素。'); }
  const dimensions = resized(decoded.width, decoded.height, maximumEdge);
  const canvas = makeCanvas(dimensions.width, dimensions.height);
  try {
    const ctx = contextFor(canvas); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
  } finally { decoded.dispose(); }
  throwIfAborted(signal);
  const mode = edits.mode ?? 'local', style = canonicalStyle(styleId);
  const exposure = 2 ** clamp(edits.exposure ?? 0, -2, 2), contrast = clamp(edits.contrast ?? 1, 0, 2), saturation = clamp(edits.saturation ?? 1, 0, 2), intensity = clamp(edits.intensity ?? .7, 0, 1);
  if (mode === 'original' && exposure === 1 && contrast === 1 && saturation === 1) return canvas;
  const ctx = contextFor(canvas), image = ctx.getImageData(0, 0, canvas.width, canvas.height), pixels = image.data;
  const useArt = mode === 'local' && style !== 'modern' && intensity > 0;
  // Luminance is a bounded single-channel buffer used by the two edge-aware recipes.
  let luminance: Uint8Array | undefined;
  if (useArt && (style === 'ink' || style === 'sketch')) {
    luminance = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < luminance.length; i++) luminance[i] = pixels[i * 4] * .2126 + pixels[i * 4 + 1] * .7152 + pixels[i * 4 + 2] * .0722;
  }
  try {
    for (let y = 0; y < canvas.height; y++) {
      if (y % 128 === 0) { throwIfAborted(signal); if (y) await new Promise<void>(resolve => setTimeout(resolve, 0)); }
      for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4;
        const grey = pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722;
        let r = clamp(((grey + (pixels[offset] - grey) * saturation) * exposure - 128) * contrast + 128, 0, 255);
        let g = clamp(((grey + (pixels[offset + 1] - grey) * saturation) * exposure - 128) * contrast + 128, 0, 255);
        let b = clamp(((grey + (pixels[offset + 2] - grey) * saturation) * exposure - 128) * contrast + 128, 0, 255);
        if (useArt) {
          const light = .2126 * r + .7152 * g + .0722 * b;
          let ar = r, ag = g, ab = b;
          if (style === 'ink') {
            const i = y * canvas.width + x, edge = luminance ? Math.abs(luminance[i] - luminance[Math.min(i + 1, luminance.length - 1)]) + Math.abs(luminance[i] - luminance[Math.min(i + canvas.width, luminance.length - 1)]) : 0;
            const ink = clamp(Math.round(light / 38) * 38 - edge * .55, 0, 255);
            ar = ink * .92 + 16; ag = ink * .94 + 14; ab = ink * .89 + 12;
          } else if (style === 'sketch') {
            const i = y * canvas.width + x, edge = luminance ? Math.abs(luminance[i] - luminance[Math.min(i + 1, luminance.length - 1)]) + Math.abs(luminance[i] - luminance[Math.min(i + canvas.width, luminance.length - 1)]) : 0;
            ar = Math.round(r / 30) * 30 * .76 + 56 - edge * .32; ag = Math.round(g / 30) * 30 * .76 + 54 - edge * .32; ab = Math.round(b / 30) * 30 * .73 + 50 - edge * .32;
          } else if (style === 'parchment') {
            ar = r * .393 + g * .769 + b * .189; ag = r * .349 + g * .686 + b * .168; ab = r * .272 + g * .534 + b * .131;
          } else if (style === 'oil') {
            ar = Math.round(r / 24) * 24 * 1.04; ag = Math.round(g / 24) * 24; ab = Math.round(b / 24) * 24 * .94;
          } else if (style === 'poster') {
            const tones = [[35, 65, 71], [66, 111, 119], [200, 117, 77], [229, 189, 133], [250, 233, 195]];
            const tone = tones[Math.min(4, Math.floor(light / 51.2))]; ar = tone[0]; ag = tone[1]; ab = tone[2];
          }
          r += (ar - r) * intensity; g += (ag - g) * intensity; b += (ab - b) * intensity;
        }
        pixels[offset] = r; pixels[offset + 1] = g; pixels[offset + 2] = b;
      }
    }
    ctx.putImageData(image, 0, 0); return canvas;
  } catch (error) { canvas.width = 1; canvas.height = 1; throw error; }
}

export async function saveDerivedPhoto(blob: Blob, sourceAssetId: string, edits: Partial<PhotoEdit>, styleId: string, store: AssetStore, signal?: AbortSignal): Promise<AssetManifest> {
  const canvas = await processPhoto(blob, edits, styleId, 4096, signal);
  try { throwIfAborted(signal); return await store.putAsset(await canvasToBlob(canvas), { kind: 'derived', sourceAssetId, width: canvas.width, height: canvas.height, license: 'user-owned' }); }
  finally { canvas.width = 1; canvas.height = 1; }
}
