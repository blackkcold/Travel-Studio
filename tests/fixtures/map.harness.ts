import { createMapController,renderMapFrame,type MapFrame } from '../../src/map';
import { PhotonProvider,type PlaceCandidate } from '../../src/providers';
import { DEFAULT_CAMERA,emptyJourney,type JourneySnapshot,type CameraSpec } from '../../src/domain';
import 'maplibre-gl/dist/maplibre-gl.css';

const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const status=element<HTMLPreElement>('export-status');
const provider=new PhotonProvider();
let camera:CameraSpec={...DEFAULT_CAMERA,zoom:14.2,bearing:-15};
let journey:JourneySnapshot|undefined;
let exporting=false;
const controller=createMapController(element('map'),{camera,onError:e=>{if(!exporting)status.textContent=`地图资源错误：${e.code} ${e.details.join('; ')}`;}});

function makeJourney(candidates:PlaceCandidate[]):JourneySnapshot {
  const result=emptyJourney();const a=candidates[0],b=candidates[1] ?? a;
  result.sourceRevision=1;result.selectionRevision=1;result.order={mode:'manual',timeBasis:'recorded-local',orderedVisitIds:['visit-a1','visit-b','visit-a2'],unresolvedVisitIds:[]};
  result.selectedVisitIds=[...result.order.orderedVisitIds];result.explicitVisitIds=[...result.selectedVisitIds];
  result.resolvedVisits=[a,b,a].map((p,index)=>({id:result.selectedVisitIds[index],placeId:p.id,name:p.name,coordinate:p.coordinate,precision:p.precision,status:'confirmed',photoIds:[],time:{precision:'unknown',source:'unknown'},stableIndex:index}));
  result.route={kind:'itinerary',label:'测试行程示意',orderedVisitIds:[...result.selectedVisitIds],gaps:[],segments:[
    {id:'segment-ab',fromVisitId:'visit-a1',toVisitId:'visit-b',coordinates:[a.coordinate,b.coordinate]},
    {id:'segment-ba',fromVisitId:'visit-b',toVisitId:'visit-a2',coordinates:[b.coordinate,a.coordinate]},
  ]};
  return result;
}
element('search').addEventListener('click',async()=>{
  const query=element<HTMLInputElement>('query').value;
  element('search-status').textContent='正在请求真实 Photon 服务';
  try {
    const candidates=await provider.search(query);
    element('search-status').textContent=candidates.length ? `找到 ${candidates.length} 个候选`:'服务返回空候选，请使用较短地名或当地名称';
    element('candidates').textContent=candidates.map(p=>`${p.name} · ${p.city ?? ''} · ${p.sourceId} · ${p.coordinate.join(', ')}`).join('\n');
    if(!candidates.length)return;
    journey=makeJourney(candidates);camera={...camera,center:candidates[0].coordinate};controller.setCamera(camera);controller.setJourney(journey);
    element<HTMLButtonElement>('export-2d').disabled=false;element<HTMLButtonElement>('export-3d').disabled=false;
  }catch(error){element('search-status').textContent=`服务失败：${error instanceof Error?error.message:String(error)}`;}
});

function sampleColors(frame:MapFrame):number {
  const ctx=frame.canvas.getContext('2d')!;const {width,height}=frame.canvas;const unique=new Set<string>();
  for(let y=10;y<height;y+=Math.max(1,Math.floor(height/20)))for(let x=10;x<width;x+=Math.max(1,Math.floor(width/20))){const p=ctx.getImageData(x,y,1,1).data;unique.add(`${p[0]},${p[1]},${p[2]}`);}
  return unique.size;
}
async function runExport(terrain:boolean):Promise<void> {
  if(!journey || exporting)return;exporting=true;
  let preview:MapFrame|undefined;let output:MapFrame|undefined;
  status.textContent='准备冻结地图';element('receipt').textContent='';
  try {
    const canonical={...camera,terrain,pitch:terrain?55:0};
    preview=await renderMapFrame({camera:canonical,logicalWidth:1000,logicalHeight:700,pixelRatio:1,journey,showArrows:true,timeoutMs:90_000,onStage:s=>status.textContent=`预览：${s}`});
    output=await renderMapFrame({camera:preview.receipt.camera,logicalWidth:1000,logicalHeight:700,pixelRatio:4.096,journey,showArrows:true,timeoutMs:90_000,onStage:s=>status.textContent=`4096：${s}`});
    const deviation=Math.max(0,...preview.annotations.map((a,index)=>Math.hypot(a.x-output!.annotations[index].x,a.y-output!.annotations[index].y)));
    const receipt={preview:preview.receipt,output:output.receipt,projectionMaxDeviationLogicalPixels:deviation,distinctSampleColors:sampleColors(output),annotationOrder:output.annotations.map(a=>({visitId:a.visitId,number:a.number})),warning:'建筑高度为数据源值或估算；地图连线仅为行程示意。'};
    const png=output.canvas.toDataURL('image/png');
    element<HTMLImageElement>('output').src=png;
    const link=element<HTMLAnchorElement>('download');link.href=png;link.download=`travel-studio-${terrain?'terrain':'2d'}-4096.png`;link.hidden=false;
    element('receipt').textContent=JSON.stringify(receipt,null,2);status.textContent=`导出完成：${output.canvas.width} × ${output.canvas.height} PNG`;
  }catch(error){status.textContent=`导出失败：${error instanceof Error?error.message:String(error)}`;element<HTMLAnchorElement>('download').hidden=true;}
  finally{preview?.dispose();output?.dispose();exporting=false;}
}
element('export-2d').addEventListener('click',()=>void runExport(false));element('export-3d').addEventListener('click',()=>void runExport(true));
window.addEventListener('pagehide',()=>{provider.dispose();controller.dispose();});
