import type { StyleSpecification, LayerSpecification, RasterDEMSourceSpecification, ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type * as GeoJSON from 'geojson';
import type { CameraSpec, Coordinate, JourneySnapshot } from '../domain';
import { PROVIDER_POLICIES, validateServiceURL, type ProviderPolicy } from '../providers';

export interface MapArtRecipe {
  id?: string;
  land: string;
  water: string;
  park: string;
  road: string;
  roadCase: string;
  building: string;
  label: string;
  route: string;
  roadWidth?: number;
  labelDensity?: number;
  fontFamily?: string;
}
export const DEFAULT_MAP_RECIPE: MapArtRecipe = {
  id:'modern', land:'#f0eee7', water:'#a5c4ce', park:'#d6dfcb', road:'#fffef9',
  roadCase:'#ddd8cc', building:'#d5cebf', label:'#394953', route:'#7853b8', roadWidth:1, labelDensity:1,
};

export interface MapSourceAdapter {
  id: string;
  version: string;
  tileJSON: string;
  glyphs: string;
  layers: {landcover: string; landuse: string; water: string; waterway: string; transportation: string; building: string; place: string; boundary: string};
  fields: {name: string; englishName: string; class: string; height: string; minHeight: string; rank: string};
  policy: ProviderPolicy;
}
export const OPENFREEMAP_SOURCE: MapSourceAdapter = {
  id:'openfreemap', version:'openmaptiles-v3', tileJSON:'https://tiles.openfreemap.org/planet',
  glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers:{landcover:'landcover',landuse:'landuse',water:'water',waterway:'waterway',transportation:'transportation',building:'building',place:'place',boundary:'boundary'},
  fields:{name:'name',englishName:'name:latin',class:'class',height:'render_height',minHeight:'render_min_height',rank:'rank'},
  policy:PROVIDER_POLICIES.openfreemap,
};
export function validateMapSourceAdapter(adapter: MapSourceAdapter): void {
  validateServiceURL(adapter.tileJSON); validateServiceURL(adapter.glyphs.replace('{fontstack}','font').replace('{range}','0-255'));
  if (!adapter.id || !adapter.version || !Object.values(adapter.layers).every(v => /^[a-zA-Z0-9_-]+$/.test(v)) || !Object.values(adapter.fields).every(v => /^[a-zA-Z0-9_:.-]+$/.test(v))) throw new Error('地图数据映射缺失或无效');
  if (!Array.isArray(adapter.policy.requiredAttribution) || !adapter.policy.requiredAttribution.length || !adapter.policy.requiredAttribution.every(v=>typeof v==='string' && v.length>0) || !Array.isArray(adapter.policy.printAttribution) || !adapter.policy.printAttribution.length || !adapter.policy.printAttribution.every(v=>typeof v==='string' && v.length>0) || !adapter.policy.policyURL || !adapter.policy.reviewedAt) throw new Error('地图来源必须声明署名与政策版本');
  validateServiceURL(adapter.policy.policyURL);
  for(const key of ['offlineAllowed','bundleAllowed','snapshotBundleAllowed','exportAllowed','publicService'] as const)if(typeof adapter.policy[key]!=='boolean')throw new Error('地图来源能力政策必须显式声明');
  if(!['http','memory','none'].includes(adapter.policy.cacheMode) || !Number.isFinite(adapter.policy.cacheTTL) || adapter.policy.cacheTTL<0 || !Number.isInteger(adapter.policy.maxConcurrency) || adapter.policy.maxConcurrency<1 || adapter.policy.maxConcurrency>8)throw new Error('地图缓存或并发政策无效');
}

/** Declarative provider manifests carry complete schema/attribution mapping, never executable code. */
export function mapSourceFromManifest(manifest: unknown): MapSourceAdapter {
  if (!manifest || typeof manifest !== 'object') throw new Error('地图扩展声明无效');
  const value = manifest as Record<string,unknown>;
  if (value.kind !== 'map-provider' || !value.recipe || typeof value.recipe !== 'object') throw new Error('请选择地图 Provider 类型的声明式扩展');
  const recipe = value.recipe as Record<string,unknown>;
  const candidate = {...recipe,id:recipe.id ?? value.id,version:recipe.version ?? value.version} as unknown as MapSourceAdapter;
  if (!candidate.layers || !candidate.fields || !candidate.policy || typeof candidate.tileJSON !== 'string' || typeof candidate.glyphs !== 'string') throw new Error('地图扩展需提供 tileJSON、glyphs、layers、fields 和 policy 完整映射');
  const requiredLayers = Object.keys(OPENFREEMAP_SOURCE.layers) as Array<keyof MapSourceAdapter['layers']>;
  const requiredFields = Object.keys(OPENFREEMAP_SOURCE.fields) as Array<keyof MapSourceAdapter['fields']>;
  if(requiredLayers.some(key=>typeof candidate.layers[key] !== 'string') || requiredFields.some(key=>typeof candidate.fields[key] !== 'string')) throw new Error('地图 schema 映射缺少必要字段');
  validateMapSourceAdapter(candidate);
  return structuredClone(candidate);
}

export function terrainSource(provider: CameraSpec['terrainProvider']): RasterDEMSourceSpecification {
  return provider === 'aws' ? {
    type:'raster-dem', tiles:['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'], tileSize:256, encoding:'terrarium', maxzoom:15,
    attribution:'Terrain Tiles / Mapzen · <a href="https://registry.opendata.aws/terrain-tiles/">sources</a>',
  } : {
    type:'raster-dem', url:'https://tiles.mapterhorn.com/tilejson.json', tileSize:512, encoding:'terrarium', maxzoom:14,
    attribution:'<a href="https://mapterhorn.com/attribution/">Terrain © Mapterhorn / source providers</a>',
  };
}

const emptyCollection = () => ({type:'FeatureCollection' as const, features:[]});
export function routeGeoJSON(journey?: JourneySnapshot): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {type:'FeatureCollection',features:(journey?.route.segments ?? []).filter(s => s.coordinates.length >= 2).map(s => ({type:'Feature',id:s.id,
    properties:{fromVisitId:s.fromVisitId,toVisitId:s.toVisitId,kind:journey!.route.kind}, geometry:{type:'LineString',coordinates:s.coordinates}}))};
}
export function visitGeoJSON(journey?: JourneySnapshot): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const order = journey?.order.orderedVisitIds ?? [];
  return {type:'FeatureCollection',features:(journey?.resolvedVisits ?? []).filter(v => v.coordinate && v.status === 'confirmed').map(v => ({
    type:'Feature',id:v.id,properties:{visitId:v.id,name:v.name,number:order.includes(v.id) ? order.indexOf(v.id)+1 : '?', selected:true},
    geometry:{type:'Point',coordinates:v.coordinate!},
  }))};
}

