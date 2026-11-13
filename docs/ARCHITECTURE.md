# Architecture and contracts

Travel Studio is one local-first application. The twelve modules below are ownership boundaries, not twelve processes. The accepted source is **Travel Studio Complete Plan v3.0 (13 November 2026)**. Its component counts are responsibility IDs; file counts and rendered instances are different quantities.

## Module map

| ID | Public boundary | Owner and responsibility | Runtime dependencies |
| --- | --- | --- | --- |
| M01 | `src/app`, `src/ui/index.ts` | Workspace, accessible controls, commands, interaction state; `app/bootstrap.ts` assembles concrete services | Injected ports and pure public APIs |
| M02 | `src/domain/index.ts` | Serializable contracts, validation, migration, immutable document and transaction history | None |
| M03 | `src/journey/index.ts` | Atomic selection, visit order, frozen journey and route geometry | M02, M04 |
| M04 | `src/geo/index.ts` | WGS84 validation, geodesic distance, minimal longitude bounds and dateline splitting | None; M02 types only |
| M05 | `src/map/index.ts` | MapLibre instances, cameras, terrain, building data, route rendering, projection and frame receipt | M04, M10 |
| M06 | `src/design-packages/index.ts` | Six style recipes, two palettes per recipe, six template families / twelve variants | None |
| M07 | `src/photo/index.ts` | File signature and pixel limits, EXIF, nondestructive local processing, proxy resources | M11 public hash/asset ports, M12 cancellation |
| M08 | `src/composition/index.ts` | Deterministic layout proposals, scene geometry, shared editor/export drawing | M06 |
| M09 | `src/export/index.ts` | Frozen export, resource barrier, exact pixels, density metadata and decoded-file verification | M02, M06, M08; injected map/photo/asset ports |
| M10 | `src/providers/index.ts` | Photon, map-provider policies and optional authorized AI | Pure provider implementations; M02 types |
| M11 | `src/storage/index.ts` | IndexedDB, content-addressed assets, recovery revisions, full/lean project packages | M02 |
| M12 | `src/runtime/index.ts`, `src/plugins/index.ts` | Task cancellation/generations, asset leases, bounded diagnostics, declarative extension lifecycle | M02 types |

`src/main.tsx` starts the application. `src/app/bootstrap.ts` is the composition root: it instantiates the local store, providers, map adapter, photo processor and scheduler, then passes services through application context. Ordinary UI components must not construct those implementations or open IndexedDB directly.

Cross-module imports use the listed public boundary. Within one module, private relative imports are allowed. UI and runtime/plugin directory pairs each count as one responsibility module. Type-only dependencies do not create runtime DAG edges, but still use public exports.

## One persistent document

`DocumentStore` is the only write entrance for the current `ProjectDocument`.

- `transact(label, mutation, expectedRevision?, options?)` clones the current revision, applies a draft mutation, validates it and publishes one immutable revision. Explicit `{ recordHistory: false }` cache writes preserve user undo/redo while still advancing and validating the document revision.
- Failed mutations, failed validation and stale expected revisions leave both the document and its history unchanged.
- `undo()` and `redo()` restore content with **monotonically increasing** revisions. A new command after undo discards the abandoned redo branch.
- `replace()` is an explicit project-open lifecycle event, not an asynchronous result callback.
- `retentionDocuments()` exposes current/undo/redo roots so asset cleanup cannot delete resources still needed by history.
- IndexedDB is a recoverable copy, not another live source of truth. A failed save must not advance the displayed saved revision.

A `PlaceRecord` describes a location. A `VisitRecord` describes one visit to a location. A `PhotoRecord` describes one photograph, whose original, proxy and thumbnail bytes are separate assets. **A → B → A remains three visits and two places.** Spatial clustering may combine display markers but cannot rewrite these identities.

## Selection and time evidence

A recipe combines fixed date/radius/bounds predicates with typed manual includes and excludes. Its final set is `(automatic ∪ include) − exclude`, intersected with valid current records. A radius always uses its explicit center: finding B near A never extends the radius to C near B. View filtering only controls visible rows and must not change the recipe.

