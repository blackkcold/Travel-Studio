import type { ArtworkDocument, CameraSpec, ElementVisibility, JourneySnapshot, ProjectDocument, SceneNode, WorkspaceState } from './types';
import { assertValidProject } from './validation';

export const SCHEMA_VERSION = 1 as const;
export const APP_VERSION = '1.0.0';
export const DEFAULT_CAMERA: CameraSpec = { center: [135.7681, 35.0116], zoom: 11, bearing: 0, pitch: 0, terrain: false, exaggeration: 1, terrainProvider: 'mapterhorn', projection: 'mercator' };
export const DEFAULT_VISIBILITY: ElementVisibility = { map: true, photos: true, route: true, arrows: false, numbers: true, names: true, legend: false, title: true, date: true, coordinates: false, message: true, texture: true, border: true, stamp: true, compass: true, holes: true, string: true, shadow: true };
export function newId(prefix: string): string { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`; }
export function clone<T>(value: T): T { return structuredClone(value); }
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}
export function emptyJourney(scopeId = 'library'): JourneySnapshot {
  return { sourceRevision: 0, selectionRevision: 0, recipe: { scopeId, predicates: [], combine: 'all', manualInclude: [], manualExclude: [] }, selectedPhotoIds: [], explicitVisitIds: [], selectedVisitIds: [], order: { mode: 'time', timeBasis: 'recorded-local', orderedVisitIds: [], unresolvedVisitIds: [] }, resolvedVisits: [], route: { kind: 'itinerary', segments: [], gaps: [], orderedVisitIds: [], label: '行程示意' } };
}
export function createEmptyProject(name = '我的旅行'): ProjectDocument {
  const now = new Date().toISOString();
  return { schemaVersion: SCHEMA_VERSION, id: newId('project'), name, revision: 0, createdAt: now, updatedAt: now, library: { photos: [], places: [], visits: [] }, artworks: [], assets: [], provenance: [] };
}
export function createArtwork(journey: JourneySnapshot = emptyJourney(), name = '旅行纪念', options: Partial<ArtworkDocument> = {}): ArtworkDocument {
  const now = new Date().toISOString();
  return { id: newId('artwork'), name, createdAt: now, updatedAt: now, templateId: 'card-split', templateVersion: '1.0.0', styleId: 'ink', styleVersion: '1.0.0', paletteId: 'jade', artboard: { width: 1000, height: 666.667, background: '#f6f2e8', physicalWidthMm: 150, physicalHeightMm: 100, bleedMm: 3, safeMarginMm: 5 }, nodes: [], journey: clone(journey), frozenPhotoBindings: [], canonicalCamera: clone(DEFAULT_CAMERA), metadata: { title: name, date: '', message: '' }, layout: { mode: 'auto', layoutRevision: 0, solverVersion: '1.0.0', mapRatio: 0.58, gap: 24, photoCapacity: 12, density: 1 }, visibility: clone(DEFAULT_VISIBILITY), seed: 117, attributionIds: [], ...clone(options) };
}
export function createWorkspace(projectId: string): WorkspaceState { return { projectId, mode: 'atlas', atlasCamera: clone(DEFAULT_CAMERA), canvasViewport: { zoom: 1, x: 0, y: 0 }, reducedEffects: 'standard' }; }
export function createNode(kind: SceneNode['kind'], role: string, transform: SceneNode['transform'], options: Partial<SceneNode> = {}): SceneNode {
  return { id: newId('node'), kind, role, transform: clone(transform), visible: true, zIndex: 0, constraint: { position: 'auto', size: 'auto', crop: 'auto' }, layoutParticipation: 'flow', ...clone(options) };
}
export class RevisionConflictError extends Error { constructor(readonly expected: number, readonly actual: number) { super(`项目已更新：期望修订 ${expected}，当前修订 ${actual}。请刷新操作。`); this.name = 'RevisionConflictError'; } }
export interface HistoryEntry { label: string; document: ProjectDocument }
/** Only this class writes persistent project state. Undo/redo revisions remain monotonic. */
export class DocumentStore {
  private current: ProjectDocument;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  constructor(document: ProjectDocument, private readonly historyLimit = 100) { assertValidProject(document); this.current = deepFreeze(clone(document)); }
  get document(): ProjectDocument { return this.current; }
  getSnapshot = (): ProjectDocument => this.current;
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoLabel(): string | undefined { return this.past.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.future.at(-1)?.label; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(): void { this.listeners.forEach(listener => listener()); }
  transact(label: string, mutate: (draft: ProjectDocument) => void, expectedRevision = this.current.revision, options: { recordHistory?: boolean } = {}): ProjectDocument {
    if (expectedRevision !== this.current.revision) throw new RevisionConflictError(expectedRevision, this.current.revision);
    const draft = clone(this.current); mutate(draft);
    if (draft.id !== this.current.id) throw new Error('事务不能替换项目身份。');
    draft.revision = this.current.revision + 1; draft.updatedAt = new Date().toISOString(); assertValidProject(draft);
    if (options.recordHistory !== false) {
      this.past.push({ label, document: this.current }); if (this.past.length > this.historyLimit) this.past.shift();
      this.future = [];
    }
    this.current = deepFreeze(draft); this.emit(); return this.current;
  }
  private restore(entry: HistoryEntry): ProjectDocument { const restored = clone(entry.document); restored.revision = this.current.revision + 1; restored.updatedAt = new Date().toISOString(); this.current = deepFreeze(restored); this.emit(); return this.current; }
  undo(): ProjectDocument { const entry = this.past.pop(); if (!entry) return this.current; this.future.push({ label: entry.label, document: this.current }); return this.restore(entry); }
  redo(): ProjectDocument { const entry = this.future.pop(); if (!entry) return this.current; this.past.push({ label: entry.label, document: this.current }); return this.restore(entry); }
  /** A new UI selection command invalidates the abandoned document redo branch too. */
  discardRedo(): void { if (this.future.length) { this.future = []; this.emit(); } }
  /** Opening a project is an explicit lifecycle operation, not an asynchronous write. */
  replace(document: ProjectDocument): void { assertValidProject(document); this.current = deepFreeze(clone(document)); this.past = []; this.future = []; this.emit(); }
  retentionDocuments(): ProjectDocument[] { return [this.current, ...this.past.map(x => x.document), ...this.future.map(x => x.document)]; }
  exportHistory(): { past: HistoryEntry[]; future: HistoryEntry[] } { return clone({ past: this.past, future: this.future }); }
}
