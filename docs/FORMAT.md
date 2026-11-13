# Project format and local recovery

Travel Studio stores schema **1** documents and content-addressed assets. A project is data, not a serialized Konva/MapLibre object tree. The domain validator is the only acceptance gate for a document. IDs, coordinates, visit order, scene references and asset SHA-256 hashes are checked before a project becomes editable.

## Local storage

`createBrowserStore()` opens the IndexedDB database `travel-studio-v1`. Four object stores contain assets (`Blob` + manifest), committed projects, the last ten committed revisions per project, and workspace preferences. The map browsing camera and editor viewport are stored separately from artwork cameras and frozen journey inputs.

Assets are written and verified **before** documents that reference them. A quota or transaction failure rejects the save; the UI must keep its unsaved state. `DebouncedProjectSaver` reports saving/saved/error with the corresponding revision and can be flushed before navigation. It never reports success after a rejected write. Earlier revisions cannot overwrite a newer saved revision.

Browser data removal can erase IndexedDB. Download a portable project for durable backup. Changing localhost port changes the browser origin and therefore opens different storage; the supplied start command uses a stable origin.

## `.travelstudio` container

The extension is a ZIP with these entries:

| Path | Content |
| --- | --- |
| `manifest.json` | Format/container version, application version, project identity, full/artwork mode and SHA-256/size/MIME of every other entry |
| `project.json` | Validated `ProjectDocument`, library, artworks, resolved journey snapshots, scene nodes, visibility, constraints, cameras and asset manifests |
| `assets/<sha256>` | Original photos, proxies, thumbnails, derivatives and saved previews/map frames actually referenced by this project |
| `styles/*.json` | Embedded style recipes, or fixed built-in identity and version |
| `templates/*.json` | Embedded template recipes, or fixed built-in identity and version |
| `previews/*.image` | Saved artwork previews when present; MIME is recorded in the manifest |
| `licenses/attributions.json` | Source/license records retained with the project |
| `licenses/README.txt` | Ownership and offline-data boundary |

Binary asset identity is its full SHA-256, independently of filename. Equal bytes are stored once. A derivative may name `sourceAssetId`; closure retains its source recursively. Hiding an object does not release its assets. Asset removal checks saved projects/recovery revisions; the caller also passes roots for in-memory undo history and running tasks.

### Full and current-artwork packages

Full packages contain every retained library photo and all artworks. Orphan caches are omitted. Current-artwork packages retain one artwork, its exact frozen originals/derivatives, selected photos, visit and place snapshots, source attribution and recursively referenced resources. Unrelated artworks, photos and locations are removed from both binary files and JSON. If a source photo was deleted or changed after creating an artwork, the package reconstructs the necessary library identity from its frozen binding; it does not substitute the newer original.

A project package can contain original photos and precise location data. It is different from an exported PNG/JPEG/WebP image, which is freshly encoded without copying source EXIF. Information the user places visibly on the artwork remains visible in an exported image.

## Import and recovery

The ZIP central directory is inspected **before** inflation. Limits are 256 MiB compressed, 512 MiB uncompressed, 128 MiB per binary entry, 10 MiB per JSON entry, and 1,500 entries. Encrypted archives, ZIP64, unsafe/duplicate paths and unreasonable inflation ratios are rejected. Every decoded entry must match the declared size and SHA-256. Undeclared files and dangling asset references are rejected.

Container version 1 and document schema 1 are supported. A schema 0 single-artwork fixture can migrate to `artworks[0]` on a copied document. Future/incompatible documents produce `ProjectRecoveryError`, preserving the original file and available preview blobs; they are not silently rewritten. Missing plugins must preserve embedded recipe data and the old preview. Opening such a project does not authorize executing project-provided code.

If the device already contains different work with the imported project ID, import creates an independent project named with `· 恢复副本`. The existing project and its saved recovery revisions remain intact. Identical imports keep their original identity. This makes deliberately opening an older backup possible without disabling the stale-write protection used by automatic saves.

On startup, `recoverLatestProject` checks the latest document, referenced asset presence and installed design compatibility. If necessary it tries saved revisions from newest to oldest, saving a valid history as a new `· 自动恢复` project. The incompatible source remains available in the project list. If no valid revision exists, an empty workbench opens with a recovery notice; the local entries are not deleted.

The project dialog presents future-version files in read-only recovery, with saved PNG/JPEG/WebP previews and an unchanged download of the original package. A damaged local entry supports preview and original document JSON download; that JSON does not contain photo binary data, which remains in IndexedDB. Recovery previews cannot be edited or exported as if a new complete document had been restored.

Restoration preserves structure and saved appearance. Online tiles and DEM are not bundled. A saved map frame can be viewed offline, but new map framing or complete offline map editing requires legitimately available map data. Merely retaining a tile URL cannot guarantee that the same map-data version remains online.

## Public storage API

`AssetStore`: `putAsset`, `getAsset`, `getManifest`, `listAssets`, `deleteAsset`.

`ProjectStore`: `saveProject`, `loadProject`, `latestProject`, `listProjects`, `listRevisions`, `recoverRevision`, `saveWorkspace`, `loadWorkspace`.

`exportProjectPackage(project, assetStore, { artworkId? })` produces a complete ZIP. `importProjectPackage(blob)` validates it without mutating storage. `persistImportedPackage(result, storage)` writes assets before committing and returns the saved project (which may have a new recovery identity). `exportProjectJSON` is for inspectable metadata/debugging only; JSON alone is not a portable photo backup.

See `tests/storage.test.ts` for round trips into empty storage, isolated slim packages, changed/deleted source-photo recovery, corruption rejection, unsafe paths and persisted Blob recovery.
