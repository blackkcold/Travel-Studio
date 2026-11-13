import { describe, expect, it } from 'vitest';
import { applyVisitCommand, clone, createArtwork, createEmptyProject, DocumentStore, mergeVisits, remapVisitOrder, remapVisitSelection, reviseVisitTime, splitVisit, validateProject, type ProjectDocument, type SelectionRecipe, type VisitOrder } from '../src/domain';
import { evaluateSelection, freezeJourney, orderVisits, parseTimeEvidence } from '../src/journey';

function fixture(): ProjectDocument {
  const project = createEmptyProject(), createdAt = '2026-07-21T00:00:00Z';
  project.library.places = ['A', 'B', 'C'].map((id, i) => ({ id, name: id, coordinate: [i, 0], crs: 'WGS84', source: 'user', precision: 'exact', status: 'confirmed' }));
  project.library.visits = ['A', 'B', 'A', 'C'].map((placeId, i) => ({ id: `v${i}`, placeId, photoIds: i === 3 ? [] : i === 1 ? ['p1'] : [`p${i}a`, `p${i}b`], time: i === 3 ? parseTimeEvidence() : parseTimeEvidence(`2026:07:21 ${['09', '11', '18'][i]}:00:00`, '+09:00'), stableIndex: i, createdAt }));
  let asset = 0;
  project.library.photos = project.library.visits.flatMap(visit => visit.photoIds.map(id => {
    const hash = String(++asset).repeat(64); project.assets.push({ id: hash, hash, kind: 'original', mime: 'image/jpeg', byteLength: 1 });
    return { id, assetId: hash, visitId: visit.id, placeId: visit.placeId, width: 100, height: 100, mime: 'image/jpeg', name: id, time: clone(visit.time), exif: { DateTimeOriginal: visit.time.raw, OffsetTimeOriginal: '+09:00' }, createdAt };
  }));
  return project;
}
const stamp = { at: '2026-11-13T12:00:00Z', operationId: 'command-1' };
const manual: VisitOrder = { mode: 'manual', timeBasis: 'recorded-local', orderedVisitIds: ['v2', 'v1', 'v0', 'v3'], unresolvedVisitIds: [] };
const recipe = (project: ProjectDocument): SelectionRecipe => ({ scopeId: 'library', predicates: [], combine: 'all', manualInclude: [...project.library.photos.map(photo => ({ kind: 'photo' as const, id: photo.id })), { kind: 'explicit-visit', id: 'v3' }], manualExclude: [] });

