import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { APP_URL, GPS_PHOTOS, UNKNOWN_PHOTO, TITLE, observeNetwork, importFromWelcome, expectCounts, createArtwork, chooseTemplate, chooseStyle, editorTab, setSwitch, setTitleAndDate, selectFirstPhoto, waitForArtwork, downloadProject, openProject, frozenContent, exportImage, closeExport } from './helpers/app';

test.describe.configure({ mode: 'serial' });

test('real UI: A–B–A → frozen artwork → actual exports → complete and lean recovery', async ({ page, browser }, testInfo) => {
  test.setTimeout(900_000);
  const network = observeNetwork(page);
  await importFromWelcome(page);
  await expectCounts(page, 3, 2, 3);
  const rows = page.locator('.reorder-list > li');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('.visit-copy > .text-button')).toHaveText(['34.9943, 135.7844', '35.0030, 135.7730', '34.9943, 135.7844']);
  await page.getByLabel('到访顺序', { exact: true }).selectOption('time');
  await page.getByLabel('时间依据', { exact: true }).selectOption('instant');
  await expect(rows.locator('.visit-copy small')).toContainText(['09:00', '11:00', '18:00']);
  await page.getByRole('button', { name: '上移第 2 站', exact: true }).click();
  await expect(page.getByLabel('到访顺序', { exact: true })).toHaveValue('manual');
  await expect(rows.first()).toContainText('35.0030, 135.7730');
  await page.getByLabel('到访顺序', { exact: true }).selectOption('time');
  await expect(rows.first()).toContainText('34.9943, 135.7844');
  // Filtering the visible candidates must not mutate the three selected photos.
  await page.getByRole('group', { name: '行程内容', exact: true }).getByRole('button', { name: '全部照片', exact: true }).click();
  await page.getByLabel('筛选照片名称', { exact: true }).fill('gps-b');
  await expect(page.locator('.list-actions')).toContainText('可见 1 · 全部已选 3');
  await expectCounts(page, 3, 2, 3);
  await page.getByRole('group', { name: '行程内容', exact: true }).getByRole('button', { name: '行程序列', exact: true }).click();
  await createArtwork(page);
  await chooseTemplate(page, '照片地图卡');
  await setTitleAndDate(page);

  await selectFirstPhoto(page);
  await setSwitch(page, '固定位置', true);
  await setSwitch(page, '固定尺寸', true);
  await page.locator('.photo-panel summary').filter({ hasText: '调整内部裁切' }).click();
  const focus = page.getByRole('slider', { name: '裁切水平焦点', exact: true });
  await focus.focus(); await focus.press('Home'); await focus.press('ArrowRight');
  const zoom = page.getByRole('slider', { name: '照片缩放', exact: true });
  await zoom.focus(); await zoom.press('Home'); await zoom.press('ArrowRight'); await zoom.press('ArrowRight');
  await expect(focus).toHaveValue('0.02');
  await expect(zoom).toHaveValue('1.1');
  await expect(page.getByRole('switch', { name: '固定裁切', exact: true })).toBeChecked();
  const photoX = await page.getByLabel('元素x', { exact: true }).inputValue();
  await chooseStyle(page, '复古羊皮纸');
  await selectFirstPhoto(page);
  await expect(page.getByLabel('元素x', { exact: true })).toHaveValue(photoX);
  await expect(page.getByRole('switch', { name: '固定位置', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: '固定尺寸', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: '固定裁切', exact: true })).toBeChecked();

  await editorTab(page, '元素');
  await setSwitch(page, '旅行日期', false);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('switch', { name: '旅行日期', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('switch', { name: '旅行日期', exact: true })).not.toBeChecked();
  await waitForArtwork(page);
  const before = await downloadProject(page, testInfo, 'before-source-changes');
  const originalArt = before.project.artworks[0], cropped = originalArt.nodes.find(node => node.kind === 'photo');
  expect(cropped?.crop).toMatchObject({ x: .02, zoom: 1.1 });
  expect(cropped?.constraint).toEqual({ position: 'pinned', size: 'fixed', crop: 'fixed' });
  expect(originalArt.metadata.date).toBe('2026-07-21');
  expect(originalArt.visibility.date).toBe(false);
  expect(originalArt.journey.route.segments).toHaveLength(2);
  expect(originalArt.journey.resolvedVisits[0].placeId).toBe(originalArt.journey.resolvedVisits[2].placeId);
  for (let i = 0; i < GPS_PHOTOS.length; i++) {
    const input = await readFile(GPS_PHOTOS[i]);
    const record = before.project.library.photos.find(photo => photo.name === GPS_PHOTOS[i].split('/').pop())!;
    expect(Buffer.from(before.entries[`assets/${record.assetId}`])).toEqual(input);
    expect(createHash('sha256').update(input).digest('hex')).toBe(record.assetId);
  }

  await page.getByRole('group', { name: '工作状态', exact: true }).getByRole('button', { name: '旅行地图', exact: true }).click();
  await page.getByTestId('photo-input').setInputFiles(UNKNOWN_PHOTO);
  await expectCounts(page, 4, 2, 4);
  await page.getByRole('button', { name: '添加一站', exact: true }).click();
  let place = page.getByRole('dialog', { name: '添加一站', exact: true });
  await place.getByLabel('地点名称', { exact: true }).fill('北京 · 独立资料');
  await place.getByLabel('经度（WGS84）', { exact: true }).fill('116.4074');
  await place.getByLabel('纬度（WGS84）', { exact: true }).fill('39.9042');
  await place.getByLabel('到访日期（可选）', { exact: true }).fill('2026-07-22');
  await place.getByRole('button', { name: '确认地点与到访', exact: true }).click();
  await expectCounts(page, 5, 3, 4);
  await expect(page.locator('.pending-visits')).toContainText('待排序');
  await rows.first().getByRole('button', { name: '编辑到访 · 1 张', exact: true }).click();
  place = page.getByRole('dialog', { name: '编辑到访与时间', exact: true });
  await place.getByLabel('地点名称', { exact: true }).fill('资料库中已更新的 A 站');
  await place.getByLabel('到访日期（可选）', { exact: true }).fill('2026-07-24');
  await place.getByLabel('当地时间（可选）', { exact: true }).fill('09:30');
  await place.getByRole('button', { name: '确认地点与到访', exact: true }).click();
  await page.getByRole('group', { name: '工作状态', exact: true }).getByRole('button', { name: '作品创作', exact: true }).click();
  await waitForArtwork(page);
  await expect(page.locator('.frozen-journey > li')).toHaveCount(3);
  await expect(page.locator('.frozen-journey')).not.toContainText('资料库中已更新');
  await expect(page.locator('.frozen-journey')).not.toContainText('2026-07-24');

  const outputs = [];
  for (const [format, edge] of [['png', 2048], ['png', 4096], ['jpeg', 1920], ['webp', 1920]] as const) {
    const output = await exportImage(page, testInfo, format, edge);
    expect(output.receipt.mapMode).toBe('live');
    expect(output.receipt.map?.barriers).toMatchObject({ tiles: true, glyphs: true, sourceErrors: 0 });
    expect(output.receipt.map?.camera).toEqual(originalArt.canonicalCamera);
    expect(output.receipt.map!.width).toBeGreaterThanOrEqual(Math.round(output.receipt.map!.logicalWidth * output.receipt.map!.pixelRatio));
    expect(output.receipt.map!.height).toBeGreaterThanOrEqual(Math.round(output.receipt.map!.logicalHeight * output.receipt.map!.pixelRatio));
    outputs.push(output.receipt);
  }
  await closeExport(page);
  await page.getByRole('button', { name: '复制当前作品', exact: true }).click();
  await waitForArtwork(page);
  const full = await downloadProject(page, testInfo, 'full-project');
  const lean = await downloadProject(page, testInfo, 'current-artwork-only', true);
  expect(full.project.artworks).toHaveLength(2);
  expect(full.project.library.photos).toHaveLength(4);
  expect(full.project.library.places).toHaveLength(3);
  expect(full.project.library.visits).toHaveLength(5);
  expect(lean.project.artworks).toHaveLength(1);
  expect(lean.project.library.photos).toHaveLength(3);
  expect(lean.project.library.places).toHaveLength(2);
  expect(lean.project.library.visits).toHaveLength(3);
  expect(lean.project.library.photos.some(photo => photo.name === 'synthetic-no-location.png')).toBe(false);
  expect(frozenContent(full.project.artworks[0])).toEqual(frozenContent(originalArt));
  expect(frozenContent(lean.project.artworks[0])).toEqual(frozenContent(originalArt));
  expect(lean.project.library.places.some(record => record.name === '资料库中已更新的 A 站')).toBe(false);
  const unrelated = full.project.library.photos.find(photo => photo.name === 'synthetic-no-location.png')!;
  expect(lean.entries[`assets/${unrelated.assetId}`]).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('desktop-1440x900.png'), fullPage: true });

  // An earlier portable backup must open on the same device without overwriting newer local work.
  await page.getByRole('button', { name: '项目与作品', exact: true }).click();
  const recoveryDialog = page.getByRole('dialog', { name: '旅行项目', exact: true });
  await recoveryDialog.locator('input[type=file][accept=".travelstudio"]').setInputFiles({ name: 'older-backup.travelstudio', mimeType: 'application/zip', buffer: before.bytes });
  await expect(recoveryDialog).toHaveCount(0, { timeout: 90_000 });
  await waitForArtwork(page);
  const recoveryCopy = await downloadProject(page, testInfo, 'older-backup-recovery-copy');
  expect(recoveryCopy.project.id).not.toBe(full.project.id);
  expect(recoveryCopy.project.name).toContain('恢复副本');
  expect(frozenContent(recoveryCopy.project.artworks[0])).toEqual(frozenContent(originalArt));
  await page.getByRole('button', { name: '项目与作品', exact: true }).click();
  await expect(page.locator('.project-list > button')).toHaveCount(2);
  await page.getByRole('dialog', { name: '旅行项目', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();

  for (const [name, archive] of [['full', full], ['lean', lean]] as const) {
    // A new context has an empty IndexedDB and no session from the original authoring browser.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: APP_URL });
    const restored = await context.newPage(), restoredNetwork = observeNetwork(restored);
    try {
      await openProject(restored, archive);
      await expect(restored.locator('.canvas-caption')).toContainText(TITLE);
      await expect(restored.locator('.frozen-journey > li')).toHaveCount(3);
      await editorTab(restored, '元素');
      await expect(restored.getByRole('switch', { name: '旅行日期', exact: true })).not.toBeChecked();
      await selectFirstPhoto(restored);
      await expect(restored.getByRole('switch', { name: '固定位置', exact: true })).toBeChecked();
      await expect(restored.getByRole('switch', { name: '固定裁切', exact: true })).toBeChecked();
      await restored.locator('.photo-panel summary').filter({ hasText: '调整内部裁切' }).click();
      await expect(restored.getByRole('slider', { name: '裁切水平焦点', exact: true })).toHaveValue('0.02');
      const recovered = await downloadProject(restored, testInfo, `${name}-roundtrip`);
      expect(frozenContent(recovered.project.artworks[0])).toEqual(frozenContent(archive.project.artworks[0]));
      await restored.screenshot({ path: testInfo.outputPath(`${name}-restored.png`), fullPage: true });
      if (name === 'full') {
        const savedArt = archive.project.artworks[0];
        expect(savedArt.mapSnapshotAssetId).toBeTruthy();
        expect(savedArt.mapSnapshot?.width).toBeGreaterThan(1500);
        // Explicit fault injection: the app remains loaded, while external map/DEM fetches are unavailable.
        await restored.route('https://**/*', route => route.abort('internetdisconnected'));
        const offline = await exportImage(restored, testInfo, 'png', 1920, { savedMap: true, name: 'offline-saved-snapshot-1920' });
        expect(offline.receipt.mapMode).toBe('saved-snapshot');
        expect(offline.receipt.resourceBarrier).toEqual(expect.arrayContaining(['snapshot-metadata', 'snapshot-pixels', 'snapshot-attribution']));
        expect(offline.receipt.map?.attribution).toEqual(savedArt.mapSnapshot?.attribution);
        await closeExport(restored);
      }
      expect(restoredNetwork.writes).toEqual([]);
      expect(restoredNetwork.errors).toEqual([]);
    } finally { await context.close(); }
  }
  expect(network.writes).toEqual([]);
  expect(network.errors).toEqual([]);
  await testInfo.attach('ui-flow-receipt', { body: JSON.stringify({ syntheticFixtures: true, actualUI: true, exports: outputs, full: { photos: full.project.library.photos.length, places: full.project.library.places.length, visits: full.project.library.visits.length, artworks: full.project.artworks.length }, lean: { photos: lean.project.library.photos.length, places: lean.project.library.places.length, visits: lean.project.library.visits.length, artworks: lean.project.artworks.length }, externalReadOrigins: Object.fromEntries(network.origins), externalWrites: network.writes }, null, 2), contentType: 'application/json' });
});

