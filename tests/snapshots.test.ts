import { afterEach, describe, expect, it, vi } from 'vitest';
import { clone, createArtwork, createEmptyProject, DocumentStore, type ArtworkDocument } from '../src/domain';
import { applyLayoutProposal, solveLayout } from '../src/composition';
import { mapSnapshotInputHash, prepareResources, snapshotMapFrame } from '../src/export';
import { createMemoryStore } from '../src/storage';
import { createSnapshotPersistence, rebindCopiedMapSnapshot } from '../src/app/snapshots';
import type { MapFrame, MapRenderReceipt } from '../src/map';

function artwork() { const art = createArtwork(); return applyLayoutProposal(art, solveLayout(art)); }
function frame(art: ArtworkDocument, highResolution = true): MapFrame {
  const map = art.nodes.find(node => node.kind === 'map')!, logicalWidth = Math.round(map.transform.width), logicalHeight = Math.round(map.transform.height);
  const pixelRatio = highResolution ? 4096 / Math.max(logicalWidth, logicalHeight) : 1;
  const width = Math.round(logicalWidth * pixelRatio), height = Math.round(logicalHeight * pixelRatio);
  const receipt: MapRenderReceipt = {
    renderer: 'snapshot-contract-fixture', provider: 'fixture-source', providerVersion: '1', camera: clone(art.canonicalCamera), terrainExaggeration: 1,
    logicalWidth, logicalHeight, width, height, pixelRatio,
    barriers: { tiles: true, glyphs: true, terrain: 'not-requested', sourceErrors: 0 },
    completedResources: { basemapTiles: 1, terrainTiles: 0, glyphRanges: 1, sourceDocuments: 1 },
    attribution: ['Fixture map source'], printAttribution: ['Fixture map source · https://example.invalid/map'], snapshotBundleAllowed: true,
    buildingHeights: 'source-height-or-estimate', annotationStrategy: 'screen-overlay-no-depth-test', durationMs: 1, completedAt: '2026-11-13T00:00:00Z',
  };
  return { canvas: { width, height, toBlob: () => { throw new Error('A low-resolution preview must not replace the verified 4K snapshot.'); } } as unknown as HTMLCanvasElement, annotations: [{ visitId: 'visit-fixture', number: 1, name: '京都', x: 100, y: 100, visible: true, coordinate: [135, 35], photoIds: [], precision: 'exact' }], receipt, dispose: vi.fn() };
}
afterEach(() => vi.unstubAllGlobals());

describe('copying verified map snapshots', () => {
  it('keeps the same 4K asset, annotations and attribution through copying, a later preview and offline use', async () => {
    const source = artwork(), high = frame(source), storage = createMemoryStore();
    const asset = await storage.assets.putAsset(new Blob(['map-fixture'], { type: 'image/png' }), { kind: 'map-snapshot', width: high.canvas.width, height: high.canvas.height });
    source.mapSnapshotAssetId = asset.id; source.mapSnapshot = snapshotMapFrame(source, high);
    const project = createEmptyProject(); project.artworks.push(source); project.assets.push(asset);
    const doc = new DocumentStore(project), persistence = createSnapshotPersistence(doc, storage.assets);
    const copy = { ...clone(source), id: 'artwork-copy', name: source.name + ' · 副本' }, before = clone(copy);
    const rebound = persistence.rebindCopiedMapSnapshot(source, copy);
    expect(copy).toEqual(before); expect(source.mapSnapshot.inputHash).toBe(mapSnapshotInputHash(source));
    expect(rebound.mapSnapshot).toEqual({ ...source.mapSnapshot, inputHash: mapSnapshotInputHash(rebound) });
    expect(rebound.mapSnapshot).not.toBe(source.mapSnapshot); expect(rebound.mapSnapshotAssetId).toBe(asset.id);
    expect(Math.max(rebound.mapSnapshot!.width, rebound.mapSnapshot!.height)).toBe(4096);
    doc.transact('复制作品', draft => draft.artworks.push(rebound));
    const revision = doc.document.revision, put = vi.spyOn(storage.assets, 'putAsset');
    await persistence.onMapFrame(rebound, frame(rebound, false));
    expect(put).not.toHaveBeenCalled(); expect(doc.document.revision).toBe(revision);
    expect(doc.document.artworks[1].mapSnapshot).toEqual(rebound.mapSnapshot);
    const close = vi.fn(), renderMap = vi.fn(), processPhoto = vi.fn();
    vi.stubGlobal('document', {});
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: high.canvas.width, height: high.canvas.height, close })));
    const prepared = await prepareResources(rebound, { getAsset: storage.assets.getAsset, renderMap, processPhoto }, high.receipt.pixelRatio, undefined, undefined, true);
    expect(prepared.mapMode).toBe('saved-snapshot'); expect(renderMap).not.toHaveBeenCalled();
    expect(prepared.resources.annotations).toEqual(high.annotations); expect(prepared.printAttribution).toEqual(high.receipt.printAttribution);
    prepared.dispose(); expect(close).toHaveBeenCalledOnce();
  });

  it('does not legitimize stale source pixels or a copy with changed camera, source, style, frame or route', () => {
    for (const change of ['stale-source', 'camera', 'provider', 'style', 'frame', 'route', 'permission'] as const) {
      const source = artwork(); source.mapSnapshotAssetId = 'a'.repeat(64); source.mapSnapshot = snapshotMapFrame(source, frame(source));
      if (change === 'stale-source') source.canonicalCamera.zoom++;
      if (change === 'permission') source.mapSnapshot.snapshotBundleAllowed = false;
      const copy = { ...clone(source), id: 'artwork-copy' };
      if (change === 'camera') copy.canonicalCamera.bearing++;
      if (change === 'provider') copy.mapSource = { id: 'changed-provider' };
      if (change === 'style') copy.styleId = 'modern';
      if (change === 'frame') copy.nodes.find(node => node.kind === 'map')!.transform.width++;
      if (change === 'route') copy.visibility.route = false;
      const before = clone(copy), original = clone(source), result = rebindCopiedMapSnapshot(source, copy);
      expect(result, change).toEqual(before); expect(source).toEqual(original); expect(copy).toEqual(before);
      expect(result.mapSnapshot!.inputHash).not.toBe(mapSnapshotInputHash(result));
    }
  });
});
