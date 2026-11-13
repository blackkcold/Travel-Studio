import { Map as LibreMap, setWorkerUrl, setWorkerCount, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import workerURL from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type * as GeoJSON from 'geojson';
import type { CameraSpec, Coordinate, JourneySnapshot, ProjectedGeoAnchor, LocationPrecision } from '../domain';
import { minimalBounds } from '../geo';
import { PROVIDER_POLICIES, throwIfAborted } from '../providers';
import { compileMapStyle, DEFAULT_MAP_RECIPE, OPENFREEMAP_SOURCE, photoGeoJSON, photoIdentity, routeGeoJSON, visitGeoJSON,
  type AtlasPhotoPoint, type MapArtRecipe, type MapSourceAdapter } from './style';
import { createMapRequestManager } from './network';

setWorkerUrl(workerURL);
setWorkerCount(2);

export interface MapSelectEvent { kind: 'visit' | 'photo' | 'cluster' | 'coordinate'; coordinate: Coordinate; visitId?: string; photoIds?: string[] }
export interface MapControllerOptions {
  camera: CameraSpec;
  style?: MapArtRecipe;
  source?: MapSourceAdapter;
  journey?: JourneySnapshot;
  photoPoints?: AtlasPhotoPoint[];
  showRoute?: boolean;
  showArrows?: boolean;
  showStops?: boolean;
  showNumbers?: boolean;
  showNames?: boolean;
  interactive?: boolean;
  pixelRatio?: number;
  onCameraChange?: (camera: CameraSpec) => void;
  onSelect?: (selection: MapSelectEvent) => void;
  onError?: (error: MapRenderError) => void;
  onReady?: () => void;
}
export interface MapController {
  ready: Promise<void>;
  setCamera(camera: CameraSpec, animate?: boolean): void;
  getCamera(): CameraSpec;
  setJourney(journey?: JourneySnapshot): void;
  setPhotos(photos: AtlasPhotoPoint[]): void;
  setStyle(style: MapArtRecipe): void;
  setTerrain(enabled: boolean, exaggeration?: number, provider?: CameraSpec['terrainProvider']): void;
  setVisibility(options: {route?: boolean; arrows?: boolean; stops?: boolean; numbers?: boolean; names?: boolean}): void;
  fitCoordinates(coordinates: Coordinate[], padding?: number): void;
  project(coordinate: Coordinate): {x: number; y: number};
  unproject(point: {x:number; y:number}): Coordinate;
  getVisiblePhotos(): Array<AtlasPhotoPoint & {id:string;photoId:string;x:number; y:number}>;
  onMove(callback: (camera: CameraSpec) => void): () => void;
  onClick(callback: (selection: MapSelectEvent) => void): () => void;
  onRender(callback: () => void): () => void;
  zoomBy(delta: number): void;
  resize(): void;
  capture(options?: {pixelRatio?: number; signal?: AbortSignal}): Promise<MapFrame>;
  dispose(): void;
}
export class MapRenderError extends Error {
  constructor(public code: string, message: string, public details: string[] = [], public retryable = true) { super(message); this.name = 'MapRenderError'; }
}
export interface ProjectedAnnotation extends ProjectedGeoAnchor { coordinate: Coordinate; photoIds: string[]; precision: LocationPrecision }
export interface MapRenderReceipt {
  renderer: string;
  provider: string;
  providerVersion: string;
  terrainProvider?: string;
  terrainExaggeration: number;
  camera: CameraSpec;
  logicalWidth: number;
  logicalHeight: number;
  width: number;
  height: number;
  pixelRatio: number;
  selectionRevision?: number;
  barriers: {tiles: true; glyphs: true; terrain: 'ready' | 'not-requested'; sourceErrors: 0};
  attribution: string[];
  printAttribution: string[];
  snapshotBundleAllowed: boolean;
  buildingHeights: 'source-height-or-estimate';
  annotationStrategy: 'screen-overlay-no-depth-test';
  durationMs: number;
  completedAt: string;
}
export interface MapFrame { canvas: HTMLCanvasElement; annotations: ProjectedAnnotation[]; receipt: MapRenderReceipt; dispose(): void }
export interface MapRenderSpec {
  camera: CameraSpec;
  logicalWidth: number;
  logicalHeight: number;
  pixelRatio?: number;
  journey?: JourneySnapshot;
  style?: MapArtRecipe;
  source?: MapSourceAdapter;
  showRoute?: boolean;
  showArrows?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStage?: (stage: string) => void;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s)]+/g, (url) => {try {return new URL(url).origin + '/…';} catch {return '[resource]';}}).slice(0,400);
}
function cameraState(map: LibreMap, previous: CameraSpec): CameraSpec {
  const center = map.getCenter();
  const padding = map.getPadding();
  return {...previous, center:[((center.lng + 180) % 360 + 360) % 360 - 180,center.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),
    padding:{top:padding.top??0,right:padding.right??0,bottom:padding.bottom??0,left:padding.left??0},elevation:map.getCameraTargetElevation(),roll:map.getRoll()};
}
function cameraOptions(camera: CameraSpec) {
  return {center:camera.center,zoom:camera.zoom,bearing:camera.bearing,pitch:camera.pitch,padding:camera.padding,
    ...(camera.elevation !== undefined ? {elevation:camera.elevation} : {}),...(camera.roll !== undefined ? {roll:camera.roll}: {})};
}
function surfaceCoordinate(map: LibreMap, coordinate: Coordinate): Coordinate {
  const center = map.getCenter().lng;
  const lng = coordinate[0] + Math.round((center-coordinate[0])/360)*360;
  return [lng,coordinate[1]];
}
function createMap(container: HTMLElement, options: MapControllerOptions, forExport = false): LibreMap {
  let map:LibreMap|undefined;
  const requests=createMapRequestManager(options.source??OPENFREEMAP_SOURCE,error=>map?.fire('error',{error}));
  try {
    map=new LibreMap({
      container, style:compileMapStyle({camera:options.camera,recipe:options.style,source:options.source,journey:options.journey,photoPoints:options.photoPoints,
        showRoute:options.showRoute,showArrows:options.showArrows,showStops:options.showStops,showNumbers:options.showNumbers,showNames:options.showNames}),
      ...cameraOptions(options.camera),interactive:options.interactive !== false, attributionControl:forExport ? false : {compact:true},
      pixelRatio:options.pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1,2), maxCanvasSize:[4096,4096],
      canvasContextAttributes:{preserveDrawingBuffer:forExport,antialias:true,powerPreference:'high-performance',failIfMajorPerformanceCaveat:false},
      fadeDuration:0,maxPitch:75,maxZoom:20,minZoom:1,renderWorldCopies:true,trackResize:!forExport,
      centerClampedToGround:options.camera.elevation === undefined,
      localIdeographFontFamily:false,
      transformRequest:requests.transformRequest,
    });
    map.once('remove',()=>requests.dispose());return map;
  } catch(error) { requests.dispose();throw new MapRenderError('WEBGL_UNAVAILABLE','无法启动真实地图渲染，请使用支持 WebGL 2 的浏览器或继续编辑照片作品',[safeError(error)],false); }
}

