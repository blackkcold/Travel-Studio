import { describe,it,expect,vi } from 'vitest';
import { PhotonProvider,parsePhotonResponse,parseRetryAfter,normalizeSearchQuery,PROVIDER_POLICIES,validateServiceURL,requestAIImage,ProviderRequestScheduler,requestAILocation,parseAILocationResponse,providerAttributionHTML,type AIRequest } from '../src/providers';

const fixture={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[135.7844389,34.994303]},properties:{osm_type:'W',osm_id:336641107,osm_key:'amenity',osm_value:'place_of_worship',type:'house',name:'清水寺',city:'京都市',country:'日本'}}]};
const json=()=>new Response(JSON.stringify(fixture),{headers:{'Content-Type':'application/json'}});
describe('provider response and consent boundaries',()=>{
  it('preserves original query, OSM identity, coordinates and candidate status',()=>{
    const result=parsePhotonResponse(fixture,'日本京都清水寺','2026-11-13T00:00:00Z');
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({sourceId:'W:336641107',originalInput:'日本京都清水寺',status:'candidate',precision:'exact',coordinate:[135.7844389,34.994303]});
  });
  it('does not accept malformed geometry or invent a point for missing coordinates',()=>{
    expect(parsePhotonResponse({features:[{...fixture.features[0],geometry:{type:'Point',coordinates:[200,90]}}]},'test')).toEqual([]);
    expect(()=>parsePhotonResponse({error:'bad'},'test')).toThrow();
    expect(parsePhotonResponse({features:[{...fixture.features[0],properties:{name:'unclassified',osm_type:'N',osm_id:1}}]},'test')[0].precision).toBe('unknown');
  });
  it('segments unspaced CJK words without a destination lookup or location substitution',()=>{
    expect(normalizeSearchQuery('日本京都清水寺')).toBe('日本 京都 清水寺');
    expect(normalizeSearchQuery('New York')).toBe('New York');
    expect(normalizeSearchQuery('  京都 清水寺  ')).toBe('京都 清水寺');
  });
  it('deduplicates queued requests through one cached result',async()=>{
    const fetcher=vi.fn(async()=>json());const provider=new PhotonProvider({fetch:fetcher as typeof fetch,minimumIntervalMs:0});
    const [a,b]=await Promise.all([provider.search('京都'),provider.search('京都')]);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(a).toEqual(b);a[0].name='changed';expect(b[0].name).toBe('清水寺');provider.dispose();
  });
  it('preserves each submitted original input when normalized results share a cache entry',async()=>{
    const fetcher=vi.fn(async()=>json());const provider=new PhotonProvider({fetch:fetcher as typeof fetch,minimumIntervalMs:0});
    await provider.search('京都清水寺');const result=await provider.search('京都 清水寺');
    expect(fetcher).toHaveBeenCalledTimes(1);expect(result[0].originalInput).toBe('京都 清水寺');provider.dispose();
  });
  it('stops on 429 and exposes Retry-After without rotating endpoints',async()=>{
    const fetcher=vi.fn(async()=>new Response('',{status:429,headers:{'Retry-After':'12'}}));const provider=new PhotonProvider({fetch:fetcher as typeof fetch,minimumIntervalMs:0});
    await expect(provider.search('京都')).rejects.toMatchObject({code:'RATE_LIMIT',retryAfterMs:12_000});expect(fetcher).toHaveBeenCalledTimes(1);provider.dispose();
  });
  it('rejects already aborted requests without touching network',async()=>{
    const fetcher=vi.fn(async()=>json());const provider=new PhotonProvider({fetch:fetcher as typeof fetch});const abort=new AbortController();abort.abort();
    await expect(provider.search('京都',{signal:abort.signal})).rejects.toMatchObject({code:'ABORTED'});expect(fetcher).not.toHaveBeenCalled();provider.dispose();
  });
  it('protects per-photo, per-provider, per-purpose AI consent',async()=>{
    const context={taskId:'t',projectId:'p',inputHash:'hash-a',generation:1,signal:new AbortController().signal};
    await expect(requestAIImage({providerId:'provider-a',purpose:'stylize',inputHash:'hash-a',image:new Blob(['photo']),prompt:'ink'},
      {providerId:'provider-a',purpose:'stylize',assetHashes:['hash-b'],grantedAt:'now'},context)).rejects.toMatchObject({code:'CONSENT_REQUIRED'});
  });
  it('disallows embedded secrets, unsafe schemes and unencrypted remote endpoints',()=>{
    for(const value of ['https://name:secret@example.com','javascript:alert(1)','http://example.com'])expect(()=>validateServiceURL(value)).toThrow();
    expect(validateServiceURL('http://127.0.0.1:8080').hostname).toBe('127.0.0.1');
  });
  it('distinguishes permitted exports from disabled tile bundling',()=>{
    expect(PROVIDER_POLICIES.openfreemap.exportAllowed).toBe(true);expect(PROVIDER_POLICIES.openfreemap.offlineAllowed).toBe(false);expect(PROVIDER_POLICIES.openfreemap.bundleAllowed).toBe(false);
    expect(parseRetryAfter('5')).toBe(5000);expect(parseRetryAfter('86400')).toBe(86_400_000);expect(parseRetryAfter('bad')).toBe(30_000);
  });
  it('keeps electronic license links and printable source URLs while escaping imported credits',()=>{
    expect(providerAttributionHTML(PROVIDER_POLICIES.openfreemap)).toContain('https://www.openstreetmap.org/copyright');
    expect(PROVIDER_POLICIES.aws.printAttribution.join(' ')).toContain('https://github.com/tilezen/joerd/blob/master/docs/attribution.md');
    expect(providerAttributionHTML({...PROVIDER_POLICIES.openfreemap,requiredAttribution:['<img src=x onerror=alert(1)>'],attributionURLs:[]})).not.toContain('<img');
  });
});

