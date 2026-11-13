import { addProtocol,type RequestParameters } from 'maplibre-gl';
import { ProviderRequestScheduler,PROVIDER_POLICIES,validateServiceURL,parseRetryAfter,type ProviderPolicy } from '../providers';
import type { MapSourceAdapter } from './style';
import { assertGlyphPbf } from './glyphs';

type ResourceResult={data:ArrayBuffer|string|object;cacheControl?:string|null;expires?:string|null};
type SharedProvider={scheduler:ProviderRequestScheduler;refs:number;cache:Map<string,{value:ResourceResult;expires:number;bytes:number}>;bytes:number};
const sharedProviders=new Map<string,SharedProvider>();
const managers=new Map<string,MapRequestManager>();
let nextManager=0;let protocolInstalled=false;

class MapRequestManager {
  readonly id=`map-${++nextManager}`;
  private lifecycle=new AbortController();
  private providers=new Map<string,{policy:ProviderPolicy;shared:SharedProvider}>();
  constructor(private source:MapSourceAdapter,private onFailure:(error:Error)=>void) {managers.set(this.id,this);}

  transformRequest=(url:string,resourceType?:string):RequestParameters=>{
    if(!/^https?:\/\//.test(url))return{url};
    validateServiceURL(url);
    return{url:`travelstudio://${this.id}/${resourceType??'resource'}/${encodeURIComponent(url)}`};
  };

  private provider(url:string):{policy:ProviderPolicy;shared:SharedProvider} {
    const origin=new URL(url).origin;
    const policy=origin==='https://tiles.mapterhorn.com'?PROVIDER_POLICIES.mapterhorn:origin==='https://elevation-tiles-prod.s3.amazonaws.com'?PROVIDER_POLICIES.aws:this.source.policy;
    const key=JSON.stringify(policy);
    if(!this.providers.has(key)){
      let shared=sharedProviders.get(key);
      if(!shared){shared={scheduler:new ProviderRequestScheduler(policy),refs:0,cache:new Map(),bytes:0};sharedProviders.set(key,shared);}
      shared.refs++;this.providers.set(key,{policy,shared});
    }
    return this.providers.get(key)!;
  }

  async request(parameters:RequestParameters,abortController:AbortController):Promise<ResourceResult> {
    const requestSignal=AbortSignal.any([abortController.signal,this.lifecycle.signal]);
    try {
    const prefix=`travelstudio://${this.id}/`;
    const [resourceType,encodedURL]=parameters.url.slice(prefix.length).split('/');
    const url=decodeURIComponent(encodedURL);validateServiceURL(url);
    const {policy,shared}=this.provider(url);
    const cacheKey=`${parameters.type}:${url}`;
    return await shared.scheduler.run(async signal=>{
      const cached=shared.cache.get(cacheKey);
      if(cached && cached.expires>Date.now())return structuredClone(cached.value);
      if(cached){shared.bytes-=cached.bytes;shared.cache.delete(cacheKey);}
      const response=await fetch(url,{method:'GET',signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]),
        credentials:'omit',cache:policy.cacheMode==='http'?'default':'no-store',referrerPolicy:'strict-origin-when-cross-origin'});
      if(response.url)validateServiceURL(response.url);
      if(response.status===429){const wait=parseRetryAfter(response.headers.get('Retry-After'));shared.scheduler.pauseFor(wait);throw new Error(`${policy.id}: HTTP 429，请在 ${Math.ceil(wait/1000)} 秒后重试`);}
      if(!response.ok)throw new Error(`${policy.id}: HTTP ${response.status} (${new URL(url).origin})`);
      const maxBytes=parameters.type==='json' || resourceType==='Glyphs'?2*1024*1024:16*1024*1024;
      if(Number(response.headers.get('Content-Length'))>maxBytes)throw new Error(`${policy.id}: 地图资源超过大小限制`);
      const bytes=await response.arrayBuffer();if(bytes.byteLength>maxBytes)throw new Error(`${policy.id}: 地图资源超过大小限制`);
      if(resourceType==='Glyphs')assertGlyphPbf(bytes);
      let data:ResourceResult['data']=bytes;
      if(parameters.type==='json'){
        data=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;
        // Relative tile URLs must resolve against the real TileJSON endpoint.
        const json=data as Record<string,unknown>;if(Array.isArray(json.tiles))json.tiles=json.tiles.map(tile=>typeof tile==='string'?new URL(tile,url).href:tile);
      }else if(parameters.type==='string')data=new TextDecoder().decode(bytes);
      const result:ResourceResult={data,cacheControl:policy.cacheMode==='http'?response.headers.get('Cache-Control'):'no-store',expires:policy.cacheMode==='http'?response.headers.get('Expires'):null};
      if(policy.cacheMode==='memory' && policy.cacheTTL>0){
        while(shared.cache.size>=256 || (shared.bytes+bytes.byteLength>64*1024*1024 && shared.cache.size)){
          const oldest=shared.cache.keys().next().value!;shared.bytes-=shared.cache.get(oldest)!.bytes;shared.cache.delete(oldest);
        }
        shared.cache.set(cacheKey,{value:structuredClone(result),expires:Date.now()+policy.cacheTTL,bytes:bytes.byteLength});shared.bytes+=bytes.byteLength;
      }
      return result;
    },requestSignal);
    } catch(error) {
      // MapLibre deliberately falls back to local fonts after a glyph request
      // failure. Export must see the failed request before that fallback hides it.
      if(!requestSignal.aborted)this.onFailure(error instanceof Error?error:new Error(String(error)));
      throw error;
    }
  }

  dispose():void {
    this.lifecycle.abort();
    managers.delete(this.id);
    for(const [key,{shared}] of this.providers){shared.refs--;if(shared.refs===0){shared.scheduler.dispose();shared.cache.clear();sharedProviders.delete(key);}}
    this.providers.clear();
  }
}

export function createMapRequestManager(source:MapSourceAdapter,onFailure:(error:Error)=>void):MapRequestManager {
  if(!protocolInstalled){
    addProtocol('travelstudio',async(parameters,abortController)=>{
      const id=parameters.url.slice('travelstudio://'.length).split('/')[0];const manager=managers.get(id);
      if(!manager)throw new DOMException('Map has been disposed','AbortError');
      return manager.request(parameters,abortController);
    });protocolInstalled=true;
  }
  return new MapRequestManager(source,onFailure);
}
