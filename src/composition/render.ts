import type { ArtworkDocument, SceneNode, Coordinate, ProjectedGeoAnchor } from '../domain';
import { resolveStyle, resolveTemplate } from '../design-packages';
import { solveAnnotationLayout, type AnnotationLayoutSnapshot } from './annotations';

export type ProjectedAnnotation = ProjectedGeoAnchor;
export interface CompositionResources {
  photos: Map<string, CanvasImageSource>;
  map?: CanvasImageSource;
  mapViewport?: { width: number; height: number };
  annotations?: ProjectedAnnotation[];
  attributions: string[];
  annotationLayout?: AnnotationLayoutSnapshot;
}
export interface RenderOptions { intent: 'presentation' | 'flat-print'; transparent: boolean; background?: string; margin?: number }
export const EMPTY_RESOURCES: CompositionResources = { photos: new Map(), attributions: [] };
export function seededRandom(seed: number) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/** A persisted seed determines the paper contour, independently of output pixel density. */
export function paperPath(W: number, H: number, shape: string, seed: number, holes = false) {
  const path = new Path2D(), random = seededRandom(seed);
  if (shape === 'torn') {
    path.moveTo(0, 4);
    for (let x = 0; x <= W; x += 10) path.lineTo(x, random() * 7);
    for (let y = 0; y <= H; y += 10) path.lineTo(W - random() * 7, y);
    for (let x = W; x >= 0; x -= 10) path.lineTo(x, H - random() * 7);
    for (let y = H; y >= 0; y -= 10) path.lineTo(random() * 7, y);
    path.closePath();
  } else if (shape === 'ticket') {
    const n = Math.min(22, H * .045), r = 7;
    path.moveTo(r, 0); path.lineTo(W-r, 0); path.quadraticCurveTo(W, 0, W, r);
    path.lineTo(W, H*.5-n); path.arc(W, H*.5, n, -Math.PI/2, Math.PI/2, true);
    path.lineTo(W, H-r); path.quadraticCurveTo(W, H, W-r, H); path.lineTo(r,H); path.quadraticCurveTo(0,H,0,H-r);
    path.lineTo(0,H*.5+n); path.arc(0,H*.5,n,Math.PI/2,-Math.PI/2,true); path.lineTo(0,r); path.quadraticCurveTo(0,0,r,0); path.closePath();
  } else { path.roundRect(0, 0, W, H, 6); }
  if (holes && shape === 'ticket') { path.moveTo(W*.5+6,18); path.arc(W*.5,18,6,0,Math.PI*2); }
  return path;
}
function sourceDimensions(image: CanvasImageSource): [number, number] {
  const obj = image as unknown as { width: number; height: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number };
  return [obj.naturalWidth || obj.videoWidth || obj.width, obj.naturalHeight || obj.videoHeight || obj.height];
}
export function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number, node: SceneNode) {
  const [iw, ih] = sourceDimensions(image), crop = node.crop ?? node.photoEdit?.crop ?? { x: .5, y: .5, zoom: 1, rotation: 0 };
  const angle = crop.rotation * Math.PI / 180;
  const boundingW = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
  const boundingH = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
  const scale = Math.max(boundingW / iw, boundingH / ih) * Math.max(1, crop.zoom);
  ctx.save(); ctx.beginPath(); ctx.rect(0,0,width,height); ctx.clip();
  ctx.translate(width/2,height/2); ctx.rotate(angle);
  const dx = (Math.max(0,Math.min(1,crop.x))-.5) * Math.max(0,iw*scale-boundingW), dy = (Math.max(0,Math.min(1,crop.y))-.5) * Math.max(0,ih*scale-boundingH);
  ctx.drawImage(image, -iw*scale/2-dx, -ih*scale/2-dy, iw*scale, ih*scale); ctx.restore();
}
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line.trimEnd()); line = char.trimStart(); } else line += char;
    }
    lines.push(line);
  }
  return lines;
}
export function dateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return `${value.replaceAll('-', ' / ')}   ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][date.getUTCDay()]}`;
}
export function coordinateLabel(coordinate?: Coordinate) { if (!coordinate) return ''; return `${Math.abs(coordinate[1]).toFixed(4)}°${coordinate[1]>=0?'N':'S'}  ${Math.abs(coordinate[0]).toFixed(4)}°${coordinate[0]>=0?'E':'W'}`; }
function drawTexture(ctx: CanvasRenderingContext2D, art: ArtworkDocument) {
  const { texture, palette } = resolveStyle(art), { width: W,height:H }=art.artboard;
  if (!art.visibility.texture || texture==='none') return;
  const rand=seededRandom(art.seed); ctx.save();
  ctx.fillStyle=palette.ink; ctx.strokeStyle=palette.ink;
  const count=texture==='canvas'?2400:1800;
  for(let i=0;i<count;i++) { const x=rand()*W,y=rand()*H; ctx.globalAlpha=.018+rand()*.035;
    if(texture==='rice'||texture==='pencil'){ctx.lineWidth=.25;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+rand()*4,y+rand()*2);ctx.stroke();}
    else ctx.fillRect(x,y,texture==='canvas'?.5:.8,texture==='canvas'?2:.8);
  }
  if(texture==='parchment') { const g=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.25,W/2,H/2,Math.max(W,H)*.68); g.addColorStop(0,'#96734200');g.addColorStop(1,'#96734236');ctx.globalAlpha=1;ctx.fillStyle=g;ctx.fillRect(0,0,W,H); }
  ctx.restore();
}
function annotationLayout(ctx:CanvasRenderingContext2D,art:ArtworkDocument,resources:CompositionResources) {
  const map=art.nodes.find(node=>node.kind==='map'&&isNodeVisible(node,art));
  if(!map)return undefined;
  ctx.save();ctx.font='12px Inter, "Noto Sans SC", sans-serif';
  const result=solveAnnotationLayout({mapFrame:map.transform,viewport:resources.mapViewport,anchors:resources.annotations??[],photoNodes:art.nodes.filter(node=>node.kind==='photo'&&isNodeVisible(node,art)),obstacles:art.nodes.filter(node=>['text','attribution'].includes(node.kind)&&isNodeVisible(node,art)).map(node=>({id:node.id,transform:node.transform})),showNumbers:art.visibility.numbers,showNames:art.visibility.names,measureText:text=>ctx.measureText(text).width});
  ctx.restore();return result;
}
function drawAnnotations(ctx: CanvasRenderingContext2D, art: ArtworkDocument, resources: CompositionResources, width: number,height: number) {
  const {palette}=resolveStyle(art),layout=resources.annotationLayout??annotationLayout(ctx,art,resources);if(!layout)return;
  ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
  ctx.strokeStyle=palette.accent+'99';ctx.lineWidth=.9;
  for(const leader of layout.leaders){ctx.beginPath();for(const[a,b]of leader.segments){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();}
  for(const badge of layout.badges){const{x,y}=badge.center;ctx.fillStyle=palette.accent;ctx.strokeStyle=palette.paper;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='600 12px Inter, "Noto Sans SC", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(badge.text,x,y+.5);}
  for(const name of layout.names){const{x,y,width:w,height:h}=name.bounds;ctx.fillStyle=palette.paper+'ed';ctx.beginPath();ctx.roundRect(x,y,w,h,4);ctx.fill();ctx.font='12px Inter, "Noto Sans SC", sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=palette.ink;ctx.fillText(name.text,x+6,y+h/2,w-12);}
  ctx.restore();
}
export function isNodeVisible(node: SceneNode, art: ArtworkDocument, seen = new Set<string>()): boolean {
  if (!node.visible || node.userOverrides?.visible === false || seen.has(node.id)) return false;
  if (node.kind === 'photo' && !art.visibility.photos) return false;
  if (['map', 'route', 'annotation'].includes(node.kind) && !art.visibility.map) return false;
  if (node.kind === 'route' && !art.visibility.route) return false;
  if (node.parentId) {
    const parent = art.nodes.find(candidate => candidate.id === node.parentId);
    if (!parent) return false;
    const ancestors = new Set(seen); ancestors.add(node.id);
    return isNodeVisible(parent, art, ancestors);
  }
  return true;
}
/** Shared by the editor's Konva scene functions and the full-resolution encoder. */
export function drawNode(ctx: CanvasRenderingContext2D, node: SceneNode, art: ArtworkDocument, resources: CompositionResources, intent: RenderOptions['intent']) {
  if(!isNodeVisible(node,art))return;
  const {width:w,height:h}=node.transform, style=resolveStyle(art), p=style.palette;
  if(['background','paper','group','route'].includes(node.kind))return;
  ctx.save();ctx.translate(node.transform.x,node.transform.y);ctx.rotate(node.transform.rotation*Math.PI/180);ctx.globalAlpha=node.opacity??1;
  if(node.kind==='map') {
    ctx.save();ctx.beginPath();ctx.roundRect(0,0,w,h,3);ctx.clip();
    if(resources.map)ctx.drawImage(resources.map,0,0,w,h);
    else {ctx.fillStyle=p.land;ctx.fillRect(0,0,w,h);ctx.fillStyle=p.ink;ctx.font='14px Inter, "Noto Sans SC", sans-serif';ctx.fillText('地图资源准备中',18,30);}
    ctx.restore();
  } else if(node.kind==='annotation') drawAnnotations(ctx,art,resources,w,h);
  else if(node.kind==='photo') {
    const img=resources.photos.get(node.id)??resources.photos.get(node.assetId??'');
    const frame=Math.max(5,Math.min(w,h)*.035);ctx.fillStyle='#fffdf5';ctx.shadowColor='#25271c30';ctx.shadowBlur=7;ctx.shadowOffsetY=3;ctx.fillRect(-frame,-frame,w+2*frame,h+2*frame+frame*.5);ctx.shadowColor='transparent';
    if(img)drawCover(ctx,img,w,h,node); else {ctx.fillStyle='#e1ded4';ctx.fillRect(0,0,w,h);ctx.fillStyle='#6e7168';ctx.font='13px sans-serif';ctx.fillText('照片准备中',8,24);}
    const binding=resources.annotationLayout?.photoBindings.find(item=>item.nodeId===node.id);
    if(art.visibility.map&&art.visibility.numbers&&binding?.visitId){ctx.fillStyle=p.paper+'ee';ctx.beginPath();ctx.roundRect(5,5,23,21,4);ctx.fill();ctx.fillStyle=p.ink;ctx.font='600 11px Inter, "Noto Sans SC", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(binding.number===null?'?':String(binding.number),16.5,15.5);}
  } else if(node.kind==='text') {
    let text=node.role==='date'?dateLabel(node.text??''):node.role==='coordinates'?coordinateLabel(art.journey.resolvedVisits.find(v=>v.coordinate)?.coordinate):node.text??'';
    ctx.fillStyle=node.color??p.ink;const fs=node.fontSize??16;ctx.font=`${node.role==='title'?500:400} ${fs}px ${node.fontFamily??style.font}`;ctx.textBaseline='top';ctx.textAlign='left';
    const lines=wrapText(ctx,text,w); lines.forEach((line,i)=>ctx.fillText(line,0,i*fs*1.28));
  } else if(node.kind==='attribution') {
    const text=(art.visibility.map?resources.attributions:[]).join(' · ');
    if(text){ctx.fillStyle=p.ink;ctx.font=`${node.fontSize??9}px Inter, "Noto Sans SC", sans-serif`;ctx.textBaseline='top';const lines=wrapText(ctx,text,w);lines.forEach((line,i)=>ctx.fillText(line,0,i*11));}
  } else if(node.kind==='decoration') {
    ctx.strokeStyle=p.accent;ctx.fillStyle=p.accent;
    if(node.role==='border'){ctx.lineWidth=.8;ctx.globalAlpha=.5;ctx.strokeRect(0,0,w,h);if(art.styleId==='parchment') {ctx.strokeRect(4,4,w-8,h-8);}}
    else if(node.role==='stamp'){ctx.save();ctx.rotate(-.12);ctx.lineWidth=1.4;ctx.globalAlpha=.75;ctx.strokeRect(0,0,w,h);ctx.strokeRect(3,3,w-6,h-6);ctx.font=`${w*.25}px ${style.font}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('旅途',w/2,h*.35);ctx.fillText('留念',w/2,h*.66);ctx.restore();}
    else if(node.role==='compass') {ctx.translate(w/2,h/2);ctx.rotate(-art.canonicalCamera.bearing*Math.PI/180);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,-h*.38);ctx.lineTo(w*.15,h*.22);ctx.lineTo(0,h*.1);ctx.lineTo(-w*.15,h*.22);ctx.closePath();ctx.stroke();ctx.font='9px Inter, "Noto Sans SC", sans-serif';ctx.textAlign='center';ctx.fillText('N',0,-h*.48);}
    else if(node.role==='string'&&intent==='presentation'&&resolveTemplate(art).shape==='ticket'&&art.visibility.holes){ctx.strokeStyle='#996950';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(w/2,18);ctx.bezierCurveTo(-20,-15,50,-22,w/2,5);ctx.bezierCurveTo(0,-10,16,-18,w/2,18);ctx.stroke();}
  }
  ctx.restore();
}
export function renderArtwork(ctx: CanvasRenderingContext2D, art: ArtworkDocument, resources: CompositionResources, options: RenderOptions) {
  const {width:W,height:H}=art.artboard, margin=options.margin??(options.intent==='presentation'?36:0), p=resolveStyle(art).palette;
  resources={...resources,annotationLayout:annotationLayout(ctx,art,resources)};
  ctx.save();
  if(!options.transparent) {ctx.fillStyle=options.background??(options.intent==='presentation'?'#e9e7e0':p.paper);ctx.fillRect(0,0,W+margin*2,H+margin*2);}
  ctx.translate(margin,margin);
  const path=paperPath(W,H,resolveTemplate(art).shape,art.seed,art.visibility.holes);
  if(options.intent==='presentation'&&art.visibility.shadow){ctx.save();ctx.shadowColor='#2631242d';ctx.shadowBlur=18;ctx.shadowOffsetY=9;ctx.fillStyle=p.paper;ctx.fill(path,'evenodd');ctx.restore();}
  ctx.save();ctx.clip(path,'evenodd');ctx.fillStyle=art.nodes.find(n=>n.kind==='background')?.userOverrides?.color as string??p.paper;ctx.fillRect(0,0,W,H);
  drawTexture(ctx,art);
  for(const node of [...art.nodes].sort((a,b)=>a.zIndex-b.zIndex))if(node.role!=='string')drawNode(ctx,node,art,resources,options.intent);
  ctx.restore();
  if(options.intent==='presentation')for(const node of art.nodes.filter(n=>n.role==='string'))drawNode(ctx,node,art,resources,options.intent);
  ctx.restore();
}
export function textOverflowNodes(art: ArtworkDocument, ctx: CanvasRenderingContext2D) {
  return art.nodes.filter(n=>isNodeVisible(n,art)&&n.kind==='text').filter(n=>{const fs=n.fontSize??16;ctx.font=`${n.role==='title'?500:400} ${fs}px ${n.fontFamily??resolveStyle(art).font}`;return wrapText(ctx,n.role==='date'?dateLabel(n.text??''):n.text??'',n.transform.width).length*fs*1.28>n.transform.height+2;});
}