describe('explicit visit identity commands', () => {
  it('leaves A-B-A separate until the user explicitly chooses visits and a time source', () => {
    const project = fixture(), before = clone(project), frozen = freezeJourney(project, recipe(project), manual);
    expect(frozen.resolvedVisits.map(visit => visit.placeId)).toEqual(['A', 'B', 'A', 'C']);
    const result = mergeVisits(project.library, { visitIds: ['v0', 'v2'], targetVisitId: 'v0', timeSourceVisitId: 'v2', ...stamp });
    expect(project).toEqual(before); expect(result.library.visits.map(visit => visit.id)).toEqual(['v0', 'v1', 'v3']);
    const merged = result.library.visits[0];
    expect(merged.photoIds).toEqual(['p0a', 'p0b', 'p2a', 'p2b']); expect(merged.time).toEqual(before.library.visits[2].time);
    expect(merged.stableIndex).toBe(0); expect(merged.createdAt).toBe(before.library.visits[0].createdAt);
    expect(merged.history![0].sourceVisits.map(visit => visit.time)).toEqual([before.library.visits[0].time, before.library.visits[2].time]);
    expect(result.library.photos.filter(photo => merged.photoIds.includes(photo.id)).every(photo => photo.visitId === 'v0')).toBe(true);
    expect(result.library.photos.map(photo => [photo.id, photo.assetId, photo.time, photo.exif])).toEqual(before.library.photos.map(photo => [photo.id, photo.assetId, photo.time, photo.exif]));
  });
  it('keeps the retained identity at its chosen manual position and preserves unrelated order', () => {
    const result = mergeVisits(fixture().library, { visitIds: ['v0', 'v2'], targetVisitId: 'v0', timeSourceVisitId: 'v0', ...stamp });
    expect(remapVisitOrder(manual, result)).toEqual({ ...manual, orderedVisitIds: ['v1', 'v0', 'v3'] });
    const missingAnchor = { ...manual, orderedVisitIds: ['v2', 'v1', 'v3'] };
    expect(remapVisitOrder(missingAnchor, result).orderedVisitIds).toEqual(['v0', 'v1', 'v3']);
  });
  it('splits only the chosen photos, retains both identities and never infers a new visit time', () => {
    const project = fixture(), source = clone(project.library.visits[0]); project.library.photos[1].time = parseTimeEvidence('2026-07-21T07:00:00');
    const result = splitVisit(project.library, { visitId: 'v0', newVisitId: 'v4', photoIds: ['p0b'], ...stamp });
    expect(result.library.visits.find(visit => visit.id === 'v0')!.photoIds).toEqual(['p0a']);
    const child = result.library.visits.find(visit => visit.id === 'v4')!;
    expect(child.photoIds).toEqual(['p0b']); expect(child.time).toEqual(source.time); expect(child.stableIndex).toBe(4); expect(child.placeId).toBe('A');
    expect(result.library.photos.find(photo => photo.id === 'p0b')!.time.value).toBe('2026-07-21T07:00:00');
    expect(result.library.photos.find(photo => photo.id === 'p0b')!.visitId).toBe('v4');
    expect(remapVisitOrder(manual, result).orderedVisitIds).toEqual(['v2', 'v1', 'v0', 'v4', 'v3']);
    expect(project.library.visits).toHaveLength(4);
  });
  it('keeps date-only and unknown split evidence unresolved until explicitly ordered', () => {
    const project = fixture(); project.library.visits[0].time = parseTimeEvidence('2026-07-21');
    const result = splitVisit(project.library, { visitId: 'v0', newVisitId: 'v4', photoIds: ['p0b'], ...stamp });
    const sorted = orderVisits(result.library.visits, ['v0', 'v4'], 'time');
    expect(sorted.orderedVisitIds).toEqual([]); expect(sorted.unresolvedVisitIds).toEqual(['v0', 'v4']);
    expect(result.library.visits.find(visit => visit.id === 'v4')!.time.value).toBe('2026-07-21');
  });
  it('records explicit time correction without changing original photo evidence', () => {
    const project = fixture(), before = clone(project.library.photos), original = clone(project.library.visits[0].time);
    const time = parseTimeEvidence('2026-07-22T15:20:00', undefined, 'user');
    const result = reviseVisitTime(project.library, { visitId: 'v0', time, ...stamp });
    expect(result.library.visits[0].time).toEqual(time); expect(result.library.visits[0].history![0].sourceVisits[0].time).toEqual(original);
    expect(result.library.photos).toEqual(before); expect(result.library.visits[1]).toEqual(project.library.visits[1]);
  });
  it('preserves command provenance through split then merge without duplicating prior events', () => {
    const split = splitVisit(fixture().library, { visitId: 'v0', newVisitId: 'v4', photoIds: ['p0b'], ...stamp });
    const merged = mergeVisits(split.library, { visitIds: ['v0', 'v4'], targetVisitId: 'v0', timeSourceVisitId: 'v4', ...stamp, operationId: 'command-2' });
    expect(merged.library.visits[0].history!.map(entry => entry.id)).toEqual(['command-1', 'command-2']);
    expect(merged.library.visits[0].history![0].sourceVisits[0].photoIds).toEqual(['p0a', 'p0b']);
  });
  it('rejects different place IDs, invalid members and ambiguous photo ownership atomically', () => {
    const project = fixture(), before = clone(project);
    expect(() => mergeVisits(project.library, { visitIds: ['v0', 'v1'], targetVisitId: 'v0', timeSourceVisitId: 'v0' })).toThrow('相同地点身份');
    expect(() => mergeVisits(project.library, { visitIds: ['v0', 'v0'], targetVisitId: 'v0', timeSourceVisitId: 'v0' })).toThrow('重复');
    for (const photoIds of [[], ['missing'], ['p0a', 'p0b']]) expect(() => splitVisit(project.library, { visitId: 'v0', newVisitId: 'new', photoIds })).toThrow('部分照片');
    expect(() => splitVisit(project.library, { visitId: 'v0', newVisitId: 'v1', photoIds: ['p0a'] })).toThrow('独立身份');
    expect(project).toEqual(before);
    project.library.photos[0].visitId = 'v2'; expect(() => mergeVisits(project.library, { visitIds: ['v0', 'v2'], targetVisitId: 'v0', timeSourceVisitId: 'v0' })).toThrow('关联已改变');
  });
});

