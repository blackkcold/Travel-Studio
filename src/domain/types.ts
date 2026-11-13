/** Serializable public contracts. Runtime handles and credentials never belong here. */
export type Coordinate = [longitude: number, latitude: number];
export type TimePrecision = 'instant' | 'local' | 'date' | 'unknown';
export interface TimeEvidence {
  value?: string;
  precision: TimePrecision;
  source: 'exif' | 'user' | 'provider' | 'unknown';
  raw?: string;
  offset?: string;
  timeZone?: string;
  subsecond?: string;
  utc?: string;
}
export type LocationPrecision = 'exact' | 'street' | 'city' | 'region' | 'unknown';
export interface PlaceRecord {
  id: string;
  name: string;
  coordinate?: Coordinate;
  originalCoordinate?: Coordinate;
  crs: string;
  source: string;
  precision: LocationPrecision;
  status: 'confirmed' | 'candidate' | 'missing';
  sourceId?: string;
  originalInput?: string;
  resolvedAt?: string;
  history?: Array<{ at: string; coordinate?: Coordinate; name: string; source: string }>;
}
export interface PhotoRecord {
  id: string;
  assetId: string;
  thumbnailAssetId?: string;
  proxyAssetId?: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  time: TimeEvidence;
  placeId?: string;
  visitId?: string;
  createdAt: string;
  exif?: { DateTimeOriginal?: string; SubSecTimeOriginal?: string; OffsetTimeOriginal?: string; Orientation?: number; GPSLatitude?: number; GPSLongitude?: number };
}
export interface VisitRecord {
  id: string;
  placeId?: string;
  photoIds: string[];
  time: TimeEvidence;
  stableIndex: number;
  label?: string;
  createdAt: string;
}
export interface AssetManifest {
  id: string;
  hash: string;
  mime: string;
  byteLength: number;
  kind: 'original' | 'proxy' | 'thumbnail' | 'derived' | 'map-snapshot' | 'texture' | 'font' | 'preview';
  name?: string;
  width?: number;
  height?: number;
  sourceAssetId?: string;
  license?: string;
  attributionId?: string;
}
export interface AttributionRecord { id: string; label: string; url?: string; license?: string; required: boolean; source?: string }
export interface TravelLibrary { photos: PhotoRecord[]; places: PlaceRecord[]; visits: VisitRecord[] }
export interface SelectionRef { kind: 'photo' | 'explicit-visit'; id: string }
export type SelectionPredicate =
  | { type: 'date'; anchor: string; daysBefore: number; daysAfter: number }
  | { type: 'radius'; center: Coordinate; radiusKm: number }
  | { type: 'bounds'; west: number; south: number; east: number; north: number };
