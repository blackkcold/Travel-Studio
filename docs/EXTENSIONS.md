# Declarative extensions and task contracts

Travel Studio SDK 1 supports **data-only** style, template and map-source manifests. It does not hot-load arbitrary JavaScript, Web Workers, SVG scripts or untrusted executable plugins. Worker execution would not by itself create a security sandbox.

## Manifest

```json
{
  "id": "example.sea-glass",
  "version": "1.0.0",
  "sdkRange": "1.x",
  "kind": "style",
  "name": "Sea glass",
  "capabilities": ["palette", "map-semantic-colors"],
  "permissions": [],
  "licenses": [{ "name": "Original palette", "license": "MIT" }],
  "recipe": {
    "palette": {
      "paper": "#f2f5ed", "ink": "#234842", "water": "#a7d2cc",
      "land": "#e3e9d8", "road": "#fff9e8", "accent": "#dc815d"
    }
  }
}
```

All kinds require a stable ID, exact semantic version, supported SDK, capabilities, permissions, license records and a recipe. The parser accepts at most 1 MB of JSON, has depth/array limits, rejects prototype keys and executable markup, and validates each kind. Replacing different content under the same ID/version is rejected; increase the version instead.

| Kind | Required recipe | Permission |
| --- | --- | --- |
| `style` | Six validated hex colors: paper, ink, water, land, road, accent | None; recipe cannot fetch assets |
| `template` | Normalized `slots` with kind/x/y/width/height, all inside the artboard | None |
| `map-provider` | Public HTTPS `tileJSON`/`glyphs`, complete `layers`/`fields` schema mapping, required/print attribution arrays and executable provider policy | `network-map-data` |

Three distributable examples are in `examples/extensions/`: an original sea-glass palette, a wide-journal composition and an OpenFreeMap mapping. The map manifest describes actual vector schema and source attribution, not only a changed URL. Installing a manifest does not waive a provider's policy or make an unavailable service reachable.

## Lifecycle and compatibility

`ExtensionRegistry` implements register → validate → activate → deactivate → dispose. A document can retain an exact extension version using `retain(id, version, artworkId)`. Disposal fails while works still reference it. Embed the applied recipe/version and resource references in the artwork; missing registry entries do not justify discarding nodes or original assets. Deactivation affects availability for new use, not saved document facts.

The application bootstrap connects validated recipes to design/map adapters. Pure UI components do not build network URLs. Templates and styles cannot mutate the project directly; application commands apply their resulting proposals through the document transaction boundary. A failed layout keeps the previous valid geometry and reports conflicts.

## Runtime tasks

`TaskScheduler` defaults to one heavy task at a time. Jobs receive an `AbortSignal`, task/project/artwork identity, input hash, generation, optional target-node identity and selection/layout revisions. Replacing a task key cancels the previous request. Its late result is never delivered as the new task result. Job callbacks report real stages; the scheduler does not invent percentages.

Tasks produce results. They do not commit documents. Before applying a result the application still checks the intended project/artwork/node and expected document revision. Cancellation is cooperative; decoders and providers must check the signal before allocating, between phases, and before returning. A timeout aborts the same signal. Decoded bitmaps, object URLs, temporary canvas buffers and MapLibre instances belong to the module that created them and must be disposed in `finally` blocks.

`ResourceLeases` keeps current documents, undo/redo snapshots and running-task resources alive. A task acquires asset IDs and releases them exactly once after completion/cancellation. Cleanup may remove only IDs outside every root and lease. Diagnostic messages redact credentials, URLs and precise coordinates; photo content is never a diagnostic payload.

## Photo pipeline

JPEG, PNG and WebP are detected by content, not extension. A batch has at most 50 files; each photo is limited to 48 MP/100 MiB and processed serially. Animated images and HEIC/HEIF/AVIF are rejected with conversion instructions. EXIF is parsed locally with `reviveValues:false`, preserving camera wall time and its unknown timezone. Only an explicit valid offset produces UTC. Browsers decode EXIF orientation once; the pipeline avoids applying a second manual rotation.

The original blob is unchanged. Orientation-correct thumbnails (256px long edge) and proxies (1600px) are separately hashed assets. Exposure is in stops (-2..2); contrast and saturation are multipliers (default 1); local-style intensity is 0..1. `processPhoto` returns a new sRGB canvas. Its six local recipes are rule-based color/edge treatments, not generative repainting. Slot crop/rotation belongs to Composition and is not baked twice into the processor output. An AI result, when explicitly authorized through the provider adapter, is another derivative asset.

The browser color pipeline targets sRGB; it is not a professional ICC/CMYK proofing implementation. The final exported image must still be decoded and checked by the export module. See `tests/photo.test.ts` and `tests/runtime.test.ts` for content sniffing, memory limits, time evidence, stale-task protection, resource leases and extension rejection contracts.
