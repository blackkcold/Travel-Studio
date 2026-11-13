import type { ArtworkDocument, ProjectDocument, PhotoEdit, MapSnapshotState } from '../domain';
import { clone } from '../domain';
import { mapRecipe, resolveStyle } from '../design-packages';
import { renderArtwork, textOverflowNodes, isNodeVisible, wrapText, type CompositionResources } from '../composition';
import type { MapRenderSpec, MapFrame, MapSourceAdapter, MapRenderReceipt } from '../map';

export interface RenderServices {
  getAsset(id: string): Promise<Blob | undefined>;
  renderMap(spec: MapRenderSpec): Promise<MapFrame>;
  processPhoto(blob: Blob, edits?: Partial<PhotoEdit>, styleId?: string, size?: number, signal?: AbortSignal): Promise<HTMLCanvasElement>;
  onMapFrame?(art: ArtworkDocument, frame: MapFrame): Promise<void>;
}
export interface ExportSpec {
  format: 'png' | 'jpeg' | 'webp'; longEdge: number; quality: number; transparent: boolean;
  intent: 'presentation' | 'flat-print'; ppi: number; widthMm: number; heightMm: number; bleedMm: number;
  background: string; allowSavedMap?: boolean;
}
export interface ExportReceipt {
  appVersion: string; projectId: string; artworkId: string; projectRevision: number;
  selectionRevision: number; layoutRevision: number; style: string; template: string;
  sourceAssets: string[]; format: string; width: number; height: number; bytes: number;
  intent: string; ppi?: number; bleedMm?: number; resourceBarrier: string[];
  map?: MapFrame['receipt']; mapMode: 'live' | 'saved-snapshot' | 'not-used'; durationMs: number; completedAt: string;
}
export interface PreparedResources {
  resources: CompositionResources; mapFrame?: MapFrame; mapReceipt?: MapRenderReceipt;
  mapMode: ExportReceipt['mapMode']; printAttribution: string[]; dispose(): void;
}
function abort(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('已取消', 'AbortError'); }
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal, milliseconds = 30_000): Promise<T> {
  abort(signal);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('资源准备超时，请重试。')); }, milliseconds);
    const onAbort = () => { cleanup(); reject(signal?.reason instanceof Error ? signal.reason : new DOMException('已取消', 'AbortError')); };
    function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export function exportDimensions(art: ArtworkDocument, spec: ExportSpec) {
  if (!['png', 'jpeg', 'webp'].includes(spec.format) || !['presentation', 'flat-print'].includes(spec.intent)) throw new Error('不支持的输出格式或输出意图。');
  if (!Number.isFinite(spec.quality) || spec.quality < 0 || spec.quality > 1) throw new Error('编码质量必须介于 0 和 1。');
  if (![art.artboard.width, art.artboard.height].every(value => Number.isFinite(value) && value > 0 && value <= 100_000)) throw new Error('作品画板尺寸无效。');
  if (spec.intent === 'flat-print') {
    if (![spec.widthMm, spec.heightMm, spec.ppi, spec.bleedMm].every(Number.isFinite) || spec.widthMm <= 0 || spec.heightMm <= 0 || !Number.isInteger(spec.ppi) || spec.ppi < 72 || spec.ppi > 600 || spec.bleedMm < 0 || spec.bleedMm > 20) throw new Error('印刷尺寸、PPI 或出血不在支持范围。');
    const px = (mm: number) => Math.round(mm / 25.4 * spec.ppi);
    const width = px(spec.widthMm + spec.bleedMm * 2), height = px(spec.heightMm + spec.bleedMm * 2);
    const trimWidth = px(spec.widthMm), trimHeight = px(spec.heightMm);
    if (Math.abs(spec.widthMm / spec.heightMm - art.artboard.width / art.artboard.height) > .012) throw new Error('印刷比例与作品不同，请先调整画布比例或使用匹配的物理尺寸。');
    if (Math.max(width, height) > 4096 || Math.min(trimWidth, trimHeight) < 1) throw new Error('此印刷尺寸超过已开放的 4096 像素长边，或小于一个像素。请调整尺寸或 PPI。');
    const bleedX = Math.floor((width - trimWidth) / 2), bleedY = Math.floor((height - trimHeight) / 2);
    return { width, height, margin: 0, scale: Math.max(trimWidth / art.artboard.width, trimHeight / art.artboard.height), bleed: bleedX, trimWidth, trimHeight, bleedX, bleedY, bleedRight: width - trimWidth - bleedX, bleedBottom: height - trimHeight - bleedY };
  }
  if (!Number.isInteger(spec.longEdge) || spec.longEdge < 256 || spec.longEdge > 4096) throw new Error('导出长边支持 256–4096 的整数像素。');
  const margin = 36, W = art.artboard.width + margin * 2, H = art.artboard.height + margin * 2, scale = spec.longEdge / Math.max(W, H);
  const width = Math.round(W * scale), height = Math.round(H * scale);
  return { width, height, margin, scale, bleed: 0, trimWidth: width, trimHeight: height, bleedX: 0, bleedY: 0, bleedRight: 0, bleedBottom: 0 };
}
function routeVisible(art: ArtworkDocument): boolean { return art.visibility.route && art.nodes.some(node => node.kind === 'route' && isNodeVisible(node, art)); }
/** Snapshot identity excludes display zoom, artwork position and annotation visibility. */
export function mapSnapshotInputHash(art: ArtworkDocument): string {
  const map = art.nodes.find(node => node.kind === 'map');
  const source = JSON.stringify([art.id, art.canonicalCamera, map?.transform.width, map?.transform.height, art.journey, art.styleId, art.styleVersion, art.paletteId, art.embeddedStyle, art.mapSource, routeVisible(art), art.visibility.arrows]);
  let value = 2166136261; for (let i = 0; i < source.length; i++) value = Math.imul(value ^ source.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16);
}
/** Store this metadata and frame.canvas bytes atomically after checking the current input hash. */
export function snapshotMapFrame(art: ArtworkDocument, frame: MapFrame): MapSnapshotState {
  if (!frame.receipt.snapshotBundleAllowed) throw new Error('当前地图来源不允许打包快照；仍可按许可导出作品图片。');
  return clone({ version: 1 as const, inputHash: mapSnapshotInputHash(art), logicalWidth: frame.receipt.logicalWidth, logicalHeight: frame.receipt.logicalHeight, width: frame.canvas.width, height: frame.canvas.height, camera: frame.receipt.camera, annotations: frame.annotations, attribution: frame.receipt.attribution, printAttribution: frame.receipt.printAttribution, snapshotBundleAllowed: true, receipt: frame.receipt as unknown as Record<string, unknown> });
}
export async function prepareResources(art: ArtworkDocument, services: RenderServices, scale = 1, signal?: AbortSignal, onStage?: (stage: string) => void, allowSavedMap = false): Promise<PreparedResources> {
  abort(signal); if (!Number.isFinite(scale) || scale <= 0 || scale > 128) throw new Error('渲染倍率不在支持范围。');
  const resources: CompositionResources = { photos: new Map(), attributions: [] }; let mapFrame: MapFrame | undefined, mapReceipt: MapRenderReceipt | undefined;
  let mapMode: ExportReceipt['mapMode'] = 'not-used', printAttribution: string[] = [];
  const handles: HTMLCanvasElement[] = []; let bitmap: ImageBitmap | undefined, disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; mapFrame?.dispose(); bitmap?.close(); for (const canvas of handles) { canvas.width = 0; canvas.height = 0; } resources.photos.clear(); };
  try {
    onStage?.('准备字体');
    if (document.fonts) {
      await waitFor(document.fonts.ready, signal);
      for (const node of art.nodes.filter(node => isNodeVisible(node, art) && node.kind === 'text' && node.text)) {
        const family = node.fontFamily ?? 'sans-serif';
        await waitFor(document.fonts.load(`${node.role === 'title' ? 500 : 400} ${node.fontSize ?? 16}px ${family}`, node.text), signal);
        if (!document.fonts.check(`${node.role === 'title' ? 500 : 400} ${node.fontSize ?? 16}px ${family}`, node.text)) throw new Error(`字体未准备完成：${family}。请重试或明确选择替代字体。`);
      }
      const annotationText = art.journey.resolvedVisits.map(visit => visit.name).join('');
      if (annotationText) await waitFor(document.fonts.load('12px "Noto Sans SC"', annotationText), signal);
    }
    abort(signal);
    const mapNode = art.nodes.find(node => node.kind === 'map' && isNodeVisible(node, art));
    if (mapNode) {
      const logicalWidth=Math.max(1,Math.round(mapNode.transform.width)),logicalHeight=Math.max(1,Math.round(mapNode.transform.height));
      resources.mapViewport={width:logicalWidth,height:logicalHeight};
      onStage?.(allowSavedMap ? '核对保存的地图快照' : '加载地图、地形与字形');
      if (allowSavedMap) {
        const metadata = art.mapSnapshot;
        if (!art.mapSnapshotAssetId || !metadata || !metadata.snapshotBundleAllowed) throw new Error('没有包含视角、注释和来源记录的可用地图快照。请联网重新保存。');
        if (metadata.inputHash !== mapSnapshotInputHash(art)) throw new Error('当前路线、风格或地图取景已变化，不能将旧快照用于这份新稿。请联网更新快照。');
        const blob = await services.getAsset(art.mapSnapshotAssetId); if (!blob) throw new Error('保存的地图快照资源缺失。');
        bitmap = await createImageBitmap(blob); abort(signal);
        if (bitmap.width !== metadata.width || bitmap.height !== metadata.height) throw new Error('保存快照尺寸与冻结记录不一致。');
        if (Math.abs(metadata.logicalWidth - logicalWidth) > .01 || Math.abs(metadata.logicalHeight - logicalHeight) > .01) throw new Error('保存快照视口不匹配当前地图框。');
        if (bitmap.width < Math.round(logicalWidth * scale) || bitmap.height < Math.round(logicalHeight * scale)) throw new Error('保存快照的像素不足以输出此尺寸，请联网渲染或降低导出尺寸。');
        resources.map = bitmap; resources.annotations = structuredClone(metadata.annotations);
        resources.attributions = [...metadata.attribution]; printAttribution = [...metadata.printAttribution]; mapReceipt = clone(metadata.receipt) as unknown as MapRenderReceipt; mapMode = 'saved-snapshot';
      } else {
        mapFrame = await services.renderMap({ camera: art.canonicalCamera, logicalWidth, logicalHeight, pixelRatio: scale, journey: art.journey, style: mapRecipe(art.styleId, art.paletteId, art.styleVersion, art.embeddedStyle), source: art.mapSource as unknown as MapSourceAdapter | undefined, showRoute: routeVisible(art), showArrows: art.visibility.arrows, signal, onStage });
        abort(signal);
        if (mapFrame.canvas.width < Math.round(logicalWidth * scale) || mapFrame.canvas.height < Math.round(logicalHeight * scale)) throw new Error('地图实际像素低于请求尺寸，无法以放大截图代替高清地图。');
        resources.map = mapFrame.canvas; resources.annotations = structuredClone(mapFrame.annotations);
        resources.attributions = [...mapFrame.receipt.attribution]; printAttribution = [...mapFrame.receipt.printAttribution]; mapReceipt = mapFrame.receipt; mapMode = 'live';
        await services.onMapFrame?.(art, mapFrame);
      }
    }
    const nodes = art.nodes.filter(node => node.kind === 'photo' && isNodeVisible(node, art));
    for (let i = 0; i < nodes.length; i++) {
      abort(signal); const node = nodes[i]; onStage?.(`处理照片 ${i + 1} / ${nodes.length}`);
      const originalOfPair = art.templateId === 'torn-art' && node.role === 'photo' && nodes.some(other => other.role === 'photo-art' && other.photoId === node.photoId);
      const edit = originalOfPair ? { ...node.photoEdit, mode: 'original' as const } : node.photoEdit;
      const assetId = edit?.mode === 'ai' && edit.derivedAssetId ? edit.derivedAssetId : node.assetId;
      if (!assetId) throw new Error(`照片 ${node.id} 没有资源绑定。`);
      const blob = await services.getAsset(assetId); if (!blob) throw new Error(`缺少照片资源：${assetId.slice(0, 12)}。请恢复完整项目。`);
      const canvas = await services.processPhoto(blob, edit, art.styleId, Math.min(8192, Math.ceil(Math.max(node.transform.width, node.transform.height) * scale * Math.max(1, node.crop?.zoom ?? 1) * 1.5)), signal);
      handles.push(canvas); resources.photos.set(node.id, canvas);
    }
    abort(signal); return { resources, mapFrame, mapReceipt, mapMode, printAttribution, dispose };
  } catch (error) { dispose(); throw error; }
}
function canvasBlob(canvas:HTMLCanvasElement,mime:string,quality:number){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('浏览器无法编码此格式。')),mime,quality));}
function crc32(bytes:Uint8Array) {let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
/** Canvas defaults to 96dpi. Encode the requested physical density, without changing pixels. */
export async function withDensity(blob:Blob,ppi:number):Promise<Blob>{
  if(!Number.isInteger(ppi)||ppi<72||ppi>600)throw new Error('PPI 必须为72到600的整数。');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(blob.type==='image/png') {
    const out:Uint8Array[]=[bytes.slice(0,8)];let offset=8;
    while(offset+12<=bytes.length){const view=new DataView(bytes.buffer,bytes.byteOffset+offset);const len=view.getUint32(0);const kind=String.fromCharCode(...bytes.slice(offset+4,offset+8));if(kind!=='pHYs')out.push(bytes.slice(offset,offset+12+len));if(kind==='IHDR') {const chunk=new Uint8Array(21),v=new DataView(chunk.buffer);v.setUint32(0,9);chunk.set([112,72,89,115],4);v.setUint32(8,Math.round(ppi/0.0254));v.setUint32(12,Math.round(ppi/0.0254));chunk[16]=1;v.setUint32(17,crc32(chunk.slice(4,17)));out.push(chunk);}offset+=12+len;}
    return new Blob(out.map(a=>a.buffer as ArrayBuffer),{type:blob.type});
  }
  if(blob.type==='image/jpeg') {
    const result=bytes.slice();for(let i=2;i<Math.min(result.length-16,2048);i++)if(result[i]===0xff&&result[i+1]===0xe0&&String.fromCharCode(...result.slice(i+4,i+9))==='JFIF\0'){const v=new DataView(result.buffer);result[i+11]=1;v.setUint16(i+12,ppi);v.setUint16(i+14,ppi);return new Blob([result],{type:blob.type});}
    if(result[0]!==0xff||result[1]!==0xd8)throw new Error('JPEG 密度写入失败：文件签名无效。');
    const app0=new Uint8Array([255,224,0,16,74,70,73,70,0,1,2,1,0,0,0,0,0,0]);const view=new DataView(app0.buffer);view.setUint16(12,ppi);view.setUint16(14,ppi);return new Blob([result.slice(0,2),app0,result.slice(2)],{type:blob.type});
  }
  // WebP density uses EXIF; encode a minimal TIFF XResolution/YResolution + inch unit.
  if(blob.type==='image/webp') {
    const exif=new Uint8Array(66),v=new DataView(exif.buffer);exif.set([73,73,42,0,8,0,0,0]);v.setUint16(8,3,true);
    const entry=(at:number,tag:number,type:number,value:number)=>{v.setUint16(at,tag,true);v.setUint16(at+2,type,true);v.setUint32(at+4,1,true);v.setUint32(at+8,value,true);};entry(10,282,5,50);entry(22,283,5,58);entry(34,296,3,2);v.setUint32(50,ppi,true);v.setUint32(54,1,true);v.setUint32(58,ppi,true);v.setUint32(62,1,true);
    // Preserve an existing VP8X header, or create one from the decoded file dimensions.
    const image=await createImageBitmap(blob);const header=new Uint8Array(18);header.set([86,80,56,88,10,0,0,0,8,0,0,0]);const w=image.width-1,h=image.height-1;header.set([w&255,w>>8&255,w>>16&255,h&255,h>>8&255,h>>16&255],12);image.close();
    const chunks:Uint8Array[]=[];let pos=12,hasVP8X=false;while(pos+8<=bytes.length){const size=new DataView(bytes.buffer,bytes.byteOffset+pos+4,4).getUint32(0,true),name=String.fromCharCode(...bytes.slice(pos,pos+4)),chunk=bytes.slice(pos,pos+8+size+(size%2));if(name==='VP8X'){chunk[8]|=8;hasVP8X=true;}if(name!=='EXIF')chunks.push(chunk);pos+=8+size+(size%2);}
    if(!hasVP8X){if(chunks.some(c=>String.fromCharCode(...c.slice(0,4))==='ALPH'||(String.fromCharCode(...c.slice(0,4))==='VP8L'&&c.length>=13&&(new DataView(c.buffer,c.byteOffset+9,4).getUint32(0,true)&0x10000000)!==0)))header[8]|=16;chunks.unshift(header);}
    const exifChunk=new Uint8Array(8+exif.length);exifChunk.set([69,88,73,70]);new DataView(exifChunk.buffer).setUint32(4,exif.length,true);exifChunk.set(exif,8);chunks.push(exifChunk);const head=bytes.slice(0,12);new DataView(head.buffer).setUint32(4,4+chunks.reduce((n,c)=>n+c.length,0),true);return new Blob([head,...chunks].map(a=>a.buffer as ArrayBuffer),{type:blob.type});
  }
  return blob;
}
export async function exportArtwork(project: ProjectDocument, artworkId: string, spec: ExportSpec, services: RenderServices, signal?: AbortSignal, onStage?: (stage: string) => void): Promise<{ blob: Blob; receipt: ExportReceipt; filename: string }> {
  const started = performance.now(), snapshot = clone(project), art = snapshot.artworks.find(artwork => artwork.id === artworkId); if (!art) throw new Error('导出目标作品不存在。');
  abort(signal); const dims = exportDimensions(art, spec), canvas = document.createElement('canvas');
  let prepared: PreparedResources | undefined, trim: HTMLCanvasElement | undefined;
  try {
    canvas.width = dims.width; canvas.height = dims.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }); if (!ctx) throw new Error('无法创建导出画布。');
    prepared = await prepareResources(art, services, dims.scale, signal, onStage, spec.allowSavedMap);
    // Measure only after the actual fonts have passed the resource barrier.
    const overflow = textOverflowNodes(art, ctx); if (overflow.length) throw new Error(`文字溢出：${overflow.map(node => node.role).join('、')}。请增加文字空间后导出。`);
    if (spec.intent === 'flat-print' && prepared.mapMode !== 'not-used') prepared.resources.attributions = [...prepared.printAttribution];
    const attribution = art.nodes.find(node => node.kind === 'attribution');
    if (prepared.resources.attributions.length && (!attribution || !isNodeVisible(attribution, art))) throw new Error('作品使用地图来源，必须保留可读的来源署名。');
    if(attribution&&prepared.resources.attributions.length){ctx.font=`${attribution.fontSize??9}px Inter, \"Noto Sans SC\", sans-serif`;const lines=wrapText(ctx,prepared.resources.attributions.join(' · '),attribution.transform.width);if(lines.length*11>attribution.transform.height+.1||attribution.transform.y+lines.length*11>art.artboard.height)throw new Error('来源署名空间不足，请选择更宽版式或为来源保留更多空间。');}
    abort(signal); onStage?.('合成冻结的作品');
    if (spec.intent === 'flat-print') {
      // Independent trim/outer rounding preserves exact mm-to-pixel results (odd bleed may differ by 1px).
      trim = document.createElement('canvas'); trim.width = dims.trimWidth; trim.height = dims.trimHeight;
      const tc = trim.getContext('2d'); if (!tc) throw new Error('无法创建印刷裁切画布。');
      const paper = resolveStyle(art).palette.paper;
      tc.fillStyle = paper; tc.fillRect(0, 0, trim.width, trim.height);
      tc.scale(trim.width / art.artboard.width, trim.height / art.artboard.height); renderArtwork(tc, art, prepared.resources, { intent: spec.intent, transparent: false, margin: 0 });
      const bx = dims.bleedX, by = dims.bleedY, right = dims.bleedRight, bottom = dims.bleedBottom;
      // Extend exact edge pixels. Filtered one-pixel strips and self-sampling can blend with
      // the unpainted outer canvas, making print corners translucent despite an opaque trim.
      ctx.fillStyle = paper; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(trim, bx, by);
      if (bx) ctx.drawImage(trim, 0, 0, 1, trim.height, 0, by, bx, trim.height);
      if (right) ctx.drawImage(trim, trim.width - 1, 0, 1, trim.height, bx + trim.width, by, right, trim.height);
      if (by) ctx.drawImage(trim, 0, 0, trim.width, 1, bx, 0, trim.width, by);
      if (bottom) ctx.drawImage(trim, 0, trim.height - 1, trim.width, 1, bx, by + trim.height, trim.width, bottom);
      if (bx && by) ctx.drawImage(trim, 0, 0, 1, 1, 0, 0, bx, by);
      if (right && by) ctx.drawImage(trim, trim.width - 1, 0, 1, 1, bx + trim.width, 0, right, by);
      if (bx && bottom) ctx.drawImage(trim, 0, trim.height - 1, 1, 1, 0, by + trim.height, bx, bottom);
      if (right && bottom) ctx.drawImage(trim, trim.width - 1, trim.height - 1, 1, 1, bx + trim.width, by + trim.height, right, bottom);
    } else { ctx.scale(dims.scale, dims.scale); renderArtwork(ctx, art, prepared.resources, { intent: spec.intent, transparent: spec.transparent && spec.format !== 'jpeg', background: spec.background, margin: dims.margin }); }
    abort(signal); onStage?.('编码并核验真实文件');
    const mime = `image/${spec.format}`; let blob = await canvasBlob(canvas, mime, spec.quality);
    if (blob.type !== mime) throw new Error(`浏览器未生成请求的 ${spec.format.toUpperCase()} 格式。`);
    if (spec.intent === 'flat-print') blob = await withDensity(blob, spec.ppi);
    const image = await createImageBitmap(blob); const validDimensions = image.width === dims.width && image.height === dims.height; image.close();
    if (!validDimensions) throw new Error('编码文件尺寸与请求不一致。'); abort(signal);
    const receipt: ExportReceipt = { appVersion: '1.0.0', projectId: snapshot.id, artworkId, projectRevision: snapshot.revision, selectionRevision: art.journey.selectionRevision, layoutRevision: art.layout.layoutRevision, style: `${art.styleId}@${art.styleVersion}`, template: `${art.templateId}@${art.templateVersion}`, sourceAssets: [...new Set(art.nodes.filter(node => isNodeVisible(node, art)).flatMap(node => [node.assetId, node.photoEdit?.derivedAssetId].filter((id): id is string => !!id)))], format: mime, width: dims.width, height: dims.height, bytes: blob.size, intent: spec.intent, ...(spec.intent === 'flat-print' ? { ppi: spec.ppi, bleedMm: spec.bleedMm } : {}), resourceBarrier: ['fonts', 'photos', 'composition', 'encoded-dimensions', ...(prepared.mapMode === 'live' ? ['tiles', 'glyphs', 'DEM-policy', 'canvas-backing-size'] : prepared.mapMode === 'saved-snapshot' ? ['snapshot-metadata', 'snapshot-pixels', 'snapshot-attribution'] : [])], map: prepared.mapReceipt, mapMode: prepared.mapMode, durationMs: performance.now() - started, completedAt: new Date().toISOString() };
    const safeTitle = (art.metadata.title || 'Travel-Studio').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80);
    return { blob, receipt, filename: `${safeTitle}-${dims.width}x${dims.height}.${spec.format === 'jpeg' ? 'jpg' : spec.format}` };
  } finally { prepared?.dispose(); if (trim) { trim.width = 0; trim.height = 0; } canvas.width = 0; canvas.height = 0; }
}