describe('selection and document transaction integration', () => {
  it('preserves atomic photo selection and transparently maps explicit visits to new atomic members', () => {
    const project = fixture(), selected = recipe(project);
    selected.manualExclude = [{ kind: 'photo', id: 'p0b' }];
    const split = splitVisit(project.library, { visitId: 'v0', newVisitId: 'v4', photoIds: ['p0b'], ...stamp });
    const updated = remapVisitSelection(selected, split);
    expect(evaluateSelection(split.library, updated).selectedPhotoIds).toEqual(evaluateSelection(project.library, selected).selectedPhotoIds);
    project.library.visits[3].placeId = 'A';
    const merge = mergeVisits(project.library, { visitIds: ['v0', 'v3'], targetVisitId: 'v0', timeSourceVisitId: 'v0', ...stamp });
    const explicitOnly: SelectionRecipe = { ...selected, manualInclude: [{ kind: 'explicit-visit', id: 'v3' }], manualExclude: [{ kind: 'photo', id: 'p0b' }] };
    expect(remapVisitSelection(explicitOnly, merge).manualInclude).toEqual([{ kind: 'photo', id: 'p0a' }]);
    expect(evaluateSelection(merge.library, remapVisitSelection(explicitOnly, merge)).selectedPhotoIds).toEqual(['p0a']);
  });
  it('undoes and redoes as one validated document command while frozen artworks stay unchanged', () => {
    const project = fixture(), journey = freezeJourney(project, recipe(project), manual), art = createArtwork(journey);
    art.frozenPhotoBindings = project.library.photos.map(photo => ({ photoId: photo.id, assetId: photo.assetId, name: photo.name, width: photo.width, height: photo.height })); project.artworks.push(art);
    const store = new DocumentStore(project), original = clone(store.document);
    store.transact('合并到访', draft => { draft.library = applyVisitCommand(draft.library, { kind: 'merge', visitIds: ['v0', 'v2'], targetVisitId: 'v0', timeSourceVisitId: 'v2', ...stamp }).library; });
    expect(store.document.library.visits).toHaveLength(3); expect(store.document.artworks).toEqual(original.artworks); expect(validateProject(store.document).valid).toBe(true);
    store.undo(); expect(store.document.library).toEqual(original.library); expect(store.document.revision).toBe(2);
    store.redo(); expect(store.document.library.visits).toHaveLength(3); expect(store.document.artworks).toEqual(original.artworks); expect(store.document.revision).toBe(3);
  });
});

describe('AI derivative provenance validation', () => {
  it('requires a matching original hash and bounded declarative provider evidence', () => {
    const project = fixture(), source = project.assets[0].id, hash = 'a'.repeat(64);
    project.assets.push({ id: hash, hash, sourceAssetId: source, kind: 'derived', mime: 'image/png', byteLength: 1, derivation: { kind: 'ai-stylize', inputHash: source, providerId: 'configured-provider', model: 'configured-model', prompt: '保留原有地理内容', generatedAt: stamp.at, consentPurpose: 'stylize' } });
    expect(validateProject(project).valid).toBe(true);
    const derivative = project.assets.at(-1)!;
    derivative.derivation!.inputHash = project.assets[1].id; expect(validateProject(project).valid).toBe(false);
    derivative.derivation!.inputHash = source; derivative.derivation!.model = ''; expect(validateProject(project).valid).toBe(false);
    derivative.derivation!.model = 'model'; derivative.derivation!.generatedAt = 'unknown'; expect(validateProject(project).valid).toBe(false);
  });
});
