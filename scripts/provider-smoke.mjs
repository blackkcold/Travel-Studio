/** Low-frequency real-service smoke. Fixtures are not used here. Run explicitly. */
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const timestamp=new Date().toISOString();
const evidence={timestamp,kind:'live-public-provider-smoke',node:process.version,results:[]};
async function get(url,label) {
  const start=performance.now();
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(30_000),headers:{'User-Agent':'Travel-Studio/1.0.0 (+https://github.com/blackkcold/Travel-Studio)','Accept':'application/json,image/*;q=0.9,*/*;q=0.1'},redirect:'error'});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const result={label,url,status:response.status,contentType:response.headers.get('content-type'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),durationMs:Math.round(performance.now()-start),ok:response.ok};
    evidence.results.push(result);
    if(!response.ok)throw new Error(`${label}: HTTP ${response.status}`);
    return {result,bytes};
  } catch(error) {
    if(!evidence.results.some(r=>r.label===label))evidence.results.push({label,url,ok:false,error:error.message,durationMs:Math.round(performance.now()-start)});
    return undefined;
  }
}
function json(response){if(!response)return;return JSON.parse(new TextDecoder().decode(response.bytes));}
function normalize(query) {
  const words=[];
  for(const part of new Intl.Segmenter('zh',{granularity:'word'}).segment(query)) {
    if(!part.isWordLike)continue;
    if([...part.segment].length===1 && /\p{Script=Han}/u.test(part.segment) && words.length)words[words.length-1]+=part.segment;
    else words.push(part.segment);
  }
  return words.join(' ');
}
const rawQuery='日本京都清水寺';
const raw=json(await get(`https://photon.komoot.io/api/?q=${encodeURIComponent(rawQuery)}&limit=5`,'Photon original text'));
if(raw)evidence.results.at(-1).candidates=raw.features.map(f=>({name:f.properties.name,city:f.properties.city,coordinate:f.geometry.coordinates,sourceId:`${f.properties.osm_type}:${f.properties.osm_id}`}));
await new Promise(r=>setTimeout(r,1300));
const normalized=normalize(rawQuery);
const response=json(await get(`https://photon.komoot.io/api/?q=${encodeURIComponent(normalized)}&limit=5`,'Photon Unicode-normalized query'));
if(response)evidence.results.at(-1).candidates=response.features.map(f=>({name:f.properties.name,city:f.properties.city,coordinate:f.geometry.coordinates,sourceId:`${f.properties.osm_type}:${f.properties.osm_id}`}));
const candidate=response?.features.find(f=>f.geometry?.type==='Point');
const vector=json(await get('https://tiles.openfreemap.org/planet','OpenFreeMap TileJSON'));
const dem=json(await get('https://tiles.mapterhorn.com/tilejson.json','Mapterhorn TileJSON'));
if(dem)evidence.results.at(-1).encoding={encoding:dem.encoding,tileSize:dem.tileSize};
if(candidate) {
  const [longitude,latitude]=candidate.geometry.coordinates;const z=12,n=2**z;
  const x=Math.floor((longitude+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(latitude*Math.PI/180))/Math.PI)/2*n);
  const replace=template=>template.replace('{z}',z).replace('{x}',x).replace('{y}',y);
  if(vector?.tiles?.[0])await get(replace(vector.tiles[0]),'OpenFreeMap live vector tile at searched candidate');
  if(dem?.tiles?.[0])await get(replace(dem.tiles[0]),'Mapterhorn live DEM tile at searched candidate');
}
await get('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf','Map glyph resource');
evidence.passed=evidence.results.every(r=>r.ok) && Boolean(candidate);
evidence.queryNormalization={input:rawQuery,submitted:normalized,method:'Intl.Segmenter word boundaries; single Han suffix joins preceding token',rawCount:raw?.features.length,normalizedCount:response?.features.length};
evidence.limits='HTTP checks prove endpoint/data availability only. Real WebGL terrain, exact camera and output resolution are tested separately.';
await mkdir('test-results',{recursive:true});await writeFile('test-results/provider-smoke.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));if(!evidence.passed)process.exitCode=1;
