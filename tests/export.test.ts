import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtwork, createEmptyProject } from '../src/domain';
import { applyLayoutProposal, solveLayout, isNodeVisible } from '../src/composition';
import { exportArtwork, exportDimensions, mapSnapshotInputHash, prepareResources, snapshotMapFrame, withDensity, type ExportSpec, type RenderServices } from '../src/export';
import type { MapFrame, MapRenderReceipt } from '../src/map';

const spec: ExportSpec = { format: 'png', longEdge: 4096, quality: .94, transparent: false, intent: 'presentation', ppi: 300, widthMm: 150, heightMm: 100, bleedMm: 3, background: '#ffffff' };
const makeArt = () => { const value = createArtwork(); return applyLayoutProposal(value, solveLayout(value)); };
function frame(art = makeArt()): MapFrame {
  const map = art.nodes.find(node => node.kind === 'map')!;
  const receipt: MapRenderReceipt = { renderer: 'test-fixture', provider: 'fixture-source', providerVersion: '1', terrainProvider: 'fixture-terrain', terrainExaggeration: 1, camera: structuredClone(art.canonicalCamera), logicalWidth: Math.round(map.transform.width), logicalHeight: Math.round(map.transform.height), width: Math.round(map.transform.width), height: Math.round(map.transform.height), pixelRatio: 1, barriers: { tiles: true, glyphs: true, terrain: 'ready', sourceErrors: 0 }, completedResources: { basemapTiles: 1, terrainTiles: 1, glyphRanges: 1, sourceDocuments: 1 }, attribution: ['Fixture map source', 'Fixture terrain source'], printAttribution: ['Fixture map source · example.invalid/map', 'Fixture terrain source · example.invalid/dem'], snapshotBundleAllowed: true, buildingHeights: 'source-height-or-estimate', annotationStrategy: 'screen-overlay-no-depth-test', durationMs: 1, completedAt: '2026-11-13T00:00:00Z' };
  return { canvas: { width: receipt.width, height: receipt.height } as HTMLCanvasElement, annotations: [{ visitId: 'v1', number: 1, name: '京都', precision: 'exact', x: 100, y: 100, visible: true, coordinate: [135, 35], photoIds: [] }], receipt, dispose: vi.fn() };
}
function fontDocument() { return { fonts: { ready: Promise.resolve(), load: vi.fn(async () => []), check: vi.fn(() => true) } }; }
afterEach(() => { vi.unstubAllGlobals(); });

describe('physical output dimensions', () => {
  it('returns exact 4096 presentation pixels and exact A6/300PPI trim plus bleed', () => {
    const artwork = makeArt(); expect(Math.max(exportDimensions(artwork, spec).width, exportDimensions(artwork, spec).height)).toBe(4096);
    artwork.artboard.width = 105; artwork.artboard.height = 148;
    const dimensions = exportDimensions(artwork, { ...spec, intent: 'flat-print', widthMm: 105, heightMm: 148 });
    expect(dimensions).toMatchObject({ width: 1311, height: 1819, trimWidth: 1240, trimHeight: 1748 });
    expect(dimensions.bleedX + dimensions.trimWidth + dimensions.bleedRight).toBe(dimensions.width); expect(dimensions.bleedY + dimensions.trimHeight + dimensions.bleedBottom).toBe(dimensions.height);
  });
  it('rejects NaN, infinity, unsupported sizes and print aspect changes', () => {
    const art = makeArt(); for (const field of ['widthMm', 'heightMm', 'ppi', 'bleedMm']) expect(() => exportDimensions(art, { ...spec, intent: 'flat-print', [field]: NaN })).toThrow();
    expect(() => exportDimensions(art, { ...spec, quality: Infinity })).toThrow(); expect(() => exportDimensions(art, { ...spec, longEdge: 8192 })).toThrow(); expect(() => exportDimensions(art, { ...spec, longEdge: 2048.5 })).toThrow();
    expect(() => exportDimensions(art, { ...spec, intent: 'flat-print', widthMm: 100, heightMm: 200 })).toThrow('比例');
  });
  it('writes real PNG physical-density metadata without changing image pixels', async () => {
    const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1sAAAAASUVORK5CYII=', 'base64'));
    const output = new Uint8Array(await (await withDensity(new Blob([bytes], { type: 'image/png' }), 300)).arrayBuffer());
    let offset = 8, density: DataView | undefined, count = 0;
    while (offset + 12 <= output.length) { const length = new DataView(output.buffer, offset).getUint32(0), type = String.fromCharCode(...output.slice(offset + 4, offset + 8)); if (type === 'pHYs') { count++; density = new DataView(output.buffer, offset + 8, length); } offset += length + 12; }
    expect(count).toBe(1); expect(density?.getUint32(0)).toBe(11811); expect(density?.getUint32(4)).toBe(11811); expect(density?.getUint8(8)).toBe(1);
    expect(new DataView(output.buffer).getUint32(16)).toBe(1); expect(new DataView(output.buffer).getUint32(20)).toBe(1);
  });
});