export interface AtlasPhotoPoint { id: string; coordinate: Coordinate; selected?: boolean; name?: string; thumbnailURL?: string }
export function photoGeoJSON(photos: AtlasPhotoPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const unique = new Map(photos.map(p => [p.id,p]));
  return {type:'FeatureCollection',features:[...unique.values()].map(p => ({type:'Feature',id:p.id,
    properties:{photoId:p.id,name:p.name ?? '',selected:Boolean(p.selected)}, geometry:{type:'Point',coordinates:p.coordinate}}))};
}

export interface MapStyleOptions {
  camera: CameraSpec;
  recipe?: MapArtRecipe;
  source?: MapSourceAdapter;
  journey?: JourneySnapshot;
  showRoute?: boolean;
  showArrows?: boolean;
  showStops?: boolean;
  photoPoints?: AtlasPhotoPoint[];
}

/** Semantic vector styling; image filters never alter the underlying geography. */
export function compileMapStyle(options: MapStyleOptions): StyleSpecification {
  const p = {...DEFAULT_MAP_RECIPE, ...options.recipe};
  const a = options.source ?? OPENFREEMAP_SOURCE;
  validateMapSourceAdapter(a);
  const f = a.fields; const l = a.layers;
  const width = Math.min(2,Math.max(.45,p.roadWidth ?? 1));
  const density = Math.min(2,Math.max(.35,p.labelDensity ?? 1));
  const font = [p.fontFamily || 'Noto Sans Regular'];
  const lineWidth = ['interpolate',['linear'],['zoom'],5,.3*width,10,.8*width,15,3*width,19,12*width];
  const layers: LayerSpecification[] = [
    {id:'land',type:'background',paint:{'background-color':p.land}},
    {id:'landcover',type:'fill',source:'basemap','source-layer':l.landcover,paint:{'fill-color':p.park,'fill-opacity':.45}},
    {id:'parks',type:'fill',source:'basemap','source-layer':l.landuse,filter:['in',['get',f.class],['literal',['park','cemetery','recreation_ground','garden','forest']]],paint:{'fill-color':p.park,'fill-opacity':.7}},
    {id:'water',type:'fill',source:'basemap','source-layer':l.water,paint:{'fill-color':p.water}},
    {id:'waterways',type:'line',source:'basemap','source-layer':l.waterway,paint:{'line-color':p.water,'line-width':['interpolate',['linear'],['zoom'],8,.7,14,2,18,5]}},
    {id:'boundaries',type:'line',source:'basemap','source-layer':l.boundary,minzoom:2,paint:{'line-color':p.label,'line-opacity':.24,'line-width':.7,'line-dasharray':[3,2]}},
    {id:'road-case',type:'line',source:'basemap','source-layer':l.transportation,filter:['!=',['get',f.class],'rail'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':p.roadCase,'line-width':['interpolate',['linear'],['zoom'],5,.7*width,10,1.5*width,15,4.5*width,19,14*width]}},
    {id:'roads',type:'line',source:'basemap','source-layer':l.transportation,filter:['!=',['get',f.class],'rail'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':p.road,'line-width':lineWidth as ExpressionSpecification}},
    {id:'railways',type:'line',source:'basemap','source-layer':l.transportation,filter:['==',['get',f.class],'rail'],minzoom:10,paint:{'line-color':p.label,'line-width':.8,'line-opacity':.45,'line-dasharray':[2,2]}},
    {id:'buildings-flat',type:'fill',source:'basemap','source-layer':l.building,minzoom:12,layout:{visibility:options.camera.terrain ? 'none':'visible'},paint:{'fill-color':p.building,'fill-opacity':.72,'fill-outline-color':p.roadCase}},
    {id:'buildings-3d',type:'fill-extrusion',source:'basemap','source-layer':l.building,minzoom:13,layout:{visibility:options.camera.terrain ? 'visible':'none'},paint:{
      'fill-extrusion-color':p.building,'fill-extrusion-height':['case',['has',f.height],['to-number',['get',f.height]],['has','building:levels'],['*',['to-number',['get','building:levels']],3],9],
      'fill-extrusion-base':['coalesce',['to-number',['get',f.minHeight]],0],'fill-extrusion-opacity':.85}},
    {id:'place-labels',type:'symbol',source:'basemap','source-layer':l.place,layout:{
      'text-field':['coalesce',['get',f.name],['get',f.englishName],''],'text-font':font,
      'text-size':['interpolate',['linear'],['zoom'],2,11,8,12,14,14],'text-padding':Math.round(15/density),'text-max-width':8,
      'text-allow-overlap':false,'symbol-sort-key':['coalesce',['get',f.rank],10],
    },paint:{'text-color':p.label,'text-halo-color':p.land,'text-halo-width':1.5}},
    {id:'journey-casing',type:'line',source:'journey',layout:{'line-cap':'round','line-join':'round',visibility:options.showRoute === false ? 'none':'visible'},paint:{'line-color':'#ffffff','line-opacity':.86,'line-width':6}},
    {id:'journey-line',type:'line',source:'journey',layout:{'line-cap':'round','line-join':'round',visibility:options.showRoute === false ? 'none':'visible'},paint:{'line-color':p.route,'line-width':3}},
    {id:'journey-arrows',type:'symbol',source:'journey',layout:{'symbol-placement':'line','symbol-spacing':120,'text-field':'›','text-font':font,'text-size':23,'text-keep-upright':false,'text-rotation-alignment':'map','text-allow-overlap':true,visibility:options.showRoute === false || options.showArrows === false ? 'none':'visible'},paint:{'text-color':p.route,'text-halo-color':'#ffffff','text-halo-width':1}},
    {id:'visit-points',type:'circle',source:'visits',layout:{visibility:options.showStops === false?'none':'visible'},paint:{'circle-radius':11,'circle-color':p.route,'circle-stroke-color':'#ffffff','circle-stroke-width':3}},
    {id:'visit-numbers',type:'symbol',source:'visits',layout:{'text-field':['to-string',['get','number']],'text-font':font,'text-size':11,'text-allow-overlap':true,visibility:options.showStops === false?'none':'visible'},paint:{'text-color':'#ffffff'}},
    {id:'photo-clusters',type:'circle',source:'photos',filter:['has','point_count'],paint:{'circle-color':p.route,'circle-radius':['step',['get','point_count'],17,10,21,100,26],'circle-stroke-color':'#ffffff','circle-stroke-width':3}},
    {id:'photo-counts',type:'symbol',source:'photos',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':font,'text-size':12},paint:{'text-color':'#ffffff'}},
    {id:'photo-points',type:'circle',source:'photos',filter:['!', ['has','point_count']],paint:{'circle-color':['case',['get','selected'],p.route,p.roadCase],'circle-radius':7,'circle-stroke-color':'#ffffff','circle-stroke-width':2}},
  ];
  const style: StyleSpecification = {
    version:8, name:`Travel Studio / ${p.id ?? 'custom'}`, glyphs:a.glyphs,
    sources:{
      basemap:{type:'vector',url:a.tileJSON,attribution:a.policy.requiredAttribution.join(' · ')},
      journey:{type:'geojson',data:routeGeoJSON(options.journey)},visits:{type:'geojson',data:visitGeoJSON(options.journey)},
      photos:{type:'geojson',data:options.photoPoints ? photoGeoJSON(options.photoPoints):emptyCollection(),cluster:true,clusterRadius:44,clusterMaxZoom:16},
    },layers,projection:{type:options.camera.projection},transition:{duration:0,delay:0},
  };
  if (options.camera.terrain) {
    style.sources.terrain = terrainSource(options.camera.terrainProvider);
    style.terrain = {source:'terrain',exaggeration:options.camera.exaggeration};
  }
  return style;
}
