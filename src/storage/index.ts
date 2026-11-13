import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { zip, unzip, strToU8, strFromU8 } from 'fflate';
import { assertValidProject, collectAssetReferences, migrateProject, newId, validateProject } from '../domain';
import type { ProjectDocument, AssetManifest, WorkspaceState, PhotoRecord, PlaceRecord, VisitRecord } from '../domain';

export type AssetInput = Omit<AssetManifest, 'id' | 'hash' | 'byteLength' | 'mime'> & { mime?: string };
export interface AssetStore {
  putAsset(blob: Blob, metadata: AssetInput): Promise<AssetManifest>;
  getAsset(id: string): Promise<Blob | undefined>;
  getManifest(id: string): Promise<AssetManifest | undefined>;
  listAssets(): Promise<AssetManifest[]>;
  deleteAsset(id: string, retainedIds?: ReadonlySet<string>): Promise<void>;
}
export interface ProjectSummary { id: string; name: string; revision: number; updatedAt: string; artworks: number; recoveryOnly?: boolean }
export interface ProjectStore {
  saveProject(project: ProjectDocument): Promise<void>;
  loadProject(id: string): Promise<ProjectDocument | undefined>;
  loadRawProject(id: string): Promise<unknown>;
  latestProject(): Promise<ProjectDocument | undefined>;
  listProjects(): Promise<ProjectSummary[]>;
  listRevisions(id: string): Promise<number[]>;
  recoverRevision(id: string, revision: number): Promise<ProjectDocument | undefined>;
  saveWorkspace(state: WorkspaceState): Promise<void>;
  loadWorkspace(projectId: string): Promise<WorkspaceState | undefined>;
}
export interface StorageBundle { assets: AssetStore; projects: ProjectStore; close(): void }
interface StoredAsset { manifest: AssetManifest; blob: Blob }
interface StoredRevision { key: string; projectId: string; revision: number; project: ProjectDocument }
interface TravelDB extends DBSchema {
  assets: { key: string; value: StoredAsset };
  projects: { key: string; value: ProjectDocument };
  revisions: { key: string; value: StoredRevision; indexes: { 'by-project': string } };
  workspace: { key: string; value: WorkspaceState };
}
export async function hashBytes(value: Blob | Uint8Array | ArrayBuffer): Promise<string> {
  const source = value instanceof Blob ? await value.arrayBuffer() : value instanceof Uint8Array ? new Uint8Array(value).buffer : value;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function assetRecord(blob: Blob, metadata: AssetInput): Promise<StoredAsset> {
  if (!blob.size) throw new Error('不能保存空资源。');
  const hash = await hashBytes(blob);
  const manifest: AssetManifest = { ...metadata, id: hash, hash, mime: metadata.mime ?? (blob.type || 'application/octet-stream'), byteLength: blob.size };
  if (manifest.sourceAssetId === hash) delete manifest.sourceAssetId;
  return { manifest, blob };
}
function summary(project: ProjectDocument): ProjectSummary {
  return { id: project.id, name: typeof project.name === 'string' ? project.name : '待恢复项目', revision: Number.isInteger(project.revision) ? project.revision : 0, updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : '', artworks: Array.isArray(project.artworks) ? project.artworks.length : 0, ...(!validateProject(project).valid ? { recoveryOnly: true } : {}) };
}
function clone<T>(value: T): T { return structuredClone(value); }

/** Local origin is stable. Writes fail visibly; there is no silent in-memory "saved" fallback. */
export async function createBrowserStore(name = 'travel-studio-v1'): Promise<StorageBundle> {
  if (!globalThis.indexedDB) throw new Error('此浏览器无法使用本地数据库。请保留页面并下载项目文件。');
  const db: IDBPDatabase<TravelDB> = await openDB<TravelDB>(name, 1, {
    upgrade(database) {
      database.createObjectStore('assets', { keyPath: 'manifest.id' });
      database.createObjectStore('projects', { keyPath: 'id' });
      const revisions = database.createObjectStore('revisions', { keyPath: 'key' });
      revisions.createIndex('by-project', 'projectId');
      database.createObjectStore('workspace', { keyPath: 'projectId' });
    },
  });
  const assets: AssetStore = {
    async putAsset(blob, metadata) {
      const record = await assetRecord(blob, metadata);
      const existing = await db.get('assets', record.manifest.id);
      if (existing) return clone(existing.manifest);
      await db.put('assets', record);
      return clone(record.manifest);
    },
    async getAsset(id) { return (await db.get('assets', id))?.blob; },
    async getManifest(id) { return (await db.get('assets', id))?.manifest; },
    async listAssets() { return (await db.getAll('assets')).map(asset => asset.manifest); },
    async deleteAsset(id, retainedIds) {
      if (retainedIds?.has(id)) throw new Error('资源仍被作品、历史或任务引用。');
      // All saved recovery revisions are roots, not merely the current library.
      const roots = [...await db.getAll('projects'), ...(await db.getAll('revisions')).map(value => value.project)];
      if (roots.some(project => collectAssetReferences(project).has(id))) throw new Error('资源仍被已保存项目或恢复版本引用。');
      await db.delete('assets', id);
    },
  };
  const projects: ProjectStore = {
    async saveProject(project) {
      assertValidProject(project);
      const snapshot = clone(project);
      for (const id of collectAssetReferences(snapshot)) if (!await db.getKey('assets', id)) throw new Error(`保存失败：缺少资源 ${id.slice(0, 12)}。请先下载可恢复项目。`);
      const tx = db.transaction(['projects', 'revisions'], 'readwrite');
      const existing = await tx.objectStore('projects').get(snapshot.id);
      if (existing && existing.revision > snapshot.revision) { tx.abort(); throw new Error('较旧修订不能覆盖已保存的新修订。'); }
      await tx.objectStore('projects').put(snapshot);
      await tx.objectStore('revisions').put({ key: `${snapshot.id}:${snapshot.revision}`, projectId: snapshot.id, revision: snapshot.revision, project: snapshot });
      const versions = (await tx.objectStore('revisions').index('by-project').getAll(snapshot.id)).sort((a, b) => b.revision - a.revision);
      for (const old of versions.slice(10)) await tx.objectStore('revisions').delete(old.key);
      await tx.done;
    },
    async loadProject(id) { const project = await db.get('projects', id); if (project) assertValidProject(project); return project; },
    async loadRawProject(id) { return db.get('projects', id); },
    async latestProject() { const all = await db.getAll('projects'); const project = all.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]; if (project) assertValidProject(project); return project; },
    async listProjects() { return (await db.getAll('projects')).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async listRevisions(id) { return (await db.getAllFromIndex('revisions', 'by-project', id)).map(item => item.revision).sort((a, b) => b - a); },
    async recoverRevision(id, revision) { return (await db.get('revisions', `${id}:${revision}`))?.project; },
    async saveWorkspace(state) { await db.put('workspace', clone(state)); },
    async loadWorkspace(projectId) { return db.get('workspace', projectId); },
  };
  return { assets, projects, close: () => db.close() };
}

/** Deterministic adapter for contract tests and explicitly labelled temporary sessions. */
export function createMemoryStore(): StorageBundle {
  const blobs = new Map<string, StoredAsset>();
  const documents = new Map<string, ProjectDocument>();
  const revisions = new Map<string, ProjectDocument>();
  const workspaces = new Map<string, WorkspaceState>();
  const assets: AssetStore = {
    async putAsset(blob, metadata) { const asset = await assetRecord(blob, metadata); const prior = blobs.get(asset.manifest.id); if (!prior) blobs.set(asset.manifest.id, asset); return clone((prior ?? asset).manifest); },
    async getAsset(id) { return blobs.get(id)?.blob; },
    async getManifest(id) { const item = blobs.get(id); return item && clone(item.manifest); },
    async listAssets() { return [...blobs.values()].map(value => clone(value.manifest)); },
    async deleteAsset(id, retainedIds) { if (retainedIds?.has(id) || [...documents.values(), ...revisions.values()].some(project => collectAssetReferences(project).has(id))) throw new Error('资源仍被项目或历史引用。'); blobs.delete(id); },
  };
  const projects: ProjectStore = {
    async saveProject(project) {
      assertValidProject(project);
      for (const id of collectAssetReferences(project)) if (!blobs.has(id)) throw new Error(`Missing asset ${id}`);
      if ((documents.get(project.id)?.revision ?? -1) > project.revision) throw new Error('较旧修订不能覆盖已保存的新修订。');
      documents.set(project.id, clone(project)); revisions.set(`${project.id}:${project.revision}`, clone(project));
      const old = [...revisions.entries()].filter(([, p]) => p.id === project.id).sort((a, b) => b[1].revision - a[1].revision).slice(10);
      old.forEach(([key]) => revisions.delete(key));
    },
    async loadProject(id) { const value = documents.get(id); return value && clone(value); },
    async loadRawProject(id) { const value = documents.get(id); return value && clone(value); },
    async latestProject() { const value = [...documents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; return value && clone(value); },
    async listProjects() { return [...documents.values()].map(summary); },
    async listRevisions(id) { return [...revisions.values()].filter(p => p.id === id).map(p => p.revision).sort((a, b) => b - a); },
    async recoverRevision(id, revision) { const value = revisions.get(`${id}:${revision}`); return value && clone(value); },
    async saveWorkspace(state) { workspaces.set(state.projectId, clone(state)); },
    async loadWorkspace(id) { const value = workspaces.get(id); return value && clone(value); },
  };
  return { assets, projects, close() { /* The caller owns the memory session. */ } };
}

export interface StartupRecovery { message: string; sourceProjectId?: string; restoredProjectId?: string; revision?: number }
/** Recover a usable history copy without deleting or overwriting an incompatible local document. */
export async function recoverLatestProject(storage: StorageBundle, options: { validate?: (project: ProjectDocument) => void } = {}): Promise<{ project?: ProjectDocument; recovery?: StartupRecovery }> {
  let failure: string;
  const validate = async (project: ProjectDocument) => {
    assertValidProject(project);
    options.validate?.(project);
    for (const assetId of collectAssetReferences(project)) if (!await storage.assets.getManifest(assetId)) throw new Error(`缺少资源 ${assetId.slice(0, 12)}。`);
  };
  try { const project = await storage.projects.latestProject(); if (project) await validate(project); return { project }; }
  catch (error) { failure = error instanceof Error ? error.message : String(error); }
  const projects = await storage.projects.listProjects();
  for (const entry of projects) {
    const versions = (await storage.projects.listRevisions(entry.id)).sort((a, b) => b - a);
    const candidates: ProjectDocument[] = [];
    try { const current = await storage.projects.loadProject(entry.id); if (current) candidates.push(current); } catch { /* Keep the source row available for read-only recovery. */ }
    for (const revision of versions) { const candidate = await storage.projects.recoverRevision(entry.id, revision); if (candidate) candidates.push(candidate); }
    candidates.sort((a, b) => b.revision - a.revision);
    for (const candidate of candidates) {
      try {
        await validate(candidate);
        const project = clone(candidate), now = new Date().toISOString();
        project.id = newId('project'); project.name = `${candidate.name} · 自动恢复`; project.createdAt = now; project.updatedAt = now;
        await storage.projects.saveProject(project);
        return { project, recovery: { message: `已从「${entry.name}」修订 ${candidate.revision} 创建自动恢复副本。原始条目保留在本机，可从项目列表只读查看和下载。`, sourceProjectId: entry.id, restoredProjectId: project.id, revision: candidate.revision } };
      } catch { /* Try an earlier validated revision; never silently repair facts. */ }
    }
  }
  return { recovery: { message: `未找到可编辑的有效历史版本：${failure}。原始条目仍保留在本机，请从项目列表只读查看、下载原始文档，或打开独立项目备份。`, sourceProjectId: projects[0]?.id } };
}

export interface PackageEntry { path: string; hash: string; byteLength: number; mime: string; assetId?: string }
export interface PackageManifest { format: 'travelstudio'; containerVersion: 1; appVersion: string; projectId: string; schemaVersion: number; mode: 'full' | 'artwork'; entries: PackageEntry[]; createdAt: string }
export interface ImportedProject { project: ProjectDocument; assets: StoredAsset[]; manifest: PackageManifest; warnings: string[] }
export const PACKAGE_LIMITS = { compressedBytes: 256 * 1024 * 1024, uncompressedBytes: 512 * 1024 * 1024, entryBytes: 128 * 1024 * 1024, jsonBytes: 10 * 1024 * 1024, entries: 1500 } as const;

export function projectForArtwork(source: ProjectDocument, artworkId: string): ProjectDocument {
  const project = clone(source);
  const artwork = project.artworks.find(value => value.id === artworkId);
  if (!artwork) throw new Error('目标作品不存在。');
  project.artworks = [artwork];
  const photoIds = new Set([...artwork.journey.selectedPhotoIds, ...artwork.frozenPhotoBindings.map(binding => binding.photoId), ...artwork.nodes.map(node => node.photoId).filter((id): id is string => !!id)]);
  // Freeze-only works must not pull newer library originals or lose deleted source photos.
  const bindings = new Map(artwork.frozenPhotoBindings.map(binding => [binding.photoId, binding]));
  const photos: PhotoRecord[] = [...photoIds].flatMap(id => {
    const binding = bindings.get(id), live = source.library.photos.find(photo => photo.id === id);
    if (binding) {
      const frozenVisit = artwork.journey.resolvedVisits.find(visit => visit.photoIds.includes(id));
      const asset = source.assets.find(item => item.id === binding.assetId);
      return [{ id, assetId: binding.assetId, thumbnailAssetId: binding.thumbnailAssetId, proxyAssetId: binding.proxyAssetId, name: binding.name, mime: asset?.mime ?? live?.mime ?? 'image/jpeg', width: binding.width, height: binding.height, time: clone(frozenVisit?.time ?? { precision: 'unknown', source: 'unknown' }), createdAt: artwork.createdAt } satisfies PhotoRecord];
    }
    return live ? [clone(live)] : [];
  });
  const visits: VisitRecord[] = artwork.journey.resolvedVisits.map(visit => ({ id: visit.id, placeId: visit.placeId, photoIds: visit.photoIds.filter(id => photoIds.has(id)), time: clone(visit.time), stableIndex: visit.stableIndex, label: visit.name, createdAt: artwork.createdAt }));
  const places = new Map<string, PlaceRecord>();
  for (const visit of artwork.journey.resolvedVisits) if (visit.placeId && !places.has(visit.placeId)) places.set(visit.placeId, { id: visit.placeId, name: visit.name, coordinate: visit.coordinate && [...visit.coordinate], originalCoordinate: visit.coordinate && [...visit.coordinate], crs: 'WGS84', source: 'artwork-snapshot', precision: visit.precision, status: visit.status });
  for (const photo of photos) {
    const visit = visits.find(value => value.photoIds.includes(photo.id));
    if (visit) { photo.visitId = visit.id; photo.placeId = visit.placeId; }
    else { delete photo.visitId; if (photo.placeId && !places.has(photo.placeId)) { const place = source.library.places.find(value => value.id === photo.placeId); if (place) places.set(place.id, clone(place)); else delete photo.placeId; } }
  }
  for (const visit of artwork.journey.resolvedVisits) visit.photoIds = visit.photoIds.filter(id => photoIds.has(id));
  const validVisits = new Set(visits.map(value => value.id));
  artwork.journey.recipe.manualInclude = artwork.journey.recipe.manualInclude.filter(ref => ref.kind === 'photo' ? photoIds.has(ref.id) : validVisits.has(ref.id));
  artwork.journey.recipe.manualExclude = artwork.journey.recipe.manualExclude.filter(ref => ref.kind === 'photo' ? photoIds.has(ref.id) : validVisits.has(ref.id));
  project.library = { photos, visits, places: [...places.values()] };
  const retained = collectAssetReferences(project);
  project.assets = project.assets.filter(asset => retained.has(asset.id));
  const attributions = new Set([...artwork.attributionIds, ...project.assets.map(asset => asset.attributionId).filter((id): id is string => !!id)]);
  project.provenance = project.provenance.filter(value => attributions.has(value.id));
  assertValidProject(project);
  return project;
}

async function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> { return new Promise((resolve, reject) => zip(files, { level: 1 }, (error, bytes) => error ? reject(error) : resolve(bytes))); }
async function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> { return new Promise((resolve, reject) => unzip(bytes, (error, files) => error ? reject(error) : resolve(files))); }
function jsonBytes(value: unknown): Uint8Array { return strToU8(JSON.stringify(value, null, 2)); }
function validPath(path: string): boolean { return typeof path === 'string' && !!path && path.length <= 240 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(part => !part || part === '.' || part === '..' || ['__proto__', 'constructor', 'prototype'].includes(part) || part.includes(':')) && !/%2e|%2f|%5c/i.test(path); }
function safeName(id: string): string { return id.replace(/[^\w.-]/g, '_').slice(0, 100); }

export async function exportProjectPackage(project: ProjectDocument, assets: AssetStore, options: { artworkId?: string; appVersion?: string; signal?: AbortSignal } = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  const snapshot = options.artworkId ? projectForArtwork(project, options.artworkId) : clone(project);
  assertValidProject(snapshot);
  const used = collectAssetReferences(snapshot);
  snapshot.assets = snapshot.assets.filter(asset => used.has(asset.id));
  const files: Record<string, Uint8Array> = { 'project.json': jsonBytes(snapshot) };
  const entryMeta: Record<string, { mime: string; assetId?: string }> = { 'project.json': { mime: 'application/json' } };
  let total = files['project.json'].length;
  for (const asset of snapshot.assets) {
    options.signal?.throwIfAborted();
    const blob = await assets.getAsset(asset.id);
    if (!blob) throw new Error(`项目缺少资源 ${asset.name ?? asset.id.slice(0, 12)}，不能生成损坏项目包。`);
    if (blob.size !== asset.byteLength || await hashBytes(blob) !== asset.hash) throw new Error(`资源完整性校验失败：${asset.id.slice(0, 12)}。`);
    total += blob.size;
    if (total > PACKAGE_LIMITS.uncompressedBytes || blob.size > PACKAGE_LIMITS.entryBytes) throw new Error('项目超过安全打包容量，请仅打包当前作品或减少原图。');
    const path = `assets/${asset.id}`;
    files[path] = new Uint8Array(await blob.arrayBuffer()); entryMeta[path] = { mime: asset.mime, assetId: asset.id };
  }
  for (const artwork of snapshot.artworks) {
    const stylePath = `styles/${safeName(artwork.styleId)}-${safeName(artwork.styleVersion)}.json`;
    files[stylePath] = jsonBytes(artwork.embeddedStyle ?? { id: artwork.styleId, version: artwork.styleVersion, builtin: true }); entryMeta[stylePath] = { mime: 'application/json' };
    const templatePath = `templates/${safeName(artwork.templateId)}-${safeName(artwork.templateVersion)}.json`;
    files[templatePath] = jsonBytes(artwork.embeddedTemplate ?? { id: artwork.templateId, version: artwork.templateVersion, builtin: true }); entryMeta[templatePath] = { mime: 'application/json' };
    if (artwork.previewAssetId && files[`assets/${artwork.previewAssetId}`]) {
      const path = `previews/${safeName(artwork.id)}.image`;
      files[path] = files[`assets/${artwork.previewAssetId}`]; entryMeta[path] = { mime: snapshot.assets.find(asset => asset.id === artwork.previewAssetId)?.mime ?? 'image/png' };
    }
  }
  files['licenses/attributions.json'] = jsonBytes(snapshot.provenance); entryMeta['licenses/attributions.json'] = { mime: 'application/json' };
  files['licenses/README.txt'] = strToU8('Original photos belong to their owner. Included local map snapshots retain their recorded attribution. Online map tiles/DEM are not bundled; complete offline map editing is not implied. See the source/policy records in project.json.'); entryMeta['licenses/README.txt'] = { mime: 'text/plain' };
  if (Object.keys(files).length >= PACKAGE_LIMITS.entries) throw new Error('项目文件数超过安全打包预算，请仅打包当前作品。');
  let packageBytes = 0;
  for (const [path, bytes] of Object.entries(files)) {
    packageBytes += bytes.byteLength;
    if (!validPath(path) || bytes.byteLength > PACKAGE_LIMITS.entryBytes || (path.endsWith('.json') && bytes.byteLength > PACKAGE_LIMITS.jsonBytes) || packageBytes > PACKAGE_LIMITS.uncompressedBytes) throw new Error('项目路径或体积超过安全打包预算，请仅打包当前作品。');
  }
  const entries: PackageEntry[] = [];
  for (const [path, bytes] of Object.entries(files)) entries.push({ path, byteLength: bytes.length, hash: await hashBytes(bytes), ...entryMeta[path] });
  const manifest: PackageManifest = { format: 'travelstudio', containerVersion: 1, appVersion: options.appVersion ?? '1.0.0', projectId: snapshot.id, schemaVersion: snapshot.schemaVersion, mode: options.artworkId ? 'artwork' : 'full', createdAt: new Date().toISOString(), entries };
  files['manifest.json'] = jsonBytes(manifest);
  options.signal?.throwIfAborted();
  const bytes = await zipAsync(files);
  options.signal?.throwIfAborted();
  if (bytes.length > PACKAGE_LIMITS.compressedBytes) throw new Error('压缩项目超过 256 MiB，请仅打包当前作品。');
  return new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' });
}

/** Inspect central-directory claims before any inflation. ZIP64/encryption are not accepted. */
export function inspectPackageArchive(bytes: Uint8Array): Array<{ path: string; size: number; compressedSize: number }> {
  if (bytes.byteLength > PACKAGE_LIMITS.compressedBytes) throw new Error('项目文件超过 256 MiB。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('不是完整的 travelstudio ZIP 项目。');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (!count || count > PACKAGE_LIMITS.entries || view.getUint16(end + 8, true) !== count || offset + directorySize > end || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || end + 22 + view.getUint16(end + 20, true) !== bytes.length || (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50)) throw new Error('项目容器目录或体积不合法。');
  const result: Array<{ path: string; size: number; compressedSize: number }> = [], paths = new Set<string>();
  let cursor = offset, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('项目目录损坏。');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), compressedSize = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true), nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true), localOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > offset + directorySize || flags & 1 || ![0, 8].includes(method) || localOffset >= offset || size > PACKAGE_LIMITS.entryBytes || compressedSize > PACKAGE_LIMITS.entryBytes || size === 0xffffffff) throw new Error('不支持加密、ZIP64 或超大项目条目。');
    const path = strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!validPath(path) || paths.has(path)) throw new Error('项目包含重复或不安全路径。');
    if (localOffset + 30 > offset || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('项目本地文件头损坏。');
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    if (localOffset + 30 + localNameLength + localExtraLength + compressedSize > offset || strFromU8(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== path) throw new Error('项目文件头与目录不一致。');
    if (path.endsWith('.json') && size > PACKAGE_LIMITS.jsonBytes) throw new Error('项目 JSON 超过 10 MiB。');
    total += size; if (total > PACKAGE_LIMITS.uncompressedBytes || (size > 10_000_000 && size > Math.max(compressedSize, 1) * 500)) throw new Error('项目解压预算超限。');
    paths.add(path); result.push({ path, size, compressedSize }); cursor = next;
  }
  if (cursor !== offset + directorySize) throw new Error('项目目录长度不符。');
  return result;
}
export class ProjectRecoveryError extends Error {
  constructor(message: string, public readonly original: Blob, public readonly previews: Blob[]) { super(message); this.name = 'ProjectRecoveryError'; }
}
export async function importProjectPackage(blob: Blob, options: { signal?: AbortSignal } = {}): Promise<ImportedProject> {
  options.signal?.throwIfAborted();
  if (blob.size > PACKAGE_LIMITS.compressedBytes) throw new Error('项目文件超过安全容量。');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const directory = inspectPackageArchive(bytes);
  const files = await unzipAsync(bytes);
  options.signal?.throwIfAborted();
  for (const entry of directory) if (files[entry.path]?.length !== entry.size) throw new Error('解压后的文件尺寸不符合目录。');
  if (!files['manifest.json'] || !files['project.json']) throw new Error('项目缺少 manifest.json 或 project.json。');
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as PackageManifest;
  if (manifest.format !== 'travelstudio' || manifest.containerVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length >= PACKAGE_LIMITS.entries) throw new ProjectRecoveryError('项目容器版本不兼容。原文件未修改，请使用相应版本恢复。', blob, []);
  const expected = new Set<string>(['manifest.json']);
  for (const entry of manifest.entries) {
    if (!entry || !validPath(entry.path) || expected.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isInteger(entry.byteLength) || entry.byteLength < 0) throw new Error('项目清单包含无效记录。');
    const content = files[entry.path];
    if (!content || content.length !== entry.byteLength || await hashBytes(content) !== entry.hash) throw new Error(`项目文件完整性校验失败：${entry.path}。`);
    expected.add(entry.path);
  }
  if (Object.keys(files).some(path => !expected.has(path))) throw new Error('项目中有清单未声明的文件。');
  const value: unknown = JSON.parse(strFromU8(files['project.json']));
  let project: ProjectDocument;
  try { project = migrateProject(value); }
  catch (error) {
    const previews = manifest.entries.filter(entry => entry.path.startsWith('previews/') && entry.mime.startsWith('image/')).map(entry => new Blob([new Uint8Array(files[entry.path]).buffer], { type: entry.mime }));
    throw new ProjectRecoveryError(`项目结构不能安全恢复：${error instanceof Error ? error.message : 'schema error'}。原文件未修改。`, blob, previews);
  }
  if (project.id !== manifest.projectId) throw new Error('项目 ID 与清单不符。');
  const assets: StoredAsset[] = [];
  for (const asset of project.assets) {
    const entry = manifest.entries.find(item => item.assetId === asset.id);
    if (!entry || entry.hash !== asset.hash || entry.byteLength !== asset.byteLength || entry.mime !== asset.mime) throw new Error(`资源清单不一致：${asset.id.slice(0, 12)}。`);
    assets.push({ manifest: clone(asset), blob: new Blob([new Uint8Array(files[entry.path]).buffer], { type: asset.mime }) });
  }
  const available = new Set(assets.map(asset => asset.manifest.id));
  for (const id of collectAssetReferences(project)) if (!available.has(id)) throw new Error(`项目存在悬空资源 ${id.slice(0, 12)}。`);
  return { project, assets, manifest, warnings: ['地图瓦片和地形数据不在项目包中；已保存地图快照可离线查看，重新取景需要相应数据服务。'] };
}
export async function persistImportedPackage(imported: ImportedProject, storage: StorageBundle): Promise<ProjectDocument> {
  // Assets first, verify, then commit document: no document can point to unwritten blobs.
  for (const asset of imported.assets) {
    const saved = await storage.assets.putAsset(asset.blob, asset.manifest);
    if (saved.hash !== asset.manifest.hash) throw new Error('恢复资源完整性校验失败。');
  }
  const restored = clone(imported.project), existing = await storage.projects.loadRawProject(restored.id);
  // Opening a portable file is deliberate recovery, not an asynchronous stale document write.
  // Keep both versions when the device already has different work with the same identity.
  let identical = false;
  if (existing !== undefined) {
    try { identical = validateProject(existing).valid && JSON.stringify(existing) === JSON.stringify(restored); }
    catch { /* A damaged local row still owns its identity and must remain recoverable. */ }
  }
  if (existing !== undefined && !identical) {
    const now = new Date().toISOString();
    restored.id = newId('project');
    restored.name = `${restored.name} · 恢复副本`;
    restored.createdAt = now;
    restored.updatedAt = now;
  }
  await storage.projects.saveProject(restored);
  return restored;
}
export function exportProjectJSON(project: ProjectDocument): Blob { assertValidProject(project); return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); }
export async function importProjectJSON(blob: Blob): Promise<ProjectDocument> { if (blob.size > PACKAGE_LIMITS.jsonBytes) throw new Error('项目 JSON 太大。'); return migrateProject(JSON.parse(await blob.text())); }

/** Latest-only debouncing; flush before navigation/package creation. Rejections remain visible. */
export class DebouncedProjectSaver {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: ProjectDocument;
  private chain: Promise<void> = Promise.resolve();
  constructor(private store: ProjectStore, private onState: (state: 'saving' | 'saved' | 'error', revision: number, error?: Error) => void, private delayMs = 500) {}
  schedule(project: ProjectDocument): void {
    this.pending = clone(project); this.onState('saving', project.revision);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => { /* onState exposes the failure. */ }); }, this.delayMs);
  }
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const snapshot = this.pending; if (!snapshot) return this.chain;
    this.pending = undefined;
    const run = async () => {
      try { await this.store.saveProject(snapshot); this.onState('saved', snapshot.revision); }
      catch (error) { this.onState('error', snapshot.revision, error instanceof Error ? error : new Error(String(error))); throw error; }
    };
    this.chain = this.chain.then(run, run); return this.chain;
  }
  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
}