test('390 × 844 touch UI: reachable import, unknown facts, editing, undo, preferences and photo-only export', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, baseURL: APP_URL });
  const page = await context.newPage(), network = observeNetwork(page);
  try {
    await page.goto(APP_URL);
    await expect(page.getByRole('button', { name: '从照片开始', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mobile-welcome-390x844.png'), fullPage: true });
    // The same visible entry is used on touch; it must receive the pointer through every overlay.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '从照片开始', exact: true }).tap();
    await (await chooser).setFiles(UNKNOWN_PHOTO);
    await expectCounts(page, 1, 0, 1);
    await expect(page.locator('.visit-copy')).toContainText('时间待确认');
    await page.screenshot({ path: testInfo.outputPath('mobile-atlas-390x844.png'), fullPage: true });
    await createArtwork(page);
    await setTitleAndDate(page, '留白的旅程');
    await editorTab(page, '元素');
    await expect(page.getByRole('switch', { name: '真实地图', exact: true })).not.toBeChecked();
    await setSwitch(page, '旅行日期', false);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByRole('switch', { name: '旅行日期', exact: true })).toBeChecked();
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '偏好与扩展', exact: true });
    await settings.getByLabel('界面材质', { exact: true }).selectOption('opaque');
    await settings.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('main.workspace')).toHaveClass(/effects-opaque/);
    if (await page.locator('.editor-panel').isVisible()) await page.getByRole('button', { name: '显示或隐藏属性', exact: true }).click();
    if (await page.locator('.journey-panel').isVisible()) await page.getByRole('button', { name: '显示或隐藏行程', exact: true }).click();
    await waitForArtwork(page);
    const viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight }));
    expect(viewport).toEqual({ width: 390, scrollWidth: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('mobile-artwork-390x844.png'), fullPage: true });
    const output = await exportImage(page, testInfo, 'png', 1920, { name: 'mobile-photo-only-1920' });
    expect(output.receipt.mapMode).toBe('not-used');
    await closeExport(page);
    const archive = await downloadProject(page, testInfo, 'mobile-photo-only-project');
    expect(archive.project.library.photos[0].time.precision).toBe('unknown');
    expect(archive.project.library.photos[0].placeId).toBeUndefined();
    expect(archive.project.library.visits[0].time.value).toBeUndefined();
    expect(network.writes).toEqual([]);
    expect(network.errors).toEqual([]);
  } finally { await context.close(); }
});
