import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectImageHeader, timeFromExif, processPhoto } from '../src/photo';

afterEach(() => vi.unstubAllGlobals());

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12); view.setUint32(16, width); view.setUint32(20, height); return bytes;
}
describe('photo file and memory budgets', () => {
  it('sniffs content and validates dimensions before allocating pixels', () => {
    expect(inspectImageHeader(png(8000, 6000))).toMatchObject({ mime: 'image/png', width: 8000, height: 6000 });
    expect(() => inspectImageHeader(png(16000, 12000))).toThrow('48 MP');
    expect(() => inspectImageHeader(png(0, 0))).toThrow();
  });
  it('detects JPEG SOF dimensions regardless of external MIME', () => {
    const bytes = new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,11,8,2,88,3,32,1,1,17,0]);
    expect(inspectImageHeader(bytes)).toMatchObject({ mime: 'image/jpeg', width: 800, height: 600 });
  });
  it('rejects HEIC with an actionable conversion message', () => {
    const bytes = new Uint8Array(32); bytes.set(new TextEncoder().encode('ftypheic'), 4);
    expect(() => inspectImageHeader(bytes)).toThrow('转换');
  });
  it('releases decoded pixels and the allocated canvas when cancelled immediately after decode', async () => {
    const controller = new AbortController(), close = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => controller.abort() }) };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 100, close })));
    vi.stubGlobal('document', { createElement: () => canvas });
    await expect(processPhoto(new Blob(['fixture']), { mode: 'original' }, 'modern', 100, controller.signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
});
describe('truthful EXIF time evidence', () => {
  it('keeps camera wall time unknown instead of applying host timezone', () => {
    const result = timeFromExif({ DateTimeOriginal: '2026:07:21 09:14:32', SubSecTimeOriginal: '125' });
    expect(result).toMatchObject({ value: '2026-07-21T09:14:32.125', precision: 'local', raw: '2026:07:21 09:14:32', subsecond: '125' });
    expect(result.utc).toBeUndefined(); expect(result.offset).toBeUndefined();
  });
  it('uses only explicit offsets to produce UTC and retains originals', () => {
    expect(timeFromExif({ DateTimeOriginal: '2026:07:21 09:00:00', OffsetTimeOriginal: '+09:00' })).toMatchObject({ value: '2026-07-21T09:00:00', precision: 'instant', utc: '2026-07-21T00:00:00.000Z', offset: '+09:00' });
  });
  it('does not invent midnight for date-only or upload time for unknown', () => {
    expect(timeFromExif({ DateTimeOriginal: '2026:07:21' })).toMatchObject({ value: '2026-07-21', precision: 'date' });
    expect(timeFromExif({})).toEqual({ precision: 'unknown', source: 'unknown' });
    expect(timeFromExif({ DateTimeOriginal: '2026:02:30 09:00:00' }).precision).toBe('unknown');
    expect(timeFromExif({ DateTimeOriginal: '2026:07:21 09:00:00', OffsetTimeOriginal: '+25:00' }).utc).toBeUndefined();
  });
});
