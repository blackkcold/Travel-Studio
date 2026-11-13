import { clone, type ArtworkDocument, type DocumentStore } from '../domain';
import type { AssetStore } from '../storage';
import type { MapFrame } from '../map';
import { mapSnapshotInputHash, snapshotMapFrame } from '../export';
import { renderArtwork, type CompositionResources } from '../composition';

/** A cache write must never commit the result of an older editing operation. */
export function artworkPreviewKey(art: ArtworkDocument): string {
  const { previewAssetId: _preview, mapSnapshotAssetId: _mapId, mapSnapshot: _map, updatedAt: _updated, ...content } = art;
  return JSON.stringify(content);
}
function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法保存作品预览。')), 'image/png'));
}
export function createSnapshotPersistence(doc: DocumentStore, assets: AssetStore) {
  const previewKeys = new Map<string, {key:string;assetId:string}>();
  return {
    async onMapFrame(art: ArtworkDocument, frame: MapFrame) {
      if (!frame.receipt.snapshotBundleAllowed) return;
      const inputHash = mapSnapshotInputHash(art), projectId = doc.document.id;
      const cachedId=doc.document.artworks.find(item=>item.id===art.id)?.mapSnapshotAssetId;
      const cachedExists=!!cachedId&&!!(await assets.getManifest(cachedId));
      const eligible = () => {
        const current = doc.document.artworks.find(item => item.id === art.id);
        if (doc.document.id !== projectId || !current || mapSnapshotInputHash(current) !== inputHash) return undefined;
        if (cachedExists && current.mapSnapshotAssetId===cachedId && current.mapSnapshot?.inputHash === inputHash && current.mapSnapshot.width >= frame.canvas.width && current.mapSnapshot.height >= frame.canvas.height) return undefined;
        return current;
      };
      if (!eligible()) return;
      const metadata = snapshotMapFrame(art, frame);
      const blob = await png(frame.canvas);
      const asset = await assets.putAsset(blob, { kind: 'map-snapshot', name: '保存的作品地图', width: metadata.width, height: metadata.height, license: metadata.printAttribution.join(' · ') });
      if (!eligible()) return;
      doc.transact('保存匹配的地图快照', project => {
        const current = project.artworks.find(item => item.id === art.id)!;
        if (!project.assets.some(item => item.id === asset.id)) project.assets.push(asset);
        current.mapSnapshotAssetId = asset.id;
        current.mapSnapshot = clone(metadata);
      }, undefined, { recordHistory: false });
    },
    async savePreview(art: ArtworkDocument, resources: CompositionResources) {
      const key = artworkPreviewKey(art), projectId = doc.document.id;
      const eligible = () => doc.document.id === projectId && doc.document.artworks.some(item => item.id === art.id && artworkPreviewKey(item) === key);
      const cached=previewKeys.get(art.id),current=doc.document.artworks.find(item=>item.id===art.id);
      if(!eligible())return;
      if(cached?.key===key&&current?.previewAssetId===cached.assetId&&doc.document.assets.some(asset=>asset.id===cached.assetId)&&await assets.getManifest(cached.assetId))return;
      const canvas = document.createElement('canvas'), scale = Math.min(1, 1000 / Math.max(art.artboard.width + 72, art.artboard.height + 72));
      canvas.width = Math.round((art.artboard.width + 72) * scale);
      canvas.height = Math.round((art.artboard.height + 72) * scale);
      try {
        const context = canvas.getContext('2d');
        if (!context) return;
        context.scale(scale, scale);
        renderArtwork(context, art, resources, { intent: 'presentation', transparent: true, margin: 36 });
        const blob = await png(canvas);
        const asset = await assets.putAsset(blob, { kind: 'preview', name: '作品完整预览', width: canvas.width, height: canvas.height });
        if (!eligible()) return;
        doc.transact('保存匹配的作品预览', project => {
          if (!project.assets.some(item => item.id === asset.id)) project.assets.push(asset);
          project.artworks.find(item => item.id === art.id)!.previewAssetId = asset.id;
        }, undefined, { recordHistory: false });
        previewKeys.set(art.id, {key,assetId:asset.id});
      } finally { canvas.width = 0; canvas.height = 0; }
    },
  };
}
