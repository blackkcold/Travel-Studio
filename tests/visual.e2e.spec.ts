import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { importFromWelcome, expectCounts, createArtwork, setTitleAndDate, chooseTemplate, chooseStyle, editorTab, setSwitch, waitForArtwork, observeNetwork } from './helpers/app';

const styles = [
  { id: 'ink', name: '东方水墨' }, { id: 'sketch', name: '精致手绘' },
  { id: 'parchment', name: '复古羊皮纸' }, { id: 'oil', name: '古典油画' },
  { id: 'poster', name: '复古海报' }, { id: 'modern', name: '极简现代' },
];
const families = [
  { family: 'T01', id: 'card-split', name: '照片地图卡', alternate: '地图与影像' },
  { family: 'T02', id: 'torn-art', name: '撕纸双联', alternate: '地图双联' },
  { family: 'T03', id: 'ticket-photo', name: '城市旅签', alternate: '地图旅签' },
  { family: 'T04', id: 'poster-full', name: '路线海报', alternate: '风景路线' },
  { family: 'T05', id: 'film-vertical', name: '时间胶片', alternate: '旅程长卷' },
  { family: 'T06', id: 'collage-scatter', name: '旅行拼贴', alternate: '记忆方格' },
];

test('36 real compositions: six style families × six template families, plus all twelve structures', async ({ page }, testInfo) => {
  test.setTimeout(1_200_000);
  const network = observeNetwork(page), receipts: Array<Record<string, unknown>> = [];
  await importFromWelcome(page);
  await expectCounts(page, 3, 2, 3);
  await createArtwork(page);
  await setTitleAndDate(page, '京都 · 七月');
  for (const family of families) {
    await chooseTemplate(page, family.name);
    for (const style of styles) {
      await chooseStyle(page, style.name);
      await expect(page.locator('.frozen-journey > li')).toHaveCount(3);
      const filename = `${family.family}-${family.id}-${style.id}.png`;
      const pixels = await page.locator('.artwork-canvas').screenshot({ path: testInfo.outputPath(filename), animations: 'disabled' });
      receipts.push({ family: family.family, template: family.id, style: style.id, filename, actualApplicationCanvas: true, mockMap: false, sha256: createHash('sha256').update(pixels).digest('hex'), capturedAt: new Date().toISOString() });
    }
    // Each family must also render a meaningful no-map layout, with its facts retained on restore.
    await editorTab(page, '元素');
    await setSwitch(page, '真实地图', false);
    await waitForArtwork(page);
    await expect(page.locator('.frozen-journey > li')).toHaveCount(3);
    await page.locator('.artwork-canvas').screenshot({ path: testInfo.outputPath(`${family.family}-map-hidden.png`), animations: 'disabled' });
    await setSwitch(page, '真实地图', true);
    await waitForArtwork(page);
    await chooseTemplate(page, family.alternate);
    await page.locator('.artwork-canvas').screenshot({ path: testInfo.outputPath(`${family.family}-alternate-structure.png`), animations: 'disabled' });
  }
  expect(receipts).toHaveLength(36);
  expect(new Set(receipts.map(receipt => receipt.sha256)).size).toBe(36);
  expect(network.writes).toEqual([]);
  expect(network.errors).toEqual([]);
  const manifest = { description: 'Actual Chromium application canvas screenshots after fonts, local photos and real online map resources completed. Synthetic test photos and EXIF are not observed travel evidence. This matrix is visual regression evidence, not 36 separate 4K export claims.', compositions: receipts, alternateStructures: families.map(family => ({ family: family.family, name: family.alternate, filename: `${family.family}-alternate-structure.png` })), externalReadOrigins: Object.fromEntries(network.origins) };
  const path = testInfo.outputPath('visual-matrix-receipt.json');
  await writeFile(path, JSON.stringify(manifest, null, 2));
  await testInfo.attach('visual-matrix-receipt', { path, contentType: 'application/json' });
});
