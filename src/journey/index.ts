import { clone } from '../domain';
import type { ArtworkDocument, FrozenVisit, JourneySnapshot, PhotoRecord, ProjectDocument, RouteSpec, SelectionPredicate, SelectionRecipe, SelectionRef, SelectionResult, TravelLibrary, VisitOrder, VisitRecord } from '../domain';
import { distanceKm, geodesicPoints, isCoordinate, splitDateline, withinBounds } from '../geo';
import { dateOrdinal, recordedDate, sortableTime } from './time';
import { libraryFingerprint } from './fingerprint';
export * from './time';
export * from './fingerprint';

export const selectionKey = (ref: SelectionRef): string => `${ref.kind}:${ref.id}`;
/** Include/exclude are mutually exclusive; exclusions take precedence on imported recipes. */
export function toggleSelection(recipe: SelectionRecipe, ref: SelectionRef, selected: boolean): SelectionRecipe {
  const key = selectionKey(ref); const next = clone(recipe);
  next.manualInclude = next.manualInclude.filter(r => selectionKey(r) !== key);
  next.manualExclude = next.manualExclude.filter(r => selectionKey(r) !== key);
  (selected ? next.manualInclude : next.manualExclude).push(clone(ref)); return next;
}
export function clearSelectionExceptions(recipe: SelectionRecipe): SelectionRecipe { return { ...clone(recipe), manualInclude: [], manualExclude: [] }; }
export function evaluateSelection(library: TravelLibrary, recipe: SelectionRecipe): SelectionResult {
  const placeLookup = new Map(library.places.map(p => [p.id, p]));
  const visitLookup = new Map(library.visits.map(v => [v.id, v]));
  const include = new Set(recipe.manualInclude.map(selectionKey)); const exclude = new Set(recipe.manualExclude.map(selectionKey));
  const reasons: SelectionResult['reasons'] = Object.create(null);
  const selectedPhotoIds: string[] = [], explicitVisitIds: string[] = [];
  let automatic = 0, included = 0, excluded = 0;
  function predicateMatches(predicate: SelectionPredicate, time: PhotoRecord['time'], placeId?: string): boolean {
    if (predicate.type === 'date') { const date = recordedDate(time); const current = date ? dateOrdinal(date) : undefined; const anchor = dateOrdinal(predicate.anchor); return current !== undefined && anchor !== undefined && current >= anchor - predicate.daysBefore && current <= anchor + predicate.daysAfter; }
    const place = placeId ? placeLookup.get(placeId) : undefined;
    if (!place || place.status !== 'confirmed' || !isCoordinate(place.coordinate)) return false;
    if (predicate.type === 'radius') return isCoordinate(predicate.center) && Number.isFinite(predicate.radiusKm) && predicate.radiusKm >= 0 && distanceKm(predicate.center, place.coordinate) <= predicate.radiusKm;
    return withinBounds(place.coordinate, predicate);
  }
  function accepts(ref: SelectionRef, time: PhotoRecord['time'], placeId?: string): boolean {
    const key = selectionKey(ref); const hits = recipe.predicates.map(p => predicateMatches(p, time, placeId));
    const auto = hits.length > 0 && (recipe.combine === 'all' ? hits.every(Boolean) : hits.some(Boolean));
    if (auto) automatic++;
    if (include.has(key)) included++;
    if (exclude.has(key)) { excluded++; reasons[key] = 'excluded'; return false; }
    if (include.has(key)) { reasons[key] = 'manual'; return true; }
    if (auto) { reasons[key] = 'automatic'; return true; }
    reasons[key] = 'not-selected'; return false;
  }
  for (const photo of library.photos) { const placeId = photo.placeId ?? (photo.visitId ? visitLookup.get(photo.visitId)?.placeId : undefined); if (accepts({ kind: 'photo', id: photo.id }, photo.time, placeId)) selectedPhotoIds.push(photo.id); }
  for (const visit of library.visits) if (visit.photoIds.length === 0 && accepts({ kind: 'explicit-visit', id: visit.id }, visit.time, visit.placeId)) explicitVisitIds.push(visit.id);
  const selectedPhotos = new Set(selectedPhotoIds), selectedVisits = new Set(explicitVisitIds);
  for (const visit of library.visits) if (visit.photoIds.some(id => selectedPhotos.has(id))) selectedVisits.add(visit.id);
  for (const photo of library.photos) if (selectedPhotos.has(photo.id) && photo.visitId && visitLookup.has(photo.visitId)) selectedVisits.add(photo.visitId);
  const selectedVisitIds = library.visits.filter(v => selectedVisits.has(v.id)).map(v => v.id);
  const places = new Set<string>(); let unresolved = 0;
  for (const id of selectedVisitIds) { const visit = visitLookup.get(id)!; const place = visit.placeId ? placeLookup.get(visit.placeId) : undefined; if (place?.status === 'confirmed' && place.coordinate) places.add(place.id); else unresolved++; }
  const coveredPhotos = new Set(selectedVisitIds.flatMap(id => visitLookup.get(id)?.photoIds ?? []));
  unresolved += library.photos.filter(p => selectedPhotos.has(p.id) && !coveredPhotos.has(p.id) && !(p.visitId && selectedVisits.has(p.visitId))).length;
  return { selectedPhotoIds, explicitVisitIds, selectedVisitIds, reasons, counts: { photos: selectedPhotoIds.length, visits: selectedVisitIds.length, places: places.size, unresolved, automatic, included, excluded } };
}
/** Group checkbox state is derived from atomic photos, never a persistent group index. */
export function visitSelectionState(visit: VisitRecord, selectedPhotoIds: string[], explicitVisitIds: string[]): 'none' | 'some' | 'all' {
  if (!visit.photoIds.length) return explicitVisitIds.includes(visit.id) ? 'all' : 'none';
  const selected = new Set(selectedPhotoIds), count = visit.photoIds.filter(id => selected.has(id)).length; return count === 0 ? 'none' : count === visit.photoIds.length ? 'all' : 'some';
}
export function toggleVisitSelection(recipe: SelectionRecipe, visit: VisitRecord, selected: boolean): SelectionRecipe {
  if (!visit.photoIds.length) return toggleSelection(recipe, { kind: 'explicit-visit', id: visit.id }, selected);
  return visit.photoIds.reduce((next, id) => toggleSelection(next, { kind: 'photo', id }, selected), recipe);
}
export function orderVisits(visits: VisitRecord[], selectedVisitIds: string[], mode: VisitOrder['mode'] = 'time', timeBasis: VisitOrder['timeBasis'] = 'recorded-local', manualOrder: string[] = []): VisitOrder {
  const selected = new Set(selectedVisitIds), records = visits.filter(v => selected.has(v.id));
  const stable = (a: VisitRecord, b: VisitRecord) => a.stableIndex - b.stableIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (mode === 'manual') { const valid = new Set(records.map(v => v.id)), ordered = [...new Set(manualOrder.filter(id => valid.has(id)))]; const included = new Set(ordered); records.sort(stable).forEach(v => { if (!included.has(v.id)) ordered.push(v.id); }); return { mode, timeBasis, orderedVisitIds: ordered, unresolvedVisitIds: [] }; }
  const known = records.filter(v => sortableTime(v.time, timeBasis) !== undefined).sort((a, b) => sortableTime(a.time, timeBasis)! - sortableTime(b.time, timeBasis)! || stable(a, b));
  const unresolved = records.filter(v => sortableTime(v.time, timeBasis) === undefined).sort((a, b) => { const ad = recordedDate(a.time), bd = recordedDate(b.time); if (ad && bd && ad !== bd) return ad < bd ? -1 : 1; if (ad && !bd) return -1; if (!ad && bd) return 1; return stable(a, b); });
  return { mode, timeBasis, orderedVisitIds: known.map(v => v.id), unresolvedVisitIds: unresolved.map(v => v.id) };
}
export function moveVisit(order: VisitOrder, visitId: string, toIndex: number): VisitOrder {
  const sequence = [...order.orderedVisitIds, ...order.unresolvedVisitIds]; if (!sequence.includes(visitId)) return clone(order);
  const without = sequence.filter(id => id !== visitId); without.splice(Math.max(0, Math.min(without.length, Math.trunc(toIndex))), 0, visitId);
  return { mode: 'manual', timeBasis: order.timeBasis, orderedVisitIds: without, unresolvedVisitIds: [] };
}
export function buildRoute(visits: FrozenVisit[], order: VisitOrder, kind: 'itinerary' | 'geodesic' = 'itinerary'): RouteSpec {
  const lookup = new Map(visits.map(v => [v.id, v])); const route: RouteSpec = { kind, label: kind === 'geodesic' ? '大圆行程示意' : '行程示意', segments: [], gaps: [], orderedVisitIds: [...order.orderedVisitIds] };
  let previous: FrozenVisit | undefined;
  for (const id of order.orderedVisitIds) { const visit = lookup.get(id); if (!visit) { previous = undefined; continue; }
    if (visit.status !== 'confirmed' || !isCoordinate(visit.coordinate)) { route.gaps.push({ visitId: id, reason: visit.status === 'candidate' ? 'unconfirmed-location' : 'missing-coordinate' }); previous = undefined; continue; }
    if (previous?.coordinate && (previous.coordinate[0] !== visit.coordinate[0] || previous.coordinate[1] !== visit.coordinate[1])) {
      const points = kind === 'geodesic' ? geodesicPoints(previous.coordinate, visit.coordinate) : [previous.coordinate, visit.coordinate]; let index = 0;
      let current = [points[0]];
      for (let i = 1; i < points.length; i++) { const split = splitDateline(points[i - 1], points[i]); current.push(split[0][1]); if (split.length === 2) { route.segments.push({ id: `${previous.id}:${visit.id}:${index++}`, fromVisitId: previous.id, toVisitId: visit.id, coordinates: current }); current = split[1]; } }
      if (current.length > 1) route.segments.push({ id: `${previous.id}:${visit.id}:${index}`, fromVisitId: previous.id, toVisitId: visit.id, coordinates: current });
    }
    previous = visit;
  }
  order.unresolvedVisitIds.forEach(visitId => route.gaps.push({ visitId, reason: 'unresolved-time' })); return route;
}
export function freezeJourney(project: ProjectDocument, recipe: SelectionRecipe, intent: Partial<VisitOrder> = {}, selectionRevision = project.revision): JourneySnapshot {
  const selection = evaluateSelection(project.library, recipe); const order = orderVisits(project.library.visits, selection.selectedVisitIds, intent.mode ?? 'time', intent.timeBasis ?? 'recorded-local', intent.orderedVisitIds ?? []);
  const selectedPhotos = new Set(selection.selectedPhotoIds), selectedVisits = new Set(selection.selectedVisitIds); const places = new Map(project.library.places.map(p => [p.id, p]));
  const resolvedVisits: FrozenVisit[] = project.library.visits.filter(v => selectedVisits.has(v.id)).map(visit => { const place = visit.placeId ? places.get(visit.placeId) : undefined; return { id: visit.id, ...(visit.placeId ? { placeId: visit.placeId } : {}), name: visit.label || place?.name || '待定位到访', ...(place?.coordinate ? { coordinate: clone(place.coordinate) } : {}), precision: place?.precision ?? 'unknown', status: place?.status ?? 'missing', photoIds: visit.photoIds.filter(id => selectedPhotos.has(id)), time: clone(visit.time), stableIndex: visit.stableIndex }; });
  return { sourceRevision: project.revision, sourceLibraryHash: libraryFingerprint(project.library), selectionRevision, recipe: clone(recipe), selectedPhotoIds: selection.selectedPhotoIds, explicitVisitIds: selection.explicitVisitIds, selectedVisitIds: selection.selectedVisitIds, order, resolvedVisits, route: buildRoute(resolvedVisits, order) };
}
/** Explicit refresh returns a draft; only DocumentStore may commit it. Existing snapshots remain untouched. */
export function refreshArtworkJourney(project: ProjectDocument, artwork: ArtworkDocument, recipe = artwork.journey.recipe, intent: Partial<VisitOrder> = artwork.journey.order): ArtworkDocument {
  const result = clone(artwork); result.journey = freezeJourney(project, recipe, intent, artwork.journey.selectionRevision + 1);
  const photos = new Map(project.library.photos.map(p => [p.id, p])); const old = new Map(artwork.frozenPhotoBindings.map(b => [b.photoId, b]));
  result.frozenPhotoBindings = result.journey.selectedPhotoIds.map(id => { const photo = photos.get(id)!; return { photoId: id, assetId: photo.assetId, ...(photo.thumbnailAssetId ? { thumbnailAssetId: photo.thumbnailAssetId } : {}), ...(photo.proxyAssetId ? { proxyAssetId: photo.proxyAssetId } : {}), ...(old.get(id)?.derivedAssetId ? { derivedAssetId: old.get(id)!.derivedAssetId } : {}), name: photo.name, width: photo.width, height: photo.height }; });
  result.updatedAt = new Date().toISOString(); return result;
}