A group checkbox expands to atomic photograph references. An explicit no-photo visit is a separate reference type. Source photo count, visit count and distinct confirmed-place count are reported separately.

`TimeEvidence` preserves original values, offsets and EXIF subseconds. There are four precisions:

| Precision | Interpretation | Time sorting |
| --- | --- | --- |
| `instant` | An explicit offset supplies a checkable absolute instant | Sort by instant, or visibly use recorded-local order |
| `local` | Calendar time without an inferred zone | Only recorded-local order; unresolved in absolute-time mode |
| `date` | A date without intra-day order | Unresolved until a user assigns order/time |
| `unknown` | No usable temporal evidence | Unresolved; no upload-time or midnight substitution |

Known equal timestamps use the persisted stable index and ID as a tie-break. Deselecting a visit's first photograph does not alter the visit's time evidence. Manual ordering changes only `VisitOrder`, never EXIF. Route gaps at missing/unconfirmed coordinates remain visible; no line silently skips the gap. Dateline crossings split at ±180 and fit using the minimal longitude span.

## Frozen artwork and independent cameras

An artwork carries a `JourneySnapshot` and `FrozenPhotoBinding[]`. These preserve the selected members, complete resolved visit facts, order, route segments and original/derived resource references. Editing the source library or atlas filters does not mutate an old artwork. `refreshArtworkJourney()` constructs a replacement only when explicitly requested; the application commits it through one transaction.

Four coordinate spaces remain separate:

| Space | Stored authority | Conversion owner |
| --- | --- | --- |
| Geographic coordinates | WGS84 tuples, original CRS/evidence, route visits | M04 |
| Map viewport | Canonical map camera and map-frame logical dimensions | M05 |
| Artwork logical space | Node transforms, crops, paper contour, typography | M08 |
| Export pixels | Requested size/PPI and uniform rendering scale | M09 |

`WorkspaceState.atlasCamera` is browser navigation. `ArtworkDocument.canonicalCamera` is the artwork's chosen map framing. `canvasViewport` only controls editor magnification. Exporting more pixels does not modify any of these values. Camera elevation/roll can be retained for terrain-relative framing.

## Scene and layout

The ten serializable scene kinds are `background`, `paper`, `map`, `photo`, `text`, `annotation`, `route`, `decoration`, `group` and `attribution`. They contain plain JSON; Canvas, WebGL contexts, DOM, promises, credentials and Blob URLs never enter a project.

`solveLayout(artwork)` returns a proposal with an input hash, selection/layout revision, solver version, full nodes and explicit conflicts. It neither mutates the document nor shares mutable crop/constraint objects with it. `applyLayoutProposal()` rejects stale inputs and conflicts. The application still commits its returned draft via `DocumentStore`.

- **Auto:** regenerate permitted flow geometry.
- **Assisted:** retain independently pinned position, fixed size and fixed crop; solve remaining freedoms.
- **Free:** retain explicit transforms; do not surprise the user with automatic moves.
- `userOverrides.visible` retains individual visibility intent independently of group switches. Hidden photographs keep their identity, edits, crop and resources.
- Capacity-excluded photos remain explicit hidden nodes and frozen bindings; the UI must show unused counts.
- Pinned objects are preserved. Unlocked content tries deterministic nearby positions; an unsatisfied collision returns a conflict instead of unlocking, shrinking text without consent, or applying an invalid draft.
- Timeline templates use stable `film-slot-*` frame IDs: changing the visit order moves photograph bindings through slots while pinned slot geometry stays fixed. Photo identity remains `node.photoId`, distinct from the physical frame ID.
- The map frame owns placement. Route and annotation scene transforms track that frame exactly; M05 draws the route once, while M08 draws projected numbers and photo annotations.
- Attribution is a protected output region. Ordinary content may be hidden; necessary source attribution follows the resources actually in use.

The shared renderer is used by Konva previews and the export compositor. A layout pass estimates text conservatively; actual loaded fonts must also be measured at export. Geometry and stable paper seeds remain in logical units.

### Portable design recipes

