import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// Each real export runs sequentially below. The independent failure gate still
// runs if the public success service is temporarily unavailable (workers = 1).
test('live Photon → vector map → real terrain → fixed-camera 4096 PNG',async({page},testInfo)=>{
  test.setTimeout(360_000);
  const consoleErrors:string[]=[];page.on('pageerror',error=>consoleErrors.push(error.message));
  await page.goto('/tests/fixtures/map.html');
  await page.getByLabel('地点搜索').fill('日本京都清水寺');await page.getByRole('button',{name:'提交查询'}).click();
  await expect(page.locator('#search-status')).toContainText('找到',{timeout:45_000});
  // Photon honours Accept-Language; location identity must not depend on runner locale.
  await expect(page.locator('#candidates')).toContainText(/京都|Kyoto/i);
  await expect(page.locator('#candidates')).toContainText(/清水寺|Kiyomizu/i);
  await expect(page.locator('#candidates')).toContainText('W:336641107');
  const locationEvidence=await page.locator('#candidates').innerText();
  await testInfo.attach('real-search-candidates',{body:locationEvidence,contentType:'text/plain'});
  for(const mode of ['2d','3d']) {
    await page.locator(`#export-${mode}`).click();
    await expect(page.locator('#export-status')).toContainText(/导出完成|导出失败/,{timeout:180_000});
    if((await page.locator('#export-status').innerText()).includes('导出失败'))throw new Error(`${await page.locator('#export-status').innerText()} ${await page.locator('#receipt').innerText()}`);
    const receipt=JSON.parse(await page.locator('#receipt').innerText());
    expect(receipt.output.width).toBe(4096);expect(receipt.output.height).toBe(2867);
    expect(receipt.output.barriers.sourceErrors).toBe(0);expect(receipt.output.barriers.terrain).toBe(mode==='3d'?'ready':'not-requested');
    expect(receipt.projectionMaxDeviationLogicalPixels).toBeLessThanOrEqual(1);
    expect(receipt.distinctSampleColors).toBeGreaterThan(24);
    expect(receipt.annotationOrder.map((p:{visitId:string})=>p.visitId)).toEqual(['visit-a1','visit-b','visit-a2']);
    expect(receipt.output.camera.zoom).toBeCloseTo(receipt.preview.camera.zoom,6);
    expect(receipt.output.camera.pitch).toBeCloseTo(receipt.preview.camera.pitch,6);
    expect(receipt.output.camera.bearing).toBeCloseTo(receipt.preview.camera.bearing,6);
    const encoded=await page.locator('#output').getAttribute('src');expect(encoded).toMatch(/^data:image\/png;base64,/);
    const png=Buffer.from(encoded!.split(',')[1],'base64');
    expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(png.readUInt32BE(16)).toBe(4096);expect(png.readUInt32BE(20)).toBe(2867);
    const outputPath=testInfo.outputPath(`real-${mode}-4096.png`);await writeFile(outputPath,png);await testInfo.attach(`real-${mode}-4096`,{path:outputPath,contentType:'image/png'});
    await testInfo.attach(`${mode}-resource-receipt`,{body:JSON.stringify(receipt,null,2),contentType:'application/json'});
    await page.screenshot({path:testInfo.outputPath(`${mode}-browser.png`),fullPage:true});
  }
  expect(consoleErrors).toEqual([]);
});

test('missing map glyphs block export instead of producing a false success',async({page,context})=>{
  test.setTimeout(120_000);
  // Fault injection is separate from the unmocked, real-provider success gate above.
  let blockedGlyphRequests=0;
  await context.route('**/fonts/**',route=>{blockedGlyphRequests++;return route.abort('failed');});
  await page.goto('/tests/fixtures/map.html');await page.getByRole('button',{name:'提交查询'}).click();
  await expect(page.locator('#search-status')).toContainText('找到',{timeout:45_000});
  await page.locator('#export-2d').click();
  await expect(page.locator('#export-status')).toContainText('导出失败',{timeout:60_000});
  await expect(page.locator('#export-status')).not.toContainText('导出完成');
  await expect(page.locator('#download')).toBeHidden();
  expect(blockedGlyphRequests).toBeGreaterThan(0);
});
