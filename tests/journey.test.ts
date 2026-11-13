import { describe, expect, it } from 'vitest';
import { createArtwork, createEmptyProject, type FrozenVisit, type ProjectDocument, type SelectionRecipe, type VisitRecord } from '../src/domain';
import { boundsCenter, distanceKm, geodesicPoints, minimalBounds, parseCoordinate, splitDateline, withinBounds } from '../src/geo';
import { buildRoute, evaluateSelection, formatTimeEvidence, freezeJourney, libraryFingerprint, moveVisit, orderVisits, parseTimeEvidence, refreshArtworkJourney, sortableTime, toggleSelection, toggleVisitSelection, visitSelectionState, weekdayLabel } from '../src/journey';

function fixture(): { project: ProjectDocument; recipe: SelectionRecipe } {
  const project = createEmptyProject(); const now = '2026-07-21T00:00:00Z';
  project.library.places = [{ id: 'A', name: 'A', coordinate: [0, 0], crs: 'WGS84', source: 'user', precision: 'exact', status: 'confirmed' }, { id: 'B', name: 'B', coordinate: [0.008, 0], crs: 'WGS84', source: 'user', precision: 'exact', status: 'confirmed' }, { id: 'C', name: 'C', coordinate: [0.016, 0], crs: 'WGS84', source: 'user', precision: 'exact', status: 'confirmed' }];
  project.library.visits = ['A', 'B', 'A', 'C'].map((placeId, index) => ({ id: `v${index}`, placeId, photoIds: [`p${index}`], time: parseTimeEvidence(`2026:07:21 ${['09', '11', '18', '19'][index]}:00:00`), stableIndex: index, createdAt: now }));
  project.library.photos = project.library.visits.map((v, index) => { const hash = String(index + 1).repeat(64); project.assets.push({ id: hash, hash, byteLength: 1, mime: 'image/png', kind: 'original' }); return { id: `p${index}`, assetId: hash, name: `photo-${index}`, mime: 'image/png', width: 100, height: 100, time: { ...v.time }, visitId: v.id, placeId: v.placeId, createdAt: now }; });
  return { project, recipe: { scopeId: 'library', combine: 'all', predicates: [], manualInclude: [], manualExclude: [] } };
}
function allRecipe(project: ProjectDocument): SelectionRecipe { return { scopeId: 'library', combine: 'all', predicates: [], manualInclude: project.library.photos.map(p => ({ kind: 'photo', id: p.id })), manualExclude: [] }; }

describe('anchored atomic selection', () => {
  it('does not chain a radius through neighboring selected places', () => {
    const { project, recipe } = fixture(); recipe.predicates = [{ type: 'radius', center: [0, 0], radiusKm: 1 }];
    const result = evaluateSelection(project.library, recipe); expect(result.selectedPhotoIds).toEqual(['p0', 'p1', 'p2']); expect(result.counts.places).toBe(2); expect(result.counts.visits).toBe(3);
  });
  it('retains manual exceptions when a rule changes and keeps include/exclude exclusive', () => {
    const { project, recipe } = fixture(); recipe.predicates = [{ type: 'radius', center: [0, 0], radiusKm: 1 }];
    let next = toggleSelection(recipe, { kind: 'photo', id: 'p3' }, true); next = toggleSelection(next, { kind: 'photo', id: 'p0' }, false); next.predicates = [{ type: 'radius', center: [0, 0], radiusKm: 0.1 }];
    expect(evaluateSelection(project.library, next).selectedPhotoIds).toEqual(['p2', 'p3']);
    next = toggleSelection(next, { kind: 'photo', id: 'p0' }, true); expect(next.manualExclude).toHaveLength(0); expect(next.manualInclude.filter(r => r.id === 'p0')).toHaveLength(1);
  });
  it('date windows use the fixed anchor and all/any are explicit', () => {
    const { project, recipe } = fixture(); project.library.photos[1].time = parseTimeEvidence('2026-07-22T11:00:00'); project.library.photos[3].time = parseTimeEvidence('2026-07-23T11:00:00');
    recipe.predicates = [{ type: 'date', anchor: '2026-07-21', daysBefore: 0, daysAfter: 1 }, { type: 'radius', center: [0, 0], radiusKm: 0.1 }];
    expect(evaluateSelection(project.library, recipe).selectedPhotoIds).toEqual(['p0', 'p2']);
    recipe.combine = 'any'; expect(evaluateSelection(project.library, recipe).selectedPhotoIds).toEqual(['p0', 'p1', 'p2']);
  });
  it('ignores stale references and never confirms candidate locations through manual selection', () => {
    const { project, recipe } = fixture(); project.library.places[0].status = 'candidate'; recipe.predicates = [{ type: 'radius', center: [0, 0], radiusKm: 1 }]; recipe.manualInclude = [{ kind: 'photo', id: 'missing' }, { kind: 'photo', id: 'p0' }];
    const result = evaluateSelection(project.library, recipe); expect(result.selectedPhotoIds).toEqual(['p0', 'p1']); expect(result.counts.unresolved).toBe(1); expect(project.library.places[0].status).toBe('candidate');
  });
  it('derives partial group state and preserves visit time after the first photo is deselected', () => {
    const { project } = fixture(); const photo = { ...project.library.photos[0], id: 'extra', time: parseTimeEvidence('2026-07-21T08:00:00') }; project.library.photos.push(photo); project.library.visits[0].photoIds.push('extra');
    let recipe = allRecipe(project); recipe = toggleSelection(recipe, { kind: 'photo', id: 'extra' }, false);
    const result = evaluateSelection(project.library, recipe); expect(visitSelectionState(project.library.visits[0], result.selectedPhotoIds, [])).toBe('some');
    expect(freezeJourney(project, recipe).resolvedVisits[0].time.value).toBe('2026-07-21T09:00:00');
    recipe = toggleVisitSelection(recipe, project.library.visits[0], false); expect(evaluateSelection(project.library, recipe).selectedVisitIds).not.toContain('v0');
  });
});

