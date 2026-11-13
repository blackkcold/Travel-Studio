import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('local EXIF orientation/GPS, duplicate import, six recipes and actual encoded formats',async({page},testInfo)=>{
  const externalRequests:string[]=[];page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173')&&!request.url().startsWith('blob:'))externalRequests.push(request.url());});
  await page.goto('/tests/fixtures/photo.html');
  await page.getByLabel('导入测试照片').setInputFiles(['tests/fixtures/photos/synthetic-gps.jpg','tests/fixtures/photos/synthetic-orientation6.jpg','tests/fixtures/photos/synthetic-no-location.png','tests/fixtures/photos/synthetic-gps.jpg']);
  await expect(page.locator('#status')).toHaveText('导入与保存完成');
  const imported=JSON.parse(await page.locator('#result').innerText());
  expect(imported.photoCount).toBe(3);expect(imported.results).toHaveLength(4);
  for(const result of imported.results)expect(result.originalHashUnchanged).toBe(true);
  expect(imported.results[0].coordinate[0]).toBeCloseTo(135.7844,6);expect(imported.results[0].coordinate[1]).toBeCloseTo(34.9943,6);
  expect(imported.results[0].time.utc).toBe('2026-07-21T00:00:00.125Z');expect(imported.results[0].photo.exif.Orientation).toBe(1);
  expect(imported.results[1].photo).toMatchObject({width:600,height:800});expect(imported.results[1].time.precision).toBe('local');expect(imported.results[1].time.utc).toBeUndefined();
  expect(imported.results[2].coordinate).toBeUndefined();expect(imported.results[2].time.precision).toBe('unknown');expect(imported.results[3].duplicate).toBe(true);
  await page.getByRole('button',{name:'运行六种本地配方和三格式编码'}).click();
  await expect(page.locator('#status')).toHaveText('六种配方与三格式编码完成',{timeout:90_000});
  const recipes=JSON.parse(await page.locator('#encoding').innerText());expect(recipes).toHaveLength(6);
  expect(new Set(recipes.map((recipe:{outputs:Array<{hash:string}>})=>recipe.outputs[0].hash)).size).toBe(6);
  for(const recipe of recipes)for(const output of recipe.outputs){expect(output.width).toBe(800);expect(output.height).toBe(600);expect(output.hasGPS).toBe(false);expect(output.hasOriginalTime).toBe(false);expect(output.hasExifContainer).toBe(false);expect(['image/png','image/jpeg','image/webp']).toContain(output.mime);}
  expect(externalRequests).toEqual([]);
  await testInfo.attach('synthetic-exif-and-encoding-receipt',{body:JSON.stringify({imported,recipes},null,2),contentType:'application/json'});
  await page.screenshot({path:testInfo.outputPath('local-six-recipes.png'),fullPage:true});
});

const stressTest=process.env.TRAVEL_STRESS==='1'?test:test.skip;
stressTest('synthetic 48 MP import decodes serially and retains original (opt-in)',async({page},testInfo)=>{
  test.setTimeout(120_000);
  execFileSync('python3',['scripts/generate-fixtures.py','--stress'],{cwd:process.cwd()});
  await page.goto('/tests/fixtures/photo.html');
  await page.getByLabel('导入测试照片').setInputFiles(resolve('test-results/fixtures/synthetic-48mp.jpg'));
  await expect(page.locator('#status')).toHaveText('导入与保存完成',{timeout:90_000});
  const imported=JSON.parse(await page.locator('#result').innerText()),result=imported.results[0];
  expect(result.photo.width*result.photo.height).toBe(48_000_000);expect(result.originalHashUnchanged).toBe(true);
  expect(Math.max(...result.assets.filter((asset:{kind:string})=>asset.kind==='proxy').map((asset:{width:number;height:number})=>Math.max(asset.width,asset.height)))).toBe(1600);
  await testInfo.attach('synthetic-48mp-receipt',{body:JSON.stringify(imported,null,2),contentType:'application/json'});
});