describe('shared provider request scheduling',()=>{
  it('bounds active work and never starts a cancelled queued request',async()=>{
    const scheduler=new ProviderRequestScheduler({id:'test',maxConcurrency:2,minimumIntervalMs:0});
    const started:string[]=[];const release:Array<()=>void>=[];
    const task=(name:string)=>scheduler.run(()=>new Promise<void>(resolve=>{started.push(name);release.push(resolve);}));
    const first=task('a'),second=task('b');const abort=new AbortController();
    const cancelled=scheduler.run(async()=>{started.push('cancelled');},abort.signal);const rejection=expect(cancelled).rejects.toMatchObject({code:'ABORTED'});
    const fourth=task('d');await vi.waitFor(()=>expect(started).toEqual(['a','b']));
    abort.abort();await rejection;release[0]();await vi.waitFor(()=>expect(started).toEqual(['a','b','d']));
    release[1]();release[2]();await Promise.all([first,second,fourth]);scheduler.dispose();
  });
  it('applies minimum intervals and a Retry-After pause without retrying failed work',async()=>{
    vi.useFakeTimers();vi.setSystemTime(0);
    const scheduler=new ProviderRequestScheduler({id:'test',maxConcurrency:1,minimumIntervalMs:1000});const starts:number[]=[];
    try {
      const first=scheduler.run(async()=>{starts.push(Date.now());scheduler.pauseFor(3000);throw new Error('429');});
      const rejection=expect(first).rejects.toThrow('429');
      const second=scheduler.run(async()=>{starts.push(Date.now());return'ok';});
      await vi.advanceTimersByTimeAsync(0);await rejection;expect(starts).toEqual([0]);
      await vi.advanceTimersByTimeAsync(2999);expect(starts).toEqual([0]);
      await vi.advanceTimersByTimeAsync(1);await expect(second).resolves.toBe('ok');expect(starts).toEqual([0,3000]);
    } finally {scheduler.dispose();vi.useRealTimers();}
  });
});

describe('separate AI location consent and provenance',()=>{
  const inputHash='a'.repeat(64);
  const request:AIRequest={providerId:'configured',purpose:'locate',inputHash,image:new Blob(['test image'],{type:'image/png'}),prompt:'仅建议可辨认的地点，不确定时返回空候选',model:'vision-model'};
  const response=()=>({providerId:'configured',model:'vision-model',inputHash,requiresConfirmation:true,candidates:[{name:'清水寺',coordinate:[135.7844389,34.994303],reason:'建筑外观可能相符，需要人工核验',status:'candidate',source:'configured',precision:'unknown'}]});
  const context=()=>({taskId:'task',projectId:'project',generation:1,inputHash,signal:new AbortController().signal});
  it('rejects reuse of styling consent before any upload',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    try{await expect(requestAILocation(request,{providerId:'configured',purpose:'stylize',assetHashes:[inputHash],grantedAt:'now'},context())).rejects.toMatchObject({code:'CONSENT_REQUIRED'});expect(fetcher).not.toHaveBeenCalled();}
    finally{vi.unstubAllGlobals();}
  });
  it('sends only the authorized request to the fixed gateway and returns candidates without confidence or confirmation',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(response()),{headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
    try{
      const result=await requestAILocation(request,{providerId:'configured',purpose:'locate',assetHashes:[inputHash],grantedAt:'now'},context());
      expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledWith('/api/ai/locate',expect.objectContaining({method:'POST',credentials:'same-origin'}));
      expect(result.candidates[0]).toMatchObject({status:'candidate',precision:'unknown',source:'ai',inputHash,providerId:'configured'});expect(result.requiresConfirmation).toBe(true);expect(result.candidates[0]).not.toHaveProperty('confidence');
    }finally{vi.unstubAllGlobals();}
  });
  it('rejects stale hashes, out-of-range coordinates and elevated confirmation status',()=>{
    expect(()=>parseAILocationResponse({...response(),inputHash:'b'.repeat(64)},request)).toThrow();
    for(const patch of [{coordinate:[200,30]},{status:'confirmed'},{precision:'exact'}]){const body=response();Object.assign(body.candidates[0],patch);expect(()=>parseAILocationResponse(body,request)).toThrow();}
    expect(parseAILocationResponse({...response(),candidates:[]},request).candidates).toEqual([]);
  });
});
