import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import exifr from 'exifr';
import type { ArtworkDocument, ProjectDocument } from '../../src/domain';
import type { ExportReceipt } from '../../src/export';
import type { PackageManifest } from '../../src/storage';

export const APP_URL = 'http://127.0.0.1:4173/';
export const GPS_PHOTOS = ['synthetic-gps.jpg', 'synthetic-gps-b.jpg', 'synthetic-gps-a2.jpg'].map(name => resolve('tests/fixtures/photos', name));
export const UNKNOWN_PHOTO = resolve('tests/fixtures/photos/synthetic-no-location.png');
export const TITLE = '京都 · 七月的三站';

export function observeNetwork(page: Page) {
  const writes: Array<{ method: string; url: string }> = [], errors: string[] = [], origins = new Map<string, number>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== new URL(APP_URL).origin) origins.set(url.origin, (origins.get(url.origin) ?? 0) + 1);
    if ((!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && url.origin !== new URL(APP_URL).origin) || /\/api\/ai\/(stylize|locate)/.test(url.pathname)) writes.push({ method: request.method(), url: url.origin + url.pathname });
  });
  return { writes, errors, origins };
}

export async function expectCounts(page: Page, visits: number, places: number, photos: number) {
  await expect(page.locator('.journey-stats strong')).toHaveText([String(visits), String(places), String(photos)], { timeout: 90_000 });
}

export async function importFromWelcome(page: Page, files = GPS_PHOTOS) {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { name: /去过的地方/ })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  // Exercise the visible entry point. Direct input assignment here would conceal an overlay bug.
  await page.getByRole('button', { name: '从照片开始', exact: true }).click();
  await (await chooser).setFiles(files);
  await expect(page.locator('.welcome-card')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('.global-task')).toHaveCount(0, { timeout: 90_000 });
}

export async function waitForArtwork(page: Page) {
  await expect(page.locator('main.workspace')).toHaveClass(/mode-artwork/);
  await expect(page.locator('.artwork-canvas')).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('.render-status')).toHaveCount(0, { timeout: 180_000 });
  await expect(page.locator('.render-error'), 'A real resource failure must fail acceptance, rather than produce a placeholder screenshot.').toHaveCount(0);
  await expect(page.locator('.conflict-panel'), 'The previous valid layout must not be mistaken for the newly requested layout.').toHaveCount(0);
  await expect(page.locator('.artwork-canvas canvas').first()).toBeVisible();
}

export async function createArtwork(page: Page) {
  await page.getByRole('button', { name: '创作这段旅程', exact: true }).click();
  await waitForArtwork(page);
}

export async function editorTab(page: Page, name: string) {
  if (!await page.locator('.editor-panel').isVisible()) await page.getByRole('button', { name: '显示或隐藏属性', exact: true }).click();
  await page.locator('.editor-tabs').getByRole('button', { name, exact: true }).click();
}

export async function chooseTemplate(page: Page, name: string) {
  await page.locator('.bottom-toolbar').getByRole('button', { name: '版式', exact: true }).click();
  const preset = page.locator('.template-library .preset-card').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
  await preset.click();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await waitForArtwork(page);
}

export async function chooseStyle(page: Page, name: string) {
  await page.locator('.bottom-toolbar').getByRole('button', { name: '风格', exact: true }).click();
  const preset = page.locator('.style-grid .preset-card').filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
  await preset.click();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await waitForArtwork(page);
}

export async function setSwitch(scope: Page | Locator, name: string, checked: boolean) {
  const control = scope.getByRole('switch', { name, exact: true });
  if (await control.isChecked() !== checked) await control.locator('..').click();
  await expect(control).toBeChecked({ checked });
}

export async function setTitleAndDate(page: Page, title = TITLE) {
  await editorTab(page, '文字');
  const titleInput = page.getByLabel('作品标题', { exact: true });
  await titleInput.fill(title);
  await titleInput.press('Enter');
  await page.getByLabel('旅行日期', { exact: true }).fill('2026-07-21');
  await expect(titleInput).toHaveValue(title);
  await expect(page.locator('.canvas-caption')).toContainText(title);
  await waitForArtwork(page);
}