describe('truthful ordering and frozen routes', () => {
  it('shows a separately recorded time-zone offset exactly once', () => {
    expect(formatTimeEvidence({ ...parseTimeEvidence('2026:07:21 09:00:00', '+09:00'), value: '2026-07-21T09:00:00' })).toBe('2026-07-21 09:00:00 +09:00');
    expect(formatTimeEvidence(parseTimeEvidence('2026-07-21T09:00:00+09:00'))).toBe('2026-07-21 09:00:00+09:00');
    expect(formatTimeEvidence(parseTimeEvidence('2026-07-21T09:00:00'))).toContain('时区未知');
  });
  it('preserves A-B-A visits and the same numbered order across snapshots', () => {
    const { project } = fixture(); const recipe = allRecipe(project); recipe.manualExclude = [{ kind: 'photo', id: 'p3' }];
    const snapshot = freezeJourney(project, recipe); expect(snapshot.selectedVisitIds).toEqual(['v0', 'v1', 'v2']); expect(snapshot.resolvedVisits.map(v => v.placeId)).toEqual(['A', 'B', 'A']); expect(snapshot.route.segments).toHaveLength(2); expect(snapshot.route.label).toBe('行程示意');
    const moved = moveVisit(snapshot.order, 'v2', 0); expect(moved.orderedVisitIds).toEqual(['v2', 'v0', 'v1']); expect(moved.mode).toBe('manual'); expect(project.library.visits[2].time.value).toContain('18:00');
  });
  it('detects source facts independently of document/cache revisions and object-key order', () => {
    const { project } = fixture(), recipe = allRecipe(project), journey = freezeJourney(project, recipe);
    expect(journey.sourceLibraryHash).toBe(libraryFingerprint(project.library));
    project.revision += 20; project.artworks.push(createArtwork());
    project.library.visits[0] = Object.fromEntries(Object.entries(project.library.visits[0]).reverse()) as unknown as VisitRecord;
    expect(libraryFingerprint(project.library)).toBe(journey.sourceLibraryHash);
    project.library.visits[0].time = parseTimeEvidence('2026-07-22T10:00:00');
    expect(libraryFingerprint(project.library)).not.toBe(journey.sourceLibraryHash);
    expect(freezeJourney(project, recipe).sourceLibraryHash).toBe(libraryFingerprint(project.library));
  });
  it('uses explicit time basis and leaves incomplete evidence unresolved', () => {
    const times = [parseTimeEvidence('2026-07-21T09:00:00+09:00'), parseTimeEvidence('2026-07-21T08:00:00Z'), parseTimeEvidence('2026-07-21T07:00:00'), parseTimeEvidence('2026-07-21'), parseTimeEvidence()];
    const visits: VisitRecord[] = times.map((time, index) => ({ id: String(index), time, photoIds: [], stableIndex: index, createdAt: '' })); const ids = visits.map(v => v.id);
    expect(orderVisits(visits, ids, 'time', 'instant')).toMatchObject({ orderedVisitIds: ['0', '1'], unresolvedVisitIds: ['2', '3', '4'] });
    expect(orderVisits(visits, ids, 'time', 'recorded-local')).toMatchObject({ orderedVisitIds: ['2', '1', '0'], unresolvedVisitIds: ['3', '4'] });
    expect(orderVisits(visits, ids, 'manual', 'instant', ['4', '3'])).toMatchObject({ orderedVisitIds: ['4', '3', '0', '1', '2'], unresolvedVisitIds: [] });
    expect(sortableTime(times[3], 'instant')).toBeUndefined(); expect(times[2].utc).toBeUndefined();
  });
  it('keeps equal timestamps deterministic independently of input order', () => {
    const { project } = fixture(); const visits = project.library.visits.map(v => ({ ...v, time: parseTimeEvidence('2026-07-21T12:00:00') })); const ids = visits.map(v => v.id);
    expect(orderVisits(visits.reverse(), ids).orderedVisitIds).toEqual(['v0', 'v1', 'v2', 'v3']);
  });
  it('breaks the route at an unknown coordinate instead of silently joining its neighbors', () => {
    const { project } = fixture(); const snapshot = freezeJourney(project, allRecipe(project)); const visits = snapshot.resolvedVisits.map(v => ({ ...v })); visits[1].coordinate = undefined; visits[1].status = 'missing';
    const route = buildRoute(visits, snapshot.order); expect(route.segments.map(s => [s.fromVisitId, s.toVisitId])).toEqual([['v2', 'v3']]); expect(route.gaps).toContainEqual({ visitId: 'v1', reason: 'missing-coordinate' });
  });
  it('freezes source facts and only updates through explicit refresh', () => {
    const { project } = fixture(); const artwork = refreshArtworkJourney(project, createArtwork(), allRecipe(project)); project.library.places[0].name = 'changed'; project.library.photos[0].name = 'new filename';
    expect(artwork.journey.resolvedVisits[0].name).toBe('A'); expect(artwork.frozenPhotoBindings[0].name).toBe('photo-0');
    const refreshed = refreshArtworkJourney(project, artwork); expect(refreshed.journey.resolvedVisits[0].name).toBe('changed'); expect(refreshed.journey.selectionRevision).toBe(artwork.journey.selectionRevision + 1); expect(artwork.journey.resolvedVisits[0].name).toBe('A');
  });
});