/** Atlas camera changes never mutate a project's canonical artwork camera. */
export function createMapController(container: HTMLElement, initial: MapControllerOptions): MapController {
  let state = {...initial,camera:structuredClone(initial.camera),style:initial.style ?? DEFAULT_MAP_RECIPE};
  let disposed = false;
  const map = createMap(container,state);
  const cameraListeners = new Set<(camera:CameraSpec)=>void>();
  const clickListeners = new Set<(selection:MapSelectEvent)=>void>();
  const renderListeners = new Set<()=>void>();
  if (initial.onCameraChange) cameraListeners.add(initial.onCameraChange);
  if (initial.onSelect) clickListeners.add(initial.onSelect);
  let readyResolve!:()=>void; let readyReject!:(error:unknown)=>void;
  const ready = new Promise<void>((resolve,reject) => {readyResolve=resolve;readyReject=reject;});
  // Register a handler immediately so a consumer can attach UI callbacks before awaiting ready.
  void ready.catch(()=>undefined);
  const sourceUpdate = (id:string,data:GeoJSON.FeatureCollection) => {const source = map.getSource(id) as GeoJSONSource | undefined; if(source) source.setData(data);};
  // isStyleLoaded() also becomes false while a GeoJSON update is in flight. It must
  // not drop the next selection revision; setData itself coalesces newer input.
  const updateSources = () => {if(disposed)return;sourceUpdate('journey',routeGeoJSON(state.journey));sourceUpdate('visits',visitGeoJSON(state.journey));sourceUpdate('photos',photoGeoJSON(state.photoPoints ?? []));};
  const rebuildStyle = () => {if(disposed)return;map.setStyle(compileMapStyle({camera:state.camera,recipe:state.style,source:state.source,journey:state.journey,photoPoints:state.photoPoints,
    showRoute:state.showRoute,showArrows:state.showArrows,showStops:state.showStops,showNumbers:state.showNumbers,showNames:state.showNames}));};
  map.on('load', () => {updateSources();readyResolve();initial.onReady?.();});
  map.on('style.load',updateSources);
  map.on('moveend', () => {if(disposed)return;state.camera=cameraState(map,state.camera);for(const fn of cameraListeners)fn(structuredClone(state.camera));});
  map.on('render', () => {for(const fn of renderListeners)fn();});
  map.on('error', (event) => {
    const error = new MapRenderError('MAP_RESOURCE','地图资源加载失败，可重试；当前位置与作品资料仍保留',[safeError(event.error)]);
    initial.onError?.(error);
    if(!map.isStyleLoaded())readyReject(error);
  });
  map.on('webglcontextlost', () => initial.onError?.(new MapRenderError('CONTEXT_LOST','图形上下文丢失，请重试地图；项目资料未修改')));
  const select = (selection:MapSelectEvent) => {for(const fn of clickListeners)fn(selection);};
  map.on('click', async (event:MapMouseEvent) => {
    if(disposed || !map.isStyleLoaded())return;
    const existing = ['photo-clusters','photo-points','visit-points'].filter(id=>Boolean(map.getLayer(id)));
    const feature = map.queryRenderedFeatures(event.point,{layers:existing})[0];
    const coordinate:Coordinate = [event.lngLat.lng,event.lngLat.lat];
    if(feature?.properties?.cluster_id !== undefined) {
      const source = map.getSource('photos') as GeoJSONSource;
      try {
        const clusterId=Number(feature.properties.cluster_id);
        const zoom=await source.getClusterExpansionZoom(clusterId);
        if(disposed)return;
        if(zoom <= 17 && map.getZoom() < 17) map.easeTo({center:(feature.geometry as GeoJSON.Point).coordinates as Coordinate,zoom:Math.min(zoom,17),duration:300});
        else {
          const leaves=await source.getClusterLeaves(clusterId,Math.min(5000,Number(feature.properties.point_count)),0);
          if(!disposed)select({kind:'cluster',coordinate,photoIds:leaves.map(f=>String(f.properties?.photoId)).filter(Boolean)});
        }
      } catch(error) {initial.onError?.(new MapRenderError('CLUSTER','照片分组暂时不可展开，请使用列表查看',[safeError(error)]));}
      return;
    }
    if(feature?.properties?.photoId) select({kind:'photo',coordinate,photoIds:[String(feature.properties.photoId)]});
    else if(feature?.properties?.visitId) select({kind:'visit',coordinate,visitId:String(feature.properties.visitId)});
    else select({kind:'coordinate',coordinate});
  });
  const controller:MapController = {
    ready,
    setCamera(camera,animate=false){
      if(disposed)return;
      const changed=state.camera.terrain!==camera.terrain || state.camera.terrainProvider!==camera.terrainProvider || state.camera.exaggeration!==camera.exaggeration || state.camera.projection!==camera.projection;
      state.camera=structuredClone(camera); if(changed)rebuildStyle();
      if(animate)map.easeTo({...cameraOptions(camera),duration:300});else map.jumpTo(cameraOptions(camera));
    },
    getCamera(){return cameraState(map,state.camera);},
    setJourney(journey){state.journey=journey;if(!disposed){sourceUpdate('journey',routeGeoJSON(journey));sourceUpdate('visits',visitGeoJSON(journey));}},
    setPhotos(photos){state.photoPoints=photos;if(!disposed)sourceUpdate('photos',photoGeoJSON(photos));},
    setStyle(style){state.style=style;rebuildStyle();},
    setTerrain(enabled,exaggeration=1,provider=state.camera.terrainProvider){state.camera={...cameraState(map,state.camera),terrain:enabled,exaggeration,terrainProvider:provider};rebuildStyle();},
    setVisibility(options){
      if(options.route!==undefined)state.showRoute=options.route;if(options.arrows!==undefined)state.showArrows=options.arrows;if(options.stops!==undefined)state.showStops=options.stops;
      if(options.numbers!==undefined)state.showNumbers=options.numbers;if(options.names!==undefined)state.showNames=options.names;
      for(const id of ['journey-line','journey-casing'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',state.showRoute===false?'none':'visible');
      if(map.getLayer('journey-arrows'))map.setLayoutProperty('journey-arrows','visibility',state.showRoute===false || state.showArrows===false?'none':'visible');
      if(map.getLayer('visit-points'))map.setLayoutProperty('visit-points','visibility',state.showStops===false?'none':'visible');
      if(map.getLayer('visit-numbers'))map.setLayoutProperty('visit-numbers','visibility',state.showStops===false || state.showNumbers===false?'none':'visible');
      if(map.getLayer('visit-names'))map.setLayoutProperty('visit-names','visibility',state.showStops===false || state.showNames!==true?'none':'visible');
    },
    fitCoordinates(coordinates,padding=72){
      if(!coordinates.length || disposed)return;
      const bounds=minimalBounds(coordinates);if(!bounds)return;
      if(coordinates.length===1)map.easeTo({center:coordinates[0],zoom:Math.max(map.getZoom(),13),duration:350});
      else map.fitBounds(bounds,{padding,maxZoom:16,duration:350});
    },
    project(coordinate){const point=map.project(surfaceCoordinate(map,coordinate));return{x:point.x,y:point.y};},
    unproject(point){const lnglat=map.unproject([point.x,point.y]);return [lnglat.lng,lnglat.lat];},
    getVisiblePhotos(){
      if(disposed || !map.isStyleLoaded())return[];
      const ids=new Set(map.queryRenderedFeatures({layers:['photo-points']}).map(f=>String(f.properties?.photoId)));
      return (state.photoPoints ?? []).filter(p=>ids.has(photoIdentity(p))).slice(0,24).map(p=>({...p,id:photoIdentity(p),photoId:photoIdentity(p),...controller.project(p.coordinate)}));
    },
    onMove(fn){cameraListeners.add(fn);return()=>cameraListeners.delete(fn);},
    onClick(fn){clickListeners.add(fn);return()=>clickListeners.delete(fn);},
    onRender(fn){renderListeners.add(fn);return()=>renderListeners.delete(fn);},
    zoomBy(delta){if(!disposed)map.zoomTo(map.getZoom()+delta,{duration:200});},
    resize(){if(!disposed)map.resize();},
    capture(options={}){return renderMapFrame({camera:controller.getCamera(),logicalWidth:container.clientWidth,logicalHeight:container.clientHeight,
      style:state.style,source:state.source,journey:state.journey,showRoute:state.showRoute,showArrows:state.showArrows,...options});},
    dispose(){if(disposed)return;disposed=true;readyReject(new MapRenderError('ABORTED','地图已关闭',[],false));cameraListeners.clear();clickListeners.clear();renderListeners.clear();map.remove();},
  };
  return controller;
}

/** All network failures are recorded before idle; idle alone is never export success. */
function waitForResources(map:LibreMap,errors:string[],signal:AbortSignal|undefined,timeoutMs:number):Promise<void> {
  return new Promise((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>;
    const cleanup=()=>{clearTimeout(timer);map.off('idle',check);map.off('error',failed);map.off('webglcontextlost',contextLost);signal?.removeEventListener('abort',aborted);};
    const finish=(error?:Error)=>{cleanup();error?reject(error):resolve();};
    const aborted=()=>finish(new MapRenderError('ABORTED','地图渲染已取消',[],false));
    const contextLost=()=>finish(new MapRenderError('CONTEXT_LOST','导出期间图形上下文丢失，文件未生成'));
    const failed=()=>{if(errors.length)finish(new MapRenderError('RESOURCE_BARRIER','地图资源未全部就绪，已停止导出',errors));};
    const check=()=>{
      if(signal?.aborted){aborted();return;}
      if(errors.length){failed();return;}
      if(map.isStyleLoaded() && map.areTilesLoaded() && !map.isMoving())finish();
    };
    timer=setTimeout(()=>finish(new MapRenderError('MAP_TIMEOUT','地图、字体或地形资源等待超时，未生成不完整导出',errors)),timeoutMs);
    map.on('idle',check);map.on('error',failed);map.on('webglcontextlost',contextLost);signal?.addEventListener('abort',aborted,{once:true});
    if(signal?.aborted)aborted();
  });
}

export function validateRenderDimensions(width:number,height:number,pixelRatio:number):void {
  if(!Number.isFinite(width)||!Number.isFinite(height)||!Number.isFinite(pixelRatio)||width<1||height<1||pixelRatio<=0)throw new MapRenderError('INVALID_SIZE','地图导出尺寸无效',[],false);
  if(Math.ceil(width*pixelRatio)>4096 || Math.ceil(height*pixelRatio)>4096)throw new MapRenderError('GPU_SIZE_LIMIT','此版本真实地图单帧上限为 4096 × 4096 像素，请减小输出尺寸',[],false);
}

/** A dedicated fixed-viewport render; only backing resolution changes, never camera/zoom. */
export async function renderMapFrame(spec:MapRenderSpec, outerSignal?:AbortSignal):Promise<MapFrame> {
  const signal=outerSignal ?? spec.signal;
  throwIfAborted(signal,'map');
  const width=Math.round(spec.logicalWidth),height=Math.round(spec.logicalHeight),ratio=spec.pixelRatio ?? 1;
  validateRenderDimensions(width,height,ratio);
  const source=spec.source ?? OPENFREEMAP_SOURCE;
  const terrainPolicy=spec.camera.terrain?PROVIDER_POLICIES[spec.camera.terrainProvider]:undefined;
  if(!source.policy.exportAllowed)throw new MapRenderError('EXPORT_PERMISSION','当前地图来源不允许导出',[],false);
  if(terrainPolicy && !terrainPolicy.exportAllowed)throw new MapRenderError('EXPORT_PERMISSION','当前地形来源不允许导出',[],false);
  const started=performance.now();const errors:string[]=[];
  const holder=document.createElement('div');holder.style.cssText=`position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;pointer-events:none;opacity:0;`;
  document.body.append(holder);
  let map:LibreMap|undefined;
  try {
    spec.onStage?.('加载真实地图、字体与地形');
    map=createMap(holder,{camera:spec.camera,style:spec.style,source,journey:spec.journey,showRoute:spec.showRoute,showArrows:spec.showArrows,showStops:false,interactive:false,pixelRatio:ratio},true);
    map.on('error',e=>errors.push(safeError(e.error)));
    await waitForResources(map,errors,signal,spec.timeoutMs ?? (ratio>1?120_000:45_000));
    throwIfAborted(signal,'map');
    if(spec.camera.terrain && map.queryTerrainElevation(spec.camera.center)===null)throw new MapRenderError('DEM_UNAVAILABLE','当前区域的真实地形未加载，请重试或明确切换为 2D');
    spec.onStage?.('核验地图像素与固定视角');
    const glCanvas=map.getCanvas();
    const requestedWidth=Math.floor(width*ratio),requestedHeight=Math.floor(height*ratio);
    if(glCanvas.width<requestedWidth || glCanvas.height<requestedHeight)throw new MapRenderError('DOWNSCALED_MAP','图形设备降低了地图实际分辨率，已停止导出',[`${glCanvas.width}×${glCanvas.height} < ${requestedWidth}×${requestedHeight}`],false);
    const canvas=document.createElement('canvas');canvas.width=glCanvas.width;canvas.height=glCanvas.height;
    const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw new MapRenderError('CANVAS_UNAVAILABLE','无法创建地图输出画布');
    ctx.drawImage(glCanvas,0,0);
    // Accessing pixels verifies that external map data did not taint the output canvas.
    try {ctx.getImageData(0,0,1,1);}catch{throw new MapRenderError('CORS','地图来源不允许跨域导出，请替换来源',[],false);}
    const order=spec.journey?.order.orderedVisitIds ?? [];
    const annotations:ProjectedAnnotation[]=(spec.journey?.resolvedVisits ?? []).filter(v=>v.coordinate && v.status==='confirmed').map(v=>{
      const point=map!.project(surfaceCoordinate(map!,v.coordinate!));const index=order.indexOf(v.id);
      return{visitId:v.id,placeId:v.placeId,precision:v.precision,number:index<0?null:index+1,name:v.name,coordinate:[...v.coordinate!] as Coordinate,x:point.x,y:point.y,
        visible:point.x>=0 && point.y>=0 && point.x<=width && point.y<=height,photoIds:[...v.photoIds]};
    });
    const printAttribution=[...new Set([...source.policy.printAttribution,...(terrainPolicy?.printAttribution??[])])];
    const receipt:MapRenderReceipt={renderer:'maplibre-gl@6.18.0',provider:source.id,providerVersion:source.version,
      terrainProvider:spec.camera.terrain?spec.camera.terrainProvider:undefined,terrainExaggeration:spec.camera.exaggeration,camera:cameraState(map,spec.camera),
      logicalWidth:width,logicalHeight:height,width:canvas.width,height:canvas.height,pixelRatio:map.getPixelRatio(),selectionRevision:spec.journey?.selectionRevision,
      barriers:{tiles:true,glyphs:true,terrain:spec.camera.terrain?'ready':'not-requested',sourceErrors:0},
      attribution:printAttribution,printAttribution,snapshotBundleAllowed:source.policy.snapshotBundleAllowed && (terrainPolicy?.snapshotBundleAllowed??true),
      buildingHeights:'source-height-or-estimate',annotationStrategy:'screen-overlay-no-depth-test',durationMs:performance.now()-started,completedAt:new Date().toISOString()};
    return{canvas,annotations,receipt,dispose(){canvas.width=1;canvas.height=1;}};
  } finally {map?.remove();holder.remove();}
}