export async function selectFirstPhoto(page: Page) {
  await editorTab(page, '元素');
  await page.locator('.element-panel summary').filter({ hasText: '逐个元素' }).click();
  await page.locator('.layer-row').getByRole('button', { name: '照片', exact: true }).first().click();
  await expect(page.locator('.object-inspector')).toBeVisible();
}

export interface DownloadedProject {
  path: string;
  bytes: Buffer;
  project: ProjectDocument;
  manifest: PackageManifest;
  entries: Record<string, Uint8Array>;
}

export async function downloadProject(page: Page, testInfo: TestInfo, name: string, lean = false): Promise<DownloadedProject> {
  await page.getByRole('button', { name: '项目与作品', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '旅行项目', exact: true });
  const pending = page.waitForEvent('download', { timeout: 90_000 });
  await dialog.getByRole('button', { name: lean ? '仅打包当前作品与关联资料' : '保存完整项目包', exact: true }).click();
  const download = await pending, path = testInfo.outputPath(`${name}.travelstudio`);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const bytes = await readFile(path), entries = unzipSync(bytes);
  const project = JSON.parse(strFromU8(entries['project.json'])) as ProjectDocument;
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as PackageManifest;
  expect(manifest.mode).toBe(lean ? 'artwork' : 'full');
  expect(new Set(Object.keys(entries))).toEqual(new Set(['manifest.json', ...manifest.entries.map(entry => entry.path)]));
  for (const entry of manifest.entries) {
    expect(entries[entry.path].byteLength, entry.path).toBe(entry.byteLength);
    expect(createHash('sha256').update(entries[entry.path]).digest('hex'), entry.path).toBe(entry.hash);
  }
  await testInfo.attach(name, { path, contentType: 'application/zip' });
  return { path, bytes, project, manifest, entries };
}

export async function openProject(page: Page, file: DownloadedProject) {
  await page.goto(APP_URL);
  await expect(page.getByRole('heading', { name: /去过的地方/ })).toBeVisible();
  await page.getByRole('button', { name: '项目与作品', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '旅行项目', exact: true });
  await dialog.locator('input[type=file][accept=".travelstudio"]').setInputFiles({ name: 'restored.travelstudio', mimeType: 'application/zip', buffer: file.bytes });
  await expect(dialog).toHaveCount(0, { timeout: 90_000 });
  await waitForArtwork(page);
}

export function frozenContent(art: ArtworkDocument) {
  return { journey: art.journey, photos: art.frozenPhotoBindings, camera: art.canonicalCamera, artboard: art.artboard, nodes: art.nodes, visibility: art.visibility, layout: art.layout, metadata: art.metadata, styleId: art.styleId, paletteId: art.paletteId, templateId: art.templateId };
}

