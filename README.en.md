# Travel Studio

Turn local photos and visited places into travel keepsakes you can edit, export and reopen.

[Open web app (after Pages is enabled)](https://blackkcold.github.io/Travel-Studio/) · [中文](README.md) · [Download](https://github.com/blackkcold/Travel-Studio/releases/latest) · [Acceptance evidence](docs/ACCEPTANCE.md)

The GitHub Pages edition runs without Node.js. Maps, editing, export, and browser-local storage remain available; the **optional local AI gateway is not hosted**. Data do not sync with `127.0.0.1`; transfer by exporting/importing `.travelstudio` packages.

## Run

Download and extract `Travel-Studio-VERSION.zip` from Releases. Install **Node.js 24**, run `start.bat` on Windows, `start.command` on macOS, or `sh start.sh` on Linux. Open **http://127.0.0.1:4173**.

From source:

```sh
npm ci
npm run build
npm start
```

Import photos or confirm a place, select and order visits, compose an artwork, then export an image or download an editable `.travelstudio` project. The core workflow needs no account or paid API key.

## Features

- Real vector maps, DEM terrain, building extrusion and separate atlas/artwork cameras.
- Local EXIF import; independent photos, places and visits; repeated visits and explicit unknown time/location evidence.
- Six template families, twelve structures, six art styles with two palettes each.
- Automatic, assisted and free layouts; independent position, size and crop constraints; undo/redo.
- Nondestructive local photo recipes and optional, separately authorized AI processing.
- PNG, JPEG and WebP up to a 4096-pixel long edge; transparent presentation and physical-size print exports.
- IndexedDB recovery, integrity-checked full or artwork-only project packages, permitted map snapshots and versioned declarative extensions.

Online maps/search require network access. Reopening a saved map snapshot does not provide complete offline map editing. Photos stay local unless a user explicitly enables an AI purpose. Project files contain original photos and locations; share exported images when you do not intend to share that source material.

## Documentation

[Deployment and optional AI](docs/DEPLOYMENT.md) · [Project format](docs/FORMAT.md) · [Extension examples](examples/extensions) · [Architecture](docs/ARCHITECTURE.md) · [Component inventory](docs/COMPONENTS.md)

The [acceptance record](docs/ACCEPTANCE.md) distinguishes executed browser tests, synthetic fixtures and unverified physical-device/performance targets.

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

MIT License. See [third-party notices](docs/THIRD_PARTY_NOTICES.md) and [map/service policies](docs/PROVIDERS.md).