describe('frozen map snapshots and resource barriers', () => {
  it('keeps local processing on an unpaired torn-art photo', async () => {
    const art = makeArt(); art.templateId = 'torn-art';
    const base = art.nodes.find(node => node.kind === 'map')!;
    art.nodes = [{ ...base, id: 'photo-one', kind: 'photo', role: 'photo', parentId: undefined, assetId: 'original', photoId: 'p1', photoEdit: { mode: 'local', intensity: .7, exposure: 0, contrast: 1, saturation: 1, crop: { x: .5, y: .5, zoom: 1, rotation: 0 } } }];
    vi.stubGlobal('document', fontDocument());
    const processPhoto = vi.fn(async (..._args: Parameters<RenderServices['processPhoto']>) => ({ width: 100, height: 100 } as HTMLCanvasElement));
    const resources = await prepareResources(art, { getAsset: vi.fn(async () => new Blob(['original'])), renderMap: vi.fn(), processPhoto });
    expect(processPhoto.mock.calls[0][1]).toMatchObject({ mode: 'local', intensity: .7 }); resources.dispose();
  });
  it('binds a torn-art comparison original to the original bytes, beside its AI version', async () => {
    const art = makeArt(); art.templateId = 'torn-art';
    const base = art.nodes.find(node => node.kind === 'map')!;
    const photo = { ...base, id: 'photo-one', kind: 'photo' as const, role: 'photo', parentId: undefined, assetId: 'original', photoId: 'p1', photoEdit: { mode: 'ai' as const, derivedAssetId: 'derived', intensity: 1, exposure: 0, contrast: 1, saturation: 1, crop: { x: .5, y: .5, zoom: 1, rotation: 0 } } };
    art.nodes = [photo, { ...photo, id: 'photo-art-one', role: 'photo-art' }];
    vi.stubGlobal('document', fontDocument());
    const getAsset = vi.fn(async (_id: string) => new Blob(['fixture']));
    const processPhoto = vi.fn(async (..._args: Parameters<RenderServices['processPhoto']>) => ({ width: 100, height: 100 } as HTMLCanvasElement));
    const resources = await prepareResources(art, { getAsset, renderMap: vi.fn(), processPhoto });
    expect(getAsset.mock.calls.map(call => call[0])).toEqual(['original', 'derived']);
    expect(processPhoto.mock.calls[0][1]).toMatchObject({ mode: 'original' });
    expect(processPhoto.mock.calls[1][1]).toMatchObject({ mode: 'ai' }); resources.dispose();
  });
  it('includes camera, source, style and route visibility in a snapshot fingerprint', () => { const art = makeArt(), hash = mapSnapshotInputHash(art); art.canonicalCamera.zoom++; expect(mapSnapshotInputHash(art)).not.toBe(hash); art.canonicalCamera.zoom--; art.mapSource = { id: 'other' }; expect(mapSnapshotInputHash(art)).not.toBe(hash); delete art.mapSource; art.nodes.find(n => n.kind === 'route')!.visible = false; expect(mapSnapshotInputHash(art)).not.toBe(hash); art.nodes.find(n => n.kind === 'route')!.visible = true; art.embeddedStyle={version:'1.0.0',recipe:{land:'#000000'}}; expect(mapSnapshotInputHash(art)).not.toBe(hash); });
  it('does not store snapshots whose actual provider policy forbids bundling', () => { const art = makeArt(), rendered = frame(art); rendered.receipt.snapshotBundleAllowed = false; expect(() => snapshotMapFrame(art, rendered)).toThrow('不允许'); });
  it('restores frozen annotations and terrain attribution, without requesting any map network', async () => {
    const art = makeArt(), rendered = frame(art); art.mapSnapshot = snapshotMapFrame(art, rendered); art.mapSnapshotAssetId = 'snapshot'; const close = vi.fn();
    vi.stubGlobal('document', fontDocument()); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: rendered.canvas.width, height: rendered.canvas.height, close })));
    const services: RenderServices = { getAsset: vi.fn(async () => new Blob(['fixture'])), renderMap: vi.fn(), processPhoto: vi.fn() };
    const prepared = await prepareResources(art, services, 1, undefined, undefined, true);
    expect(prepared.mapMode).toBe('saved-snapshot'); expect(prepared.resources.annotations?.[0].name).toBe('京都'); expect(prepared.resources.attributions).toEqual(rendered.receipt.attribution); expect(prepared.printAttribution).toEqual(rendered.receipt.printAttribution); expect(services.renderMap).not.toHaveBeenCalled(); prepared.dispose(); prepared.dispose(); expect(close).toHaveBeenCalledOnce();
  });
  it('rejects changed or undersampled saved snapshots instead of silently enlarging', async () => {
    const art = makeArt(), rendered = frame(art); art.mapSnapshot = snapshotMapFrame(art, rendered); art.mapSnapshotAssetId = 'snapshot'; const close = vi.fn();
    vi.stubGlobal('document', fontDocument()); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: rendered.canvas.width, height: rendered.canvas.height, close })));
    const services: RenderServices = { getAsset: vi.fn(async () => new Blob(['fixture'])), renderMap: vi.fn(), processPhoto: vi.fn() };
    await expect(prepareResources(art, services, 4, undefined, undefined, true)).rejects.toThrow('像素不足'); expect(close).toHaveBeenCalledOnce();
    art.styleId = 'modern'; await expect(prepareResources(art, services, 1, undefined, undefined, true)).rejects.toThrow('已变化');
  });
  it('respects per-node route visibility and forwards the frozen source adapter', async () => {
    const art = makeArt(); art.nodes.find(node => node.kind === 'route')!.visible = false; art.mapSource = { id: 'frozen-provider' };
    vi.stubGlobal('document', fontDocument()); const rendered = frame(art), renderMap = vi.fn(async (_spec: Parameters<RenderServices['renderMap']>[0]) => rendered);
    const resources = await prepareResources(art, { getAsset: vi.fn(), processPhoto: vi.fn(), renderMap });
    expect(renderMap.mock.calls[0][0]).toMatchObject({ showRoute: false, source: art.mapSource }); resources.dispose(); expect(rendered.dispose).toHaveBeenCalledOnce();
  });
  it('disposes allocated export canvas even when the font barrier fails', async () => {
    const canvas = { width: 0, height: 0, getContext: () => ({}) }; const fontError = Promise.reject(new Error('font unavailable')); void fontError.catch(() => undefined);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas), fonts: { ready: fontError } });
    const project = createEmptyProject(), artwork = makeArt(); project.artworks.push(artwork);
    await expect(exportArtwork(project, artwork.id, spec, { getAsset: vi.fn(), renderMap: vi.fn(), processPhoto: vi.fn() })).rejects.toThrow('font unavailable'); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
  it('inherits group visibility and safely rejects a malformed parent cycle', () => { const art = makeArt(), map = art.nodes.find(n => n.kind === 'map')!, group = art.nodes.find(n => n.id === map.parentId)!; group.visible = false; expect(isNodeVisible(map, art)).toBe(false); group.visible = true; group.parentId = map.id; expect(isNodeVisible(map, art)).toBe(false); });
});