describe('coordinates and time evidence boundaries', () => {
  it('splits dateline routes and chooses the shortest longitude bounds', () => {
    const pieces = splitDateline([179, 10], [-179, 12]); expect(pieces).toEqual([[[179, 10], [180, 11]], [[-180, 11], [-179, 12]]]);
    expect(minimalBounds([[179, 10], [-179, 12]])).toEqual([[179, 10], [181, 12]]); expect(boundsCenter([[179, 10], [-179, 12]])).toEqual([-180, 11]);
    expect(withinBounds([-179, 0], { west: 170, east: -170, south: -10, north: 10 })).toBe(true); expect(withinBounds([0, 0], { west: 170, east: -170, south: -10, north: 10 })).toBe(false);
  });
  it('keeps short spherical distances and validates explicit longitude-first input', () => { expect(distanceKm([179, 0], [-179, 0])).toBeCloseTo(222.39, 1); expect(parseCoordinate('135.7808, 34.9949')).toEqual([135.7808, 34.9949]); expect(parseCoordinate('181, 20')).toBeNull(); expect(geodesicPoints([0, 0], [10, 10], 8)).toHaveLength(9); expect(() => geodesicPoints([0, 0], [180, 0])).toThrow('不唯一'); });
  it('does not fabricate offsets, midnight, upload dates or invalid calendar values', () => { expect(parseTimeEvidence('2026:07:21 09:00:00')).toMatchObject({ precision: 'local', raw: '2026:07:21 09:00:00', value: '2026-07-21T09:00:00' }); expect(parseTimeEvidence('2026:07:21 09:00:00', '+09:00', 'exif', '123')).toMatchObject({ precision: 'instant', utc: '2026-07-21T00:00:00.123Z' }); expect(parseTimeEvidence('2026-02-30').precision).toBe('unknown'); expect(parseTimeEvidence('2026-07-21').value).toBe('2026-07-21'); expect(parseTimeEvidence().value).toBeUndefined(); expect(weekdayLabel('2026-07-21')).toBe('星期二'); });
});
