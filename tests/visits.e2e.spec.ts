import { test, expect } from '@playwright/test';
import { downloadProject, expectCounts, importFromWelcome, observeNetwork } from './helpers/app';

test('explicit visit merge, split and time correction preserve source evidence and undo through the UI', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const network = observeNetwork(page);
  await importFromWelcome(page); await expectCounts(page, 3, 2, 3);
  const rows = page.locator('.reorder-list > li');
  await expect(rows.locator('.visit-copy > .text-button')).toHaveText(['34.9943, 135.7844', '35.0030, 135.7730', '34.9943, 135.7844']);
  // Saving an existing location without editing its date/time retains EXIF precision and offset.
  await rows.first().getByRole('button', { name: '编辑到访 · 1 张', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑到访与时间', exact: true }).getByRole('button', { name: '确认地点与到访', exact: true }).click();
  await page.getByRole('button', { name: '上移第 2 站', exact: true }).click();
  await expect(rows.first()).toContainText('35.0030, 135.7730');

  await page.getByRole('button', { name: '管理到访记录', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '管理到访记录', exact: true });
  const anchor = dialog.getByLabel('保留的到访身份与顺序位置', { exact: true });
  await expect(anchor).toBeVisible();
  const targetId = await anchor.locator('option').filter({ hasText: /09:00/ }).getAttribute('value');
  await anchor.selectOption(targetId!);
  await expect(dialog.getByRole('button', { name: '应用合并', exact: true })).toBeDisabled();
  await dialog.locator('input[type=checkbox]:not(:disabled)').check();
  const timeSource = dialog.getByLabel('合并后使用哪次到访的时间', { exact: true });
  await timeSource.selectOption((await timeSource.locator('option').filter({ hasText: /18:00/ }).getAttribute('value'))!);
  await expect(dialog.locator('.visit-manager-preview')).toContainText('2 次到访合并为 1 次');
  await page.screenshot({ path: testInfo.outputPath('visit-merge-review.png'), fullPage: true });
  await dialog.getByRole('button', { name: '应用合并', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expectCounts(page, 2, 2, 3);
  await expect(rows.locator('.visit-copy > .text-button')).toHaveText(['35.0030, 135.7730', '34.9943, 135.7844']);
  await expect(rows.nth(1)).toContainText('18:00');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expectCounts(page, 3, 2, 3);
  await expect(rows.first()).toContainText('35.0030, 135.7730'); await expect(rows.nth(1)).toContainText('09:00');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expectCounts(page, 2, 2, 3);

  await page.getByRole('button', { name: '管理到访记录', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '管理到访记录', exact: true });
  await dialog.getByRole('group', { name: '到访管理操作', exact: true }).getByRole('button', { name: '拆分照片', exact: true }).click();
  await dialog.getByLabel('要调整的到访', { exact: true }).selectOption(targetId!);
  await dialog.getByRole('checkbox', { name: '拆出照片 synthetic-gps-a2.jpg', exact: true }).check();
  await expect(dialog.getByRole('switch', { name: '为新到访单独填写时间', exact: true })).not.toBeChecked();
  await expect(dialog.locator('.visit-manager-preview')).toContainText('1 张照片移到独立到访');
  await dialog.getByRole('button', { name: '应用拆分', exact: true }).click(); await expectCounts(page, 3, 2, 3);
  await expect(rows.locator('.visit-copy > .text-button')).toHaveText(['35.0030, 135.7730', '34.9943, 135.7844', '34.9943, 135.7844']);
  await expect(rows.nth(1)).toContainText('18:00'); await expect(rows.nth(2)).toContainText('18:00');

  await page.getByRole('button', { name: '管理到访记录', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '管理到访记录', exact: true });
  await dialog.getByRole('group', { name: '到访管理操作', exact: true }).getByRole('button', { name: '修正时间', exact: true }).click();
  const timeTarget = dialog.getByLabel('要调整的到访', { exact: true });
  await timeTarget.selectOption((await timeTarget.locator('option').filter({ hasText: /synthetic-gps-a2.jpg/ }).getAttribute('value'))!);
  await dialog.getByLabel('到访日期', { exact: true }).fill('2026-07-23');
  await dialog.getByLabel('到访时刻（可留空）', { exact: true }).fill('15:20:00');
  await dialog.getByRole('button', { name: '保存时间修正', exact: true }).click();
  await expect(rows.nth(2)).toContainText('15:20');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(rows.nth(2)).toContainText('18:00');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(rows.nth(2)).toContainText('15:20');
  const saved = await downloadProject(page, testInfo, 'visit-command-source-evidence');
  const originalPhoto = saved.project.library.photos.find(photo => photo.name === 'synthetic-gps-a2.jpg')!;
  expect(originalPhoto.time.value).toContain('18:00'); expect(originalPhoto.exif?.OffsetTimeOriginal).toBe('+09:00');
  const corrected = saved.project.library.visits.find(visit => visit.id === originalPhoto.visitId)!;
  expect(corrected.time).toMatchObject({ value: '2026-07-23T15:20:00', precision: 'local', source: 'user' });
  expect(corrected.history?.map(entry => entry.kind)).toEqual(['merge', 'split', 'time']);
  expect(corrected.history?.[0].sourceVisits.map(visit => visit.time.value)).toEqual(expect.arrayContaining(['2026-07-21T09:00:00.125', '2026-07-21T18:00:00.125']));
  expect(corrected.history?.[0].sourceVisits.every(visit => visit.time.source === 'exif' && visit.time.offset === '+09:00')).toBe(true);
  expect(network.writes).toEqual([]); expect(network.errors).toEqual([]);
});
