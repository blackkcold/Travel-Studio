import type { SelectionRecipe, SelectionRef, TimeEvidence, TravelLibrary, VisitHistoryEntry, VisitOrder, VisitRecord, VisitSourceRecord } from './types';
import { clone, newId } from './document';

interface CommandStamp { at?: string; operationId?: string }
export interface MergeVisitsInput extends CommandStamp { visitIds: string[]; targetVisitId: string; timeSourceVisitId: string }
export interface SplitVisitInput extends CommandStamp { visitId: string; newVisitId: string; photoIds: string[]; time?: TimeEvidence; label?: string }
export interface ReviseVisitTimeInput extends CommandStamp { visitId: string; time: TimeEvidence }
export type VisitManagementCommand = ({ kind: 'merge' } & MergeVisitsInput) | ({ kind: 'split' } & SplitVisitInput) | ({ kind: 'time' } & ReviseVisitTimeInput);
export interface VisitMutationResult {
  library: TravelLibrary;
  /** Replacement sequences, with the retained identity first when splitting. */
  visitMap: Record<string, string[]>;
  operation: VisitHistoryEntry;
}
function requireVisit(library: TravelLibrary, id: string): VisitRecord {
  const matches = library.visits.filter(visit => visit.id === id);
  if (matches.length !== 1) throw new Error(`到访 ${id} 不存在或身份重复，请刷新后操作。`);
  return matches[0];
}
function requireUnique(ids: string[], label: string): void {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(ids).size !== ids.length) throw new Error(`${label}包含无效或重复身份。`);
}
function evidence(visit: VisitRecord): VisitSourceRecord {
  return clone({ visitId: visit.id, ...(visit.placeId ? { placeId: visit.placeId } : {}), photoIds: visit.photoIds, time: visit.time, stableIndex: visit.stableIndex, ...(visit.label ? { label: visit.label } : {}), createdAt: visit.createdAt });
}
function stamp(kind: VisitHistoryEntry['kind'], visits: VisitRecord[], targetVisitIds: string[], input: CommandStamp): VisitHistoryEntry {
  const at = input.at ?? new Date().toISOString(), id = input.operationId ?? newId('visit-command');
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || typeof id !== 'string' || !id || id.length > 200) throw new Error('到访命令的记录时间或身份无效。');
  return { id, kind, at, sourceVisits: visits.map(evidence), targetVisitIds: [...targetVisitIds] };
}
function timeEvidence(value: TimeEvidence): TimeEvidence {
  if (!value || !['instant', 'local', 'date', 'unknown'].includes(value.precision) || !['exif', 'user', 'provider', 'unknown'].includes(value.source)) throw new Error('到访时间证据无效。');
  for (const field of ['value', 'raw', 'offset', 'timeZone', 'subsecond', 'utc'] as const) if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field]!.length > 2000)) throw new Error('到访时间证据字段无效。');
  if (value.precision !== 'unknown' && !value.value) throw new Error('该时间精度需要显式时间值。');
  return clone(value);
}
function histories(visits: VisitRecord[], operation: VisitHistoryEntry): VisitHistoryEntry[] {
  const entries = new Map<string, VisitHistoryEntry>();
  for (const visit of visits) for (const entry of visit.history ?? []) entries.set(entry.id, clone(entry));
  entries.set(operation.id, clone(operation)); return [...entries.values()];
}
function verifyPhotoOwnership(library: TravelLibrary, visits: VisitRecord[]): void {
  const all = new Set<string>();
  for (const visit of visits) {
    requireUnique(visit.photoIds, '到访照片');
    for (const id of visit.photoIds) {
      if (all.has(id)) throw new Error('同一照片不能同时属于多次待处理到访。'); all.add(id);
      const photo = library.photos.find(photo => photo.id === id);
      if (!photo || (photo.visitId && photo.visitId !== visit.id) || library.visits.some(other => other.id !== visit.id && other.photoIds.includes(id))) throw new Error('照片与到访关联已改变，请刷新后操作。');
    }
    if (library.photos.some(photo => photo.visitId === visit.id && !visit.photoIds.includes(photo.id))) throw new Error('到访缺少反向关联照片，请先修复资料。');
  }
}
/** Explicit only: names, nearby coordinates and clustering never trigger this command. */
export function mergeVisits(library: TravelLibrary, input: MergeVisitsInput): VisitMutationResult {
  requireUnique(input.visitIds, '待合并到访');
  if (input.visitIds.length < 2) throw new Error('合并至少需要两次到访。');
  const sourceIds = new Set(input.visitIds), sources = library.visits.filter(visit => sourceIds.has(visit.id));
  if (sources.length !== input.visitIds.length || !sourceIds.has(input.targetVisitId) || !sourceIds.has(input.timeSourceVisitId)) throw new Error('请从待合并到访中选择保留身份和时间来源。');
  const target = requireVisit(library, input.targetVisitId), timeSource = requireVisit(library, input.timeSourceVisitId);
  if (sources.some(visit => visit.placeId !== target.placeId)) throw new Error('只能合并相同地点身份的到访；同名地点不会自动视为同一地点。');
  verifyPhotoOwnership(library, sources);
  const operation = stamp('merge', sources, [target.id], input), next = clone(library);
  const photoIds = [target, ...sources.filter(visit => visit.id !== target.id)].flatMap(visit => visit.photoIds);
  const merged: VisitRecord = { ...clone(target), photoIds, time: timeEvidence(timeSource.time), history: histories(sources, operation) };
  next.visits = next.visits.flatMap(visit => visit.id === target.id ? [merged] : sourceIds.has(visit.id) ? [] : [visit]);
  const moved = new Set(photoIds); for (const photo of next.photos) if (moved.has(photo.id)) photo.visitId = target.id;
  return { library: next, visitMap: Object.fromEntries(sources.map(visit => [visit.id, [target.id]])), operation };
}
/** Separates an explicit photo subset, preserving the original visit time unless changed deliberately. */
export function splitVisit(library: TravelLibrary, input: SplitVisitInput): VisitMutationResult {
  const source = requireVisit(library, input.visitId); requireUnique(input.photoIds, '拆分照片');
  if (typeof input.newVisitId !== 'string' || !input.newVisitId || input.newVisitId.length > 200 || library.visits.some(visit => visit.id === input.newVisitId)) throw new Error('拆分后的到访需要新的独立身份。');
  if (!input.photoIds.length || input.photoIds.length >= source.photoIds.length || input.photoIds.some(id => !source.photoIds.includes(id))) throw new Error('请选择该到访中的部分照片，并为原到访至少保留一张。');
  if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 2000)) throw new Error('到访名称过长或无效。');
  verifyPhotoOwnership(library, [source]);
  const operation = stamp('split', [source], [source.id, input.newVisitId], input), next = clone(library), selected = new Set(input.photoIds);
  const history = histories([source], operation), remaining = { ...clone(source), photoIds: source.photoIds.filter(id => !selected.has(id)), history: clone(history) };
  const child: VisitRecord = { ...clone(source), id: input.newVisitId, photoIds: source.photoIds.filter(id => selected.has(id)), time: input.time ? timeEvidence(input.time) : clone(source.time), stableIndex: Math.max(-1, ...library.visits.map(visit => visit.stableIndex)) + 1, createdAt: operation.at, history: clone(history), ...(input.label !== undefined ? { label: input.label } : {}) };
  next.visits = next.visits.flatMap(visit => visit.id === source.id ? [remaining, child] : [visit]);
  for (const photo of next.photos) if (selected.has(photo.id)) photo.visitId = child.id;
  return { library: next, visitMap: { [source.id]: [source.id, child.id] }, operation };
}
export function reviseVisitTime(library: TravelLibrary, input: ReviseVisitTimeInput): VisitMutationResult {
  const source = requireVisit(library, input.visitId), time = timeEvidence(input.time);
  const operation = stamp('time', [source], [source.id], input), next = clone(library), target = next.visits.find(visit => visit.id === source.id)!;
  target.time = time; target.history = histories([source], operation);
  return { library: next, visitMap: { [source.id]: [source.id] }, operation };
}
export function applyVisitCommand(library: TravelLibrary, command: VisitManagementCommand): VisitMutationResult {
  if (command.kind === 'merge') return mergeVisits(library, command);
  if (command.kind === 'split') return splitVisit(library, command);
  return reviseVisitTime(library, command);
}
/** Retained anchor position wins on merge; unrelated manual sequence never moves. */
export function remapVisitOrder(order: VisitOrder, mutation: VisitMutationResult): VisitOrder {
  const alive = new Set(mutation.library.visits.map(visit => visit.id));
  const original = new Set([...order.orderedVisitIds, ...order.unresolvedVisitIds]), added = new Set<string>();
  function sequence(ids: string[]) {
    const output: string[] = [];
    for (const old of ids) for (const id of mutation.visitMap[old] ?? [old]) {
      if (!alive.has(id) || added.has(id) || (id !== old && original.has(id))) continue;
      output.push(id); added.add(id);
    }
    return output;
  }
  return { mode: order.mode, timeBasis: order.timeBasis, orderedVisitIds: sequence(order.orderedVisitIds), unresolvedVisitIds: sequence(order.unresolvedVisitIds) };
}
/** Explicit no-photo visits become atomic photo references if merged into a photo visit. */
export function remapVisitSelection(recipe: SelectionRecipe, mutation: VisitMutationResult): SelectionRecipe {
  const visits = new Map(mutation.library.visits.map(visit => [visit.id, visit]));
  function references(refs: SelectionRef[]): SelectionRef[] {
    const output = new Map<string, SelectionRef>();
    for (const ref of refs) {
      const replacements: SelectionRef[] = ref.kind === 'photo' || !mutation.visitMap[ref.id] ? [ref] : mutation.visitMap[ref.id].flatMap<SelectionRef>(id => {
        const visit = visits.get(id); if (!visit) return [];
        return visit.photoIds.length ? visit.photoIds.map(id => ({ kind: 'photo' as const, id })) : [{ kind: 'explicit-visit' as const, id }];
      });
      for (const next of replacements) output.set(`${next.kind}:${next.id}`, clone(next));
    }
    return [...output.values()];
  }
  const next = clone(recipe); next.manualInclude = references(recipe.manualInclude); next.manualExclude = references(recipe.manualExclude);
  const excluded = new Set(next.manualExclude.map(ref => `${ref.kind}:${ref.id}`)); next.manualInclude = next.manualInclude.filter(ref => !excluded.has(`${ref.kind}:${ref.id}`));
  return next;
}