M06 installs pure-data style/template manifests with immutable `id@version` contents. Installed newer versions do not replace the exact version used by a saved work. `getDesignManifest()` creates a portable snapshot for both extensions and built-ins; `resolveStyle()` and `resolveTemplate()` read that artwork snapshot before consulting the installation registry. Built-in snapshots contain every palette color and drawing parameter, or the declared `builtin-v1` layout recipe. Saved explicit scene nodes remain the rendering geometry.

Extension templates use normalized full-artboard slots with exactly one map and one protected attribution area. Slots must have positive finite dimensions, unique IDs and no content/attribution overlap. The solver honors those map/photo/text coordinates, retains unused photos, reports capacity conflicts, and fits additional visible metadata only in available space. It never silently discards metadata to make a recipe fit. The original six styles, two palettes each, and twelve template variants remain independently tested.

## Asynchrony, export and retention

Every asynchronous job has `projectId`, `artworkId`, input hash, generation and relevant revision. A late result may remain as a derived resource, but cannot overwrite a newer node or selection. The scheduler is serial for expensive work by default, has cancellation/timeouts, and emits real stages rather than invented percentages.

Exports freeze the target artwork and revision. Required photos, map tiles, glyphs, fonts, DEM and output permissions are checked before encoding; `idle` alone is not a resource-success guarantee. A dedicated map render uses the frozen logical viewport with increased backing pixels. Unsupported GPU dimensions fail explicitly rather than enlarging a small screenshot. The encoded file is decoded to verify format and dimensions, and the receipt records revisions and resource evidence.

A saved map has both `mapSnapshotAssetId` bytes and typed `mapSnapshot` metadata: camera, logical viewport, actual pixels, projected annotations, provider/terrain attribution, print attribution and resource receipt. Its fingerprint includes the frozen source adapter, geography, view and style. A changed input or insufficient snapshot pixels causes an explicit failure; fallback is never silently substituted. `snapshotMapFrame()` checks snapshot bundling policy. A declared `mapSource` is frozen on the artwork and validated by the map adapter before network use.

Asset cleanup observes library, frozen artworks, hidden nodes, derivatives, history/recovery copies and active task leases. A full project package includes the retained library and works. A lean package reconstructs only the chosen work and its reference closure. Snapshot restoration is distinct from offline map editing: bundled previews do not imply bundled street/terrain data.

## Enforced rules

| Rule | Enforcement |
| --- | --- |
| R01 single document write entrance | Immutable `DocumentStore`, revision/transaction tests |
| R02 directed dependencies | AST import-boundary and runtime-cycle checker |
| R03 injected implementations | Concrete storage/provider/photo/runtime imports restricted to bootstrap |
| R04 one selection result | Journey snapshot consumed by list/map/composition |
| R05 visit identity | A-B-A, photo-subset and route-order tests |
| R06 pure layout proposals | Deep-copy, deterministic proposal, lock/conflict and stale-application tests |
| R07 shared visual system | Shared UI primitives and corner geometry; browser visual checks |
| R08 one drawing owner | Map route layer versus Composition annotations; shared transformed map frame |
| R09 resource ownership | Reference closure, saved revisions and runtime lease tests |
| R10 asynchronous targeting | Task generation, cancellation and revision checks |
| R11 extension permission boundaries | Declarative manifests; no arbitrary project scripts or network permissions |
| R12 version/capability contracts | Schema/manifest validation and preserved frozen data |
| R13 visibility preserves facts | Hidden/group/restore and preserved crop tests |
| R14 required attribution | Reserved layout region, collision gate, output attribution |
| R15 stable responsibility counts | AST-backed 44-UI / 10-scene inventory, module catalog and six-family/twelve-variant/six-style assertions |
| R16 executable gates | `npm run check`, `npm test`, browser and real-provider smoke evidence |

## Verification commands

```sh
npm run check
node scripts/check-inventory.mjs
npm test
npm run test:e2e
npm run test:providers
```

Core tests include immutable/stale/undo transactions, malicious imported values, frozen reference closure, exact date and time-zone handling, A-B-A ordering, anchored predicates, dateline geometry, all twelve variants at several photo counts and all 36 family/style representatives. These are structural and algorithmic checks; they do not certify visual aesthetics or public-network availability. Browser screenshots, encoded files, provider responses and target-device performance remain separate release evidence in the acceptance record.