export async function exportImage(page: Page, testInfo: TestInfo, format: 'png' | 'jpeg' | 'webp', longEdge: number, options: { savedMap?: boolean; name?: string; flatPrint?: { widthMm: number; heightMm: number; ppi: number; bleedMm: number } } = {}) {
  if (!await page.getByRole('dialog', { name: '把这段旅程带走', exact: true }).count()) await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '把这段旅程带走', exact: true });
  await dialog.getByRole('group', { name: '输出用途', exact: true }).getByRole('button', { name: options.flatPrint ? '平面印刷' : '展示分享', exact: true }).click();
  await dialog.getByLabel('图片格式', { exact: true }).selectOption(format);
  if (options.flatPrint) {
    await dialog.getByLabel('卡面宽度（毫米）', { exact: true }).fill(String(options.flatPrint.widthMm));
    await dialog.getByLabel('分辨率（PPI）', { exact: true }).fill(String(options.flatPrint.ppi));
    await dialog.getByLabel('四边出血（毫米）', { exact: true }).fill(String(options.flatPrint.bleedMm));
  } else await dialog.getByLabel('输出长边', { exact: true }).selectOption(String(longEdge));
  if (options.savedMap) await setSwitch(dialog, '明确使用已保存地图快照', true);
  const generate = dialog.getByRole('button', { name: '生成图片', exact: true });
  await generate.click();
  await expect(generate).toBeDisabled();
  await expect(generate).toBeEnabled({ timeout: 240_000 });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const preview = dialog.getByRole('img', { name: '刚刚生成的实际导出文件', exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const name = options.name ?? `${format}-${longEdge}`;
  const imagePending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载图片', exact: true }).click();
  const imageDownload = await imagePending, path = testInfo.outputPath(`${name}.${format === 'jpeg' ? 'jpg' : format}`);
  await imageDownload.saveAs(path);
  const receiptPending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '渲染回执', exact: true }).click();
  const receiptDownload = await receiptPending, receiptPath = testInfo.outputPath(`${name}-receipt.json`);
  await receiptDownload.saveAs(receiptPath);
  const bytes = await readFile(path), receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as ExportReceipt;
  expect(receipt.format).toBe(`image/${format}`);
  if (options.flatPrint) {
    const print = options.flatPrint;
    expect(receipt).toMatchObject({ intent: 'flat-print', ppi: print.ppi, bleedMm: print.bleedMm, width: Math.round((print.widthMm + 2 * print.bleedMm) / 25.4 * print.ppi), height: Math.round((print.heightMm + 2 * print.bleedMm) / 25.4 * print.ppi) });
  } else { expect(Math.max(receipt.width, receipt.height)).toBe(longEdge); expect(receipt.intent).toBe('presentation'); }
  expect(receipt.bytes).toBe(bytes.byteLength);
  expect(receipt.resourceBarrier).toEqual(expect.arrayContaining(['fonts', 'photos', 'composition', 'encoded-dimensions']));
  const decoded = await preview.evaluate(image => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }));
  expect(decoded).toEqual({ width: receipt.width, height: receipt.height });
  if (format === 'png') {
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(receipt.width);
    expect(bytes.readUInt32BE(20)).toBe(receipt.height);
    if (options.flatPrint) {
      let offset = 8; const densities: Array<{ x: number; y: number; unit: number }> = [];
      while (offset + 12 <= bytes.length) { const length = bytes.readUInt32BE(offset); if (bytes.toString('ascii', offset + 4, offset + 8) === 'pHYs') densities.push({ x: bytes.readUInt32BE(offset + 8), y: bytes.readUInt32BE(offset + 12), unit: bytes[offset + 16] }); offset += length + 12; }
      const density = Math.round(options.flatPrint.ppi / .0254);
      expect(densities).toEqual([{ x: density, y: density, unit: 1 }]);
      const alpha = await preview.evaluate(image => { const img = image as HTMLImageElement, canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0); const values = [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]].map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]); canvas.width = 0; canvas.height = 0; return values; });
      expect(alpha).toEqual([255, 255, 255, 255]);
    }
  } else if (format === 'jpeg') expect([...bytes.subarray(0, 2)]).toEqual([255, 216]);
  else { expect(bytes.toString('ascii', 0, 4)).toBe('RIFF'); expect(bytes.toString('ascii', 8, 12)).toBe('WEBP'); }
  let metadata: Record<string, unknown> | undefined;
  if (format === 'webp') {
    // exifr does not promise a WebP decoder. Check the actual RIFF metadata chunks instead of
    // turning an unsupported-parser error into a false claim that EXIF was removed.
    const chunks: string[] = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32LE(offset + 4);
      chunks.push(bytes.toString('ascii', offset, offset + 4));
      offset += 8 + length + (length % 2);
    }
    expect(offset).toBe(bytes.length);
    expect(chunks).not.toContain('EXIF');
    expect(chunks).not.toContain('XMP ');
  } else metadata = await exifr.parse(new Uint8Array(bytes));
  expect(metadata?.GPSLatitude).toBeUndefined();
  expect(metadata?.GPSLongitude).toBeUndefined();
  expect(metadata?.DateTimeOriginal).toBeUndefined();
  expect(metadata?.OffsetTimeOriginal).toBeUndefined();
  await testInfo.attach(name, { path, contentType: `image/${format}` });
  await testInfo.attach(`${name}-receipt`, { path: receiptPath, contentType: 'application/json' });
  return { path, bytes, receipt };
}

export async function closeExport(page: Page) {
  await page.getByRole('dialog', { name: '把这段旅程带走', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
}