export interface SelectionRecipe { scopeId: string; predicates: SelectionPredicate[]; combine: 'all' | 'any'; manualInclude: SelectionRef[]; manualExclude: SelectionRef[] }
export interface VisitOrder { mode: 'time' | 'manual'; timeBasis: 'instant' | 'recorded-local'; orderedVisitIds: string[]; unresolvedVisitIds: string[] }
export interface FrozenVisit { id: string; placeId?: string; name: string; coordinate?: Coordinate; precision: LocationPrecision; status: PlaceRecord['status']; photoIds: string[]; time: TimeEvidence; stableIndex: number }
export interface RouteSegment { id: string; fromVisitId: string; toVisitId: string; coordinates: Coordinate[] }
export interface RouteSpec { kind: 'itinerary' | 'geodesic' | 'recorded' | 'routed'; segments: RouteSegment[]; gaps: Array<{ visitId: string; reason: 'missing-coordinate' | 'unconfirmed-location' | 'unresolved-time' }>; orderedVisitIds: string[]; label: string }
export interface JourneySnapshot {
  sourceRevision: number;
  selectionRevision: number;
  recipe: SelectionRecipe;
  selectedPhotoIds: string[];
  explicitVisitIds: string[];
  selectedVisitIds: string[];
  order: VisitOrder;
  resolvedVisits: FrozenVisit[];
  route: RouteSpec;
}
export interface SelectionResult {
  selectedPhotoIds: string[];
  explicitVisitIds: string[];
  selectedVisitIds: string[];
  reasons: Record<string, 'automatic' | 'manual' | 'excluded' | 'not-selected'>;
  counts: { photos: number; visits: number; places: number; unresolved: number; automatic: number; included: number; excluded: number };
}
export interface CameraSpec {
  center: Coordinate;
  zoom: number;
  bearing: number;
  pitch: number;
  terrain: boolean;
  exaggeration: number;
  terrainProvider: 'mapterhorn' | 'aws';
  projection: 'mercator' | 'globe';
  elevation?: number;
  roll?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
}
export interface Transform { x: number; y: number; width: number; height: number; rotation: number }
export interface NodeConstraint { position: 'auto' | 'pinned'; size: 'auto' | 'fixed'; crop: 'auto' | 'fixed' }
export interface CropSpec { x: number; y: number; zoom: number; rotation: number }
export interface PhotoEdit { mode: 'original' | 'local' | 'ai'; exposure: number; contrast: number; saturation: number; intensity: number; crop: CropSpec; derivedAssetId?: string; algorithmVersion?: string }
export type SceneNodeKind = 'background' | 'paper' | 'map' | 'photo' | 'text' | 'annotation' | 'route' | 'decoration' | 'group' | 'attribution';
export interface SceneNode {
  id: string;
  kind: SceneNodeKind;
  role: string;
  transform: Transform;
  visible: boolean;
  zIndex: number;
  constraint: NodeConstraint;
  layoutParticipation: 'flow' | 'overlay' | 'reserved';
  parentId?: string;
  assetId?: string;
  photoId?: string;
  visitId?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  opacity?: number;
  crop?: CropSpec;
  photoEdit?: PhotoEdit;
  shape?: 'rectangle' | 'torn' | 'ticket' | 'circle';
  seed?: number;
  locked?: boolean;
  userOverrides?: Record<string, string | number | boolean>;
}
export interface ArtboardSpec { width: number; height: number; background: string; physicalWidthMm: number; physicalHeightMm: number; bleedMm: number; safeMarginMm: number }
export interface LayoutState { mode: 'auto' | 'assisted' | 'free'; layoutRevision: number; solverVersion: string; mapRatio: number; gap: number; photoCapacity: number; density: number }
export interface LayoutConflict { nodeId?: string; code: string; message: string }
export interface LayoutProposal { inputHash: string; selectionRevision: number; layoutRevision: number; solverVersion: string; nodes: SceneNode[]; conflicts: LayoutConflict[] }
export interface ElementVisibility {
  map: boolean; photos: boolean; route: boolean; arrows: boolean; numbers: boolean; names: boolean; legend: boolean; title: boolean; date: boolean; coordinates: boolean; message: boolean; texture: boolean; border: boolean; stamp: boolean; compass: boolean; holes: boolean; string: boolean; shadow: boolean;
}
export interface FrozenPhotoBinding { photoId: string; assetId: string; thumbnailAssetId?: string; proxyAssetId?: string; derivedAssetId?: string; name: string; width: number; height: number }
export interface ArtworkMetadata { title: string; date: string; message: string; weather?: string; userOverrides?: string[] }
export interface ArtworkDocument {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  templateId: string;
  templateVersion: string;
  styleId: string;
  styleVersion: string;
  paletteId: string;
  artboard: ArtboardSpec;
  nodes: SceneNode[];
  journey: JourneySnapshot;
  frozenPhotoBindings: FrozenPhotoBinding[];
  canonicalCamera: CameraSpec;
  metadata: ArtworkMetadata;
  layout: LayoutState;
  visibility: ElementVisibility;
  seed: number;
  previewAssetId?: string;
  mapSnapshotAssetId?: string;
  attributionIds: string[];
  embeddedStyle?: Record<string, unknown>;
  embeddedTemplate?: Record<string, unknown>;
}
export interface ProjectDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  library: TravelLibrary;
  artworks: ArtworkDocument[];
  assets: AssetManifest[];
  provenance: AttributionRecord[];
}
export interface WorkspaceState { projectId: string; activeArtworkId?: string; mode: 'atlas' | 'artwork'; atlasCamera: CameraSpec; canvasViewport: { zoom: number; x: number; y: number }; reducedEffects: 'standard' | 'light' | 'opaque'; activePanel?: string }
export interface DomainIssue { path: string; message: string }
export interface ValidationResult { valid: boolean; issues: DomainIssue[] }
export interface TaskTarget { projectId: string; artworkId?: string; inputHash: string; generation: number; selectionRevision?: number; layoutRevision?: number; targetNodeId?: string }
export interface TaskContext extends TaskTarget { taskId: string; signal: AbortSignal; onStage?: (stage: string) => void }
