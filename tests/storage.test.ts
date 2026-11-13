import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createEmptyProject, createArtwork, emptyJourney, createWorkspace } from '../src/domain';
import { createBrowserStore, createMemoryStore, exportProjectPackage, importProjectPackage, projectForArtwork, inspectPackageArchive, persistImportedPackage, hashBytes } from '../src/storage';
import type { ProjectDocument, AssetManifest } from '../src/domain';

async function fixture(): Promise<{ storage: ReturnType<typeof createMemoryStore>; project: ProjectDocument; own: AssetManifest; other: AssetManifest }> {
  const storage = createMemoryStore();
  const own = await storage.assets.putAsset(new Blob(['owned-photo'], { type: 'image/png' }), { kind: 'original' });
  const other = await storage.assets.putAsset(new Blob(['unrelated-private-photo'], { type: 'image/png' }), { kind: 'original' });
  const project = createEmptyProject('Trip'); project.assets = [own, other];
  project.library.photos = [
    { id: 'photo-a', assetId: own.id, name: 'A', mime: 'image/png', width: 100, height: 100, time: { precision: 'unknown', source: 'unknown' }, createdAt: project.createdAt },
    { id: 'photo-b', assetId: other.id, name: 'private-B', mime: 'image/png', width: 100, height: 100, time: { precision: 'unknown', source: 'unknown' }, createdAt: project.createdAt, placeId: 'private-place' },
  ];
  project.library.places = [{ id: 'private-place', name: 'Not in this artwork', coordinate: [121, 31], crs: 'WGS84', source: 'user', precision: 'exact', status: 'confirmed' }];
  const journey = emptyJourney(); journey.selectedPhotoIds = ['photo-a'];
  const artwork = createArtwork(journey, 'A', { id: 'art-a' }); artwork.frozenPhotoBindings = [{ photoId: 'photo-a', assetId: own.id, name: 'A', width: 100, height: 100 }];
  project.artworks = [artwork]; return { storage, project, own, other };
}
describe('asset persistence and recovery', () => {
  it('deduplicates content by SHA-256 and keeps recovery roots', async () => {
    const { storage, project, own } = await fixture();
    const again = await storage.assets.putAsset(new Blob(['owned-photo']), { kind: 'original' });
    expect(again.id).toBe(own.id); expect(own.hash).toHaveLength(64);
    await storage.projects.saveProject(project);
    project.revision++; project.name = 'Changed'; await storage.projects.saveProject(project);
    expect((await storage.projects.recoverRevision(project.id, 0))?.name).toBe('Trip');
    await expect(storage.assets.deleteAsset(own.id)).rejects.toThrow('引用');
  });
  it('saves real IndexedDB blobs and separate workspace then reopens', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const db = await createBrowserStore(name), project = createEmptyProject();
    const asset = await db.assets.putAsset(new Blob(['photo']), { kind: 'original' }); project.assets = [asset];
    project.library.photos = [{ id: 'p', assetId: asset.id, mime: asset.mime, name: 'p', width: 1, height: 1, time: { precision: 'unknown', source: 'unknown' }, createdAt: project.createdAt }];
    await db.projects.saveProject(project); await db.projects.saveWorkspace(createWorkspace(project.id)); db.close();
    const reopened = await createBrowserStore(name);
    expect((await reopened.projects.loadProject(project.id))?.assets[0].hash).toBe(asset.hash);
    expect(await (await reopened.assets.getAsset(asset.id))?.text()).toBe('photo');
    expect((await reopened.projects.loadWorkspace(project.id))?.mode).toBe('atlas'); reopened.close();
  });
});
describe('portable project integrity and privacy', () => {
  it('round-trips full project into a fresh store without browser state', async () => {
    const { storage, project } = await fixture();
    const blob = await exportProjectPackage(project, storage.assets);
    const imported = await importProjectPackage(blob), fresh = createMemoryStore();
    await persistImportedPackage(imported, fresh);
    expect(await fresh.projects.loadProject(project.id)).toEqual(project);
    expect(await fresh.assets.listAssets()).toHaveLength(2);
  });
  it('opens an older backup as an independent recovery copy and retains the newer local project', async () => {
    const { storage, project } = await fixture();
    const imported = await importProjectPackage(await exportProjectPackage(project, storage.assets));
    const current = structuredClone(project); current.revision = 3; current.name = 'Newer local work';
    await storage.projects.saveProject(current);
    const restored = await persistImportedPackage(imported, storage);
    expect(restored.id).not.toBe(current.id);
    expect(restored.name).toBe('Trip · 恢复副本');
    expect(restored.artworks).toEqual(project.artworks);
    expect((await storage.projects.loadProject(current.id))?.name).toBe('Newer local work');
    expect(await storage.projects.loadProject(restored.id)).toEqual(restored);
    expect(imported.project).toEqual(project);
    const same = await persistImportedPackage({ ...imported, project: restored }, storage);
    expect(same.id).toBe(restored.id);
  });
  it('lean packages remove unrelated photos/locations and preserve old frozen originals', async () => {
    const { storage, project, own, other } = await fixture();
    project.library.photos[0].assetId = other.id; // Source changed since artwork creation.
    const lean = projectForArtwork(project, 'art-a');
    expect(lean.library.photos.map(photo => photo.id)).toEqual(['photo-a']);
    expect(lean.library.photos[0].assetId).toBe(own.id);
    expect(lean.library.places).toEqual([]); expect(lean.assets.map(asset => asset.id)).toEqual([own.id]);
    project.library.photos = project.library.photos.filter(photo => photo.id !== 'photo-a');
    const restored = await importProjectPackage(await exportProjectPackage(project, storage.assets, { artworkId: 'art-a' }));
    expect(restored.project.library.photos[0].assetId).toBe(own.id);
    expect(JSON.stringify(restored.project)).not.toContain('private-place');
  });
  it('rejects tampered content rather than importing half a project', async () => {
    const { storage, project } = await fixture();
    const files = unzipSync(new Uint8Array(await (await exportProjectPackage(project, storage.assets)).arrayBuffer()));
    files['project.json'] = strToU8(strFromU8(files['project.json']).replace('Trip', 'Tampered'));
    await expect(importProjectPackage(new Blob([new Uint8Array(zipSync(files)).buffer]))).rejects.toThrow('完整性');
  });
  it('rejects path traversal before inflation', () => {
    const bytes = zipSync({ '../outside.json': strToU8('{}') });
    expect(() => inspectPackageArchive(bytes)).toThrow('不安全路径');
  });
  it('rejects modified assets even if project still passes structural validation', async () => {
    const { storage, project, own } = await fixture();
    const malicious = { ...storage.assets, async getAsset(id: string) { return id === own.id ? new Blob(['wrong-bytes']) : storage.assets.getAsset(id); } };
    await expect(exportProjectPackage(project, malicious)).rejects.toThrow('完整性');
    expect(await hashBytes(new Blob(['same']))).toBe(await hashBytes(new TextEncoder().encode('same')));
  });
});
