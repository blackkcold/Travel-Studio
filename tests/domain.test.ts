import { describe, expect, it } from 'vitest';
import { collectAssetReferences, createArtwork, createEmptyProject, createNode, DocumentStore, migrateProject, parseProject, RevisionConflictError, validateProject } from '../src/domain';

describe('document transactions', () => {
  it('owns an immutable document and rejects a stale revision atomically', () => {
    const project = createEmptyProject(); const store = new DocumentStore(project);
    expect(Object.isFrozen(store.document.library.photos)).toBe(true);
    store.transact('rename', draft => { draft.name = '京都'; }, 0);
    expect(() => store.transact('stale', draft => { draft.name = 'lost'; }, 0)).toThrow(RevisionConflictError);
    expect(store.document.name).toBe('京都'); expect(project.name).toBe('我的旅行');
  });
  it('preserves monotonic revisions through undo and redo and clears abandoned redo', () => {
    const store = new DocumentStore(createEmptyProject());
    store.transact('first', draft => { draft.name = 'first'; });
    store.transact('second', draft => { draft.name = 'second'; });
    store.undo(); expect(store.document.name).toBe('first'); expect(store.document.revision).toBe(3);
    store.redo(); expect(store.document.name).toBe('second'); expect(store.document.revision).toBe(4);
    store.undo(); store.transact('third', draft => { draft.name = 'third'; }); expect(store.canRedo).toBe(false); expect(store.document.revision).toBe(6);
  });
  it('never commits a failed validation or mutation', () => {
    const store = new DocumentStore(createEmptyProject());
    expect(() => store.transact('invalid', draft => { draft.assets.push({ id: 'x', hash: 'not-a-hash', byteLength: -1, mime: 'image/png', kind: 'original' }); })).toThrow('校验失败');
    expect(store.document.assets).toHaveLength(0); expect(store.document.revision).toBe(0); expect(store.canUndo).toBe(false);
    expect(() => store.transact('throws', () => { throw new Error('cancelled'); })).toThrow('cancelled'); expect(store.document.revision).toBe(0);
  });
  it('commits validated cache metadata without consuming undo or clearing redo', () => {
    const store = new DocumentStore(createEmptyProject());
    store.transact('rename', draft => { draft.name = 'next'; }); store.undo();
    const revision = store.document.revision;
    store.transact('cache', draft => { draft.updatedAt = '2026-11-13T00:00:00Z'; }, revision, { recordHistory: false });
    expect(store.canUndo).toBe(false); expect(store.canRedo).toBe(true); expect(store.document.revision).toBe(revision + 1);
    store.redo(); expect(store.document.name).toBe('next');
    expect(() => store.transact('invalid cache', draft => { draft.assets.push({ id: 'bad', hash: 'bad', byteLength: -1, mime: 'image/png', kind: 'preview' }); }, store.document.revision, { recordHistory: false })).toThrow('校验失败');
  });
  it('keeps history roots reachable for asset garbage collection', () => {
    const store = new DocumentStore(createEmptyProject()); store.transact('rename', draft => { draft.name = 'next'; });
    expect(store.retentionDocuments()).toHaveLength(2); expect(store.exportHistory().past[0].label).toBe('rename');
  });
});

describe('safe project schema and restoration', () => {
  it('accepts a new empty document and an initially empty artwork scene', () => { const project = createEmptyProject(); project.artworks.push(createArtwork()); expect(validateProject(project)).toEqual({ valid: true, issues: [] }); });
  it('rejects future schemas, prototype fields, non-finite geometry and dangling assets', () => {
    const project = createEmptyProject(); expect(() => migrateProject({ ...project, schemaVersion: 3 })).toThrow('不支持项目版本');
    const malicious = JSON.parse(JSON.stringify(project).replace('"library":', '"__proto__":{"polluted":true},"library":'));
    expect(validateProject(malicious).valid).toBe(false); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const artwork = createArtwork(); artwork.canonicalCamera.zoom = Infinity; project.artworks.push(artwork); expect(validateProject(project).valid).toBe(false);
    artwork.canonicalCamera.zoom = 12; artwork.nodes.push(createNode('photo', 'photo', { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, { assetId: 'missing' })); expect(validateProject(project).valid).toBe(false);
  });
  it('migrates the earlier single-artwork shape on a copy', () => {
    const current = createEmptyProject(); const original = { ...current, schemaVersion: 0, artwork: createArtwork() } as Record<string, unknown>; delete original.artworks;
    const result = migrateProject(original); expect(result.schemaVersion).toBe(1); expect(result.artworks).toHaveLength(1); expect(original.schemaVersion).toBe(0); expect(original.artworks).toBeUndefined();
  });
  it('retains hidden photos, frozen works and derivative source closure', () => {
    const project = createEmptyProject(); const original = 'a'.repeat(64), derived = 'b'.repeat(64), thumb = 'c'.repeat(64);
    project.assets = [{ id: original, hash: original, mime: 'image/png', byteLength: 1, kind: 'original' }, { id: derived, hash: derived, mime: 'image/png', byteLength: 1, kind: 'derived', sourceAssetId: original }, { id: thumb, hash: thumb, mime: 'image/png', byteLength: 1, kind: 'thumbnail', sourceAssetId: original }];
    const artwork = createArtwork(); artwork.nodes.push(createNode('photo', 'photo', { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, { assetId: derived, visible: false })); artwork.frozenPhotoBindings = [{ photoId: 'deleted-photo', assetId: original, thumbnailAssetId: thumb, width: 100, height: 100, name: '旧照片' }]; project.artworks.push(artwork);
    expect(validateProject(project).valid).toBe(true); expect(collectAssetReferences(project)).toEqual(new Set([original, thumb, derived]));
    const copy = parseProject(project); copy.name = 'copy'; expect(project.name).toBe('我的旅行');
  });
  it('rejects a derivative cycle', () => {
    const project = createEmptyProject(), a = 'a'.repeat(64), b = 'b'.repeat(64);
    project.assets = [{ id: a, hash: a, sourceAssetId: b, kind: 'derived', mime: 'image/png', byteLength: 1 }, { id: b, hash: b, sourceAssetId: a, kind: 'derived', mime: 'image/png', byteLength: 1 }];
    expect(validateProject(project).issues.some(issue => issue.message.includes('成环'))).toBe(true);
  });
  it('retains a generated version owned by an artwork even before binding it to a node', () => {
    const project = createEmptyProject(), source = 'a'.repeat(64), derivative = 'b'.repeat(64), unrelated = 'c'.repeat(64);
    project.assets = [{ id: source, hash: source, kind: 'original', mime: 'image/jpeg', byteLength: 1 }, { id: derivative, hash: derivative, kind: 'derived', mime: 'image/png', byteLength: 1, sourceAssetId: source }, { id: unrelated, hash: unrelated, kind: 'derived', mime: 'image/png', byteLength: 1, sourceAssetId: source }];
    project.artworks.push(createArtwork(undefined, 'saved version', { derivedAssetIds: [derivative] }));
    expect(validateProject(project).valid).toBe(true); expect(collectAssetReferences(project)).toEqual(new Set([source, derivative]));
    project.artworks[0].derivedAssetIds!.push('missing'); expect(validateProject(project).valid).toBe(false);
  });
});
