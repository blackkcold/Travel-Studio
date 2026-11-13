import type { ProjectedGeoAnchor, SceneNode, Transform, LocationPrecision } from '../domain';

export interface AnnotationPoint { x:number; y:number }
export interface AnnotationBounds { x:number; y:number; width:number; height:number }
export interface AnnotationObstacle { id:string; transform:Transform }
export interface AnnotationLeader {
  kind:'badge'|'photo'; visitId:string; nodeId?:string; photoId?:string;
  /** Original geographical screen anchor. It is never displaced by avoidance. */
  anchor:AnnotationPoint;
  /** Unclipped path in the map frame's local design coordinates. */
  points:AnnotationPoint[];
  /** Each visible segment is independently clipped to the map rectangle. */
  segments:Array<[AnnotationPoint,AnnotationPoint]>;
}
export interface AnnotationBadge {
  visitId:string; number:number|null; text:string; name:string; precision?:LocationPrecision;
  anchor:AnnotationPoint; center:AnnotationPoint; bounds:AnnotationBounds;
}
export interface AnnotationName {
  visitId:string; text:string; precisionLabel:string; bounds:AnnotationBounds;
}
export interface PhotoAnchorBinding {
  nodeId:string; photoId:string; visitId?:string; candidateVisitIds:string[];
  status:'bound'|'ambiguous'|'unlocated'|'outside-map'|'invalid-explicit-binding';
  number?:number|null; name?:string; precision?:LocationPrecision;
  anchor?:AnnotationPoint; cardPoint?:AnnotationPoint;
}
export interface AnnotationLayoutIssue { code:'BADGE_COLLISION'|'NAME_COLLISION'|'PHOTO_BINDING_AMBIGUOUS'|'INVALID_PHOTO_BINDING'|'LEADER_BLOCKED'; visitId?:string; nodeId?:string; message:string }
export interface AnnotationLayoutSnapshot {
  version:'1.0.0'; mapFrame:Transform; viewport:{width:number;height:number};
  badges:AnnotationBadge[]; names:AnnotationName[]; leaders:AnnotationLeader[];
  photoBindings:PhotoAnchorBinding[]; issues:AnnotationLayoutIssue[];
}
export interface AnnotationLayoutInput {
  mapFrame:Transform;
  /** MapLibre's integer canonical viewport, independent of display/export DPR. */
  viewport?:{width:number;height:number};
  anchors:readonly ProjectedGeoAnchor[];
  /** Pass only visible scene photo nodes. No live library records or cluster IDs. */
  photoNodes?:readonly SceneNode[];
  /** Visible title, date, message, legend and attribution nodes in artwork space. */
  obstacles?:readonly AnnotationObstacle[];
  showNumbers:boolean; showNames:boolean;
  /** The renderer may supply the measured 12px label width after its font barrier. */
  measureText?:(text:string)=>number;
}

const EPSILON=1e-7;
const copy=(p:AnnotationPoint):AnnotationPoint=>({x:p.x,y:p.y});
const compareId=(a:string,b:string)=>a===b?0:a<b?-1:1;
const distance=(a:AnnotationPoint,b:AnnotationPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const overlaps=(a:AnnotationBounds,b:AnnotationBounds)=>a.x<b.x+b.width-EPSILON && a.x+a.width>b.x+EPSILON && a.y<b.y+b.height-EPSILON && a.y+a.height>b.y+EPSILON;
const contains=(r:AnnotationBounds,p:AnnotationPoint)=>p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height;
const inflate=(r:AnnotationBounds,gap:number):AnnotationBounds=>({x:r.x-gap,y:r.y-gap,width:r.width+2*gap,height:r.height+2*gap});
function forward(point:AnnotationPoint,transform:Transform):AnnotationPoint {
  const angle=transform.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return{x:transform.x+point.x*c-point.y*s,y:transform.y+point.x*s+point.y*c};
}
function inverse(point:AnnotationPoint,transform:Transform):AnnotationPoint {
  const angle=-transform.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),x=point.x-transform.x,y=point.y-transform.y;
  return{x:x*c-y*s,y:x*s+y*c};
}
function polygon(transform:Transform,mapFrame:Transform,frame=0):AnnotationPoint[] {
  return[{x:-frame,y:-frame},{x:transform.width+frame,y:-frame},{x:transform.width+frame,y:transform.height+1.5*frame},{x:-frame,y:transform.height+1.5*frame}].map(p=>inverse(forward(p,transform),mapFrame));
}
function bounds(points:AnnotationPoint[]):AnnotationBounds {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
  return{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
}
function nearestBorder(point:AnnotationPoint,outline:AnnotationPoint[]):AnnotationPoint {
  let nearest=outline[0],best=Infinity;
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
    const candidate={x:a.x+t*dx,y:a.y+t*dy},d=distance(point,candidate);if(d<best){best=d;nearest=candidate;}
  }
  return copy(nearest);
}
function insidePolygon(point:AnnotationPoint,outline:AnnotationPoint[]):boolean {
  let positive=false,negative=false;
  for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length],cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);positive ||= cross>EPSILON;negative ||= cross<-EPSILON;}
  return !(positive&&negative);
}

/** Liang–Barsky clipping. All output coordinates remain in logical map units. */
export function clipAnnotationSegment(a:AnnotationPoint,b:AnnotationPoint,rectangle:AnnotationBounds):[AnnotationPoint,AnnotationPoint]|undefined {
  const dx=b.x-a.x,dy=b.y-a.y,p=[-dx,dx,-dy,dy],q=[a.x-rectangle.x,rectangle.x+rectangle.width-a.x,a.y-rectangle.y,rectangle.y+rectangle.height-a.y];
  let low=0,high=1;
  for(let i=0;i<4;i++){
    if(Math.abs(p[i])<EPSILON){if(q[i]<0)return;continue;}
    const t=q[i]/p[i];if(p[i]<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return;
  }
  const start={x:a.x+low*dx,y:a.y+low*dy},end={x:a.x+high*dx,y:a.y+high*dy};
  return distance(start,end)>EPSILON?[start,end]:undefined;
}
function crossesInterior(a:AnnotationPoint,b:AnnotationPoint,obstacle:AnnotationBounds):boolean {
  const inner={x:obstacle.x+EPSILON,y:obstacle.y+EPSILON,width:Math.max(0,obstacle.width-2*EPSILON),height:Math.max(0,obstacle.height-2*EPSILON)};
  return Boolean(clipAnnotationSegment(a,b,inner));
}
function pathClear(points:AnnotationPoint[],obstacles:AnnotationBounds[]):boolean {
  return points.slice(1).every((point,index)=>obstacles.every(obstacle=>!crossesInterior(points[index],point,obstacle)));
}
function routeLeader(start:AnnotationPoint,end:AnnotationPoint,obstacles:AnnotationBounds[]):AnnotationPoint[]|undefined {
  const candidates:AnnotationPoint[][]=[[start,end],[start,{x:end.x,y:start.y},end],[start,{x:start.x,y:end.y},end]];
  for(const obstacle of obstacles){
    const r=inflate(obstacle,1),corners=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];
    for(let i=0;i<4;i++){candidates.push([start,corners[i],end],[start,corners[i],corners[(i+1)%4],end],[start,corners[(i+1)%4],corners[i],end]);}
  }
  const valid=candidates.filter(path=>pathClear(path,obstacles));
  valid.sort((a,b)=>a.slice(1).reduce((n,p,i)=>n+distance(a[i],p),0)-b.slice(1).reduce((n,p,i)=>n+distance(b[i],p),0));
  return valid[0]?.filter((p,i,path)=>i===0||distance(p,path[i-1])>EPSILON).map(copy);
}
function addLeader(snapshot:AnnotationLayoutSnapshot,base:Omit<AnnotationLeader,'points'|'segments'>,end:AnnotationPoint,obstacles:AnnotationBounds[]):void {
  if(distance(base.anchor,end)<4)return;
  const points=routeLeader(base.anchor,end,obstacles);
  if(!points){snapshot.issues.push({code:'LEADER_BLOCKED',visitId:base.visitId,nodeId:base.nodeId,message:'引线无法避开文字，保留地点绑定并隐藏这条引线。'});return;}
  const clip={x:0,y:0,width:snapshot.mapFrame.width,height:snapshot.mapFrame.height};
  const segments=points.slice(1).flatMap((point,index)=>{const segment=clipAnnotationSegment(points[index],point,clip);return segment?[segment]:[];});
  if(segments.length)snapshot.leaders.push({...base,points,segments});
}
function precisionLabel(precision?:LocationPrecision):string {return precision==='city'?'城市级':precision==='region'?'区域级':precision==='street'?'街道级':precision==='unknown'?'精度未知':'';}
function offsets():AnnotationPoint[] {
  const result=[{x:0,y:0}];
  for(let radius=30;radius<=150;radius+=30)for(const [x,y]of [[0,-1],[1,0],[0,1],[-1,0],[.707,-.707],[.707,.707],[-.707,.707],[-.707,-.707]])result.push({x:x*radius,y:y*radius});
  return result;
}

/** Pure, deterministic composition snapshot. It never writes GPS, camera or scene transforms. */
export function solveAnnotationLayout(input:AnnotationLayoutInput):AnnotationLayoutSnapshot {
  const {mapFrame}=input,viewport=input.viewport??{width:Math.round(mapFrame.width),height:Math.round(mapFrame.height)};
  if(![mapFrame.x,mapFrame.y,mapFrame.width,mapFrame.height,mapFrame.rotation,viewport.width,viewport.height].every(Number.isFinite) || Math.min(mapFrame.width,mapFrame.height,viewport.width,viewport.height)<=0)throw new Error('注记地图视口无效');
  const snapshot:AnnotationLayoutSnapshot={version:'1.0.0',mapFrame:{...mapFrame},viewport:{...viewport},badges:[],names:[],leaders:[],photoBindings:[],issues:[]};
  const scaleX=mapFrame.width/viewport.width,scaleY=mapFrame.height/viewport.height;
  const anchors=input.anchors.map(anchor=>({...anchor,point:{x:anchor.x*scaleX,y:anchor.y*scaleY}}));
  const byVisit=new Map(anchors.map(anchor=>[anchor.visitId,anchor]));
  const inMap=(a:typeof anchors[number])=>a.visible&&Number.isFinite(a.point.x)&&Number.isFinite(a.point.y)&&a.point.x>=0&&a.point.y>=0&&a.point.x<=mapFrame.width&&a.point.y<=mapFrame.height;
  const photos=[...(input.photoNodes??[])].filter(node=>node.kind==='photo'&&node.photoId).sort((a,b)=>a.zIndex-b.zIndex||compareId(a.id,b.id));
  const photoOutlines=new Map(photos.map(node=>[node.id,polygon(node.transform,mapFrame,Math.max(5,Math.min(node.transform.width,node.transform.height)*.035))]));
  const textObstacles=(input.obstacles??[]).map(obstacle=>inflate(bounds(polygon(obstacle.transform,mapFrame)),4));
  const reserved=[...textObstacles,...[...photoOutlines.values()].map(outline=>inflate(bounds(outline),3))];
  const occupied:AnnotationBounds[]=[];
  const badgeOffsets=offsets();
  const ordered=anchors.filter(inMap).sort((a,b)=>(a.number??Infinity)-(b.number??Infinity)||compareId(a.visitId,b.visitId));
  for(const anchor of ordered){
    let center=copy(anchor.point);
    if(input.showNumbers){
      let placement:AnnotationBounds|undefined;
      for(const offset of badgeOffsets){
        const x=Math.max(13,Math.min(mapFrame.width-13,anchor.point.x+offset.x)),y=Math.max(13,Math.min(mapFrame.height-13,anchor.point.y+offset.y));
        const candidate={x:x-12,y:y-12,width:24,height:24};
        if(candidate.x<0||candidate.y<0||candidate.x+24>mapFrame.width||candidate.y+24>mapFrame.height)continue;
        if(![...reserved,...occupied].some(rect=>overlaps(inflate(candidate,2),rect))){placement=candidate;center={x,y};break;}
      }
      if(!placement){snapshot.issues.push({code:'BADGE_COLLISION',visitId:anchor.visitId,message:'没有足够空间显示地点编号；地理锚点与绑定保持不变。'});continue;}
      snapshot.badges.push({visitId:anchor.visitId,number:anchor.number,text:anchor.number===null?'?':String(anchor.number),name:anchor.name,precision:anchor.precision,anchor:copy(anchor.point),center,bounds:placement});
      const priorBadges=snapshot.badges.filter(badge=>badge.visitId!==anchor.visitId&&!contains(badge.bounds,anchor.point)).map(badge=>badge.bounds);
      addLeader(snapshot,{kind:'badge',visitId:anchor.visitId,anchor:copy(anchor.point)},center,[...textObstacles,...priorBadges,...snapshot.names.map(name=>name.bounds)]);occupied.push(placement);
    }
    if(input.showNames&&anchor.name){
      const characters=Array.from(anchor.name),name=characters.length>22?characters.slice(0,22).join('')+'…':anchor.name;
      const suffix=precisionLabel(anchor.precision),text=suffix?`${name} · ${suffix}`:name;
      const measured=input.measureText?.(text)??Array.from(text).reduce((width,char)=>width+(/[\u0000-\u007f]/.test(char)?6.6:12),0);
      const width=Math.min(mapFrame.width-8,Math.max(20,measured+12)),height=22;
      const positions=[{x:center.x+16,y:center.y-11},{x:center.x-width-16,y:center.y-11},{x:center.x-width/2,y:center.y+17},{x:center.x-width/2,y:center.y-39},{x:center.x+16,y:center.y+20},{x:center.x-width-16,y:center.y+20}];
      const candidates=positions.map(point=>({x:Math.max(4,Math.min(mapFrame.width-width-4,point.x)),y:Math.max(4,Math.min(mapFrame.height-height-4,point.y)),width,height}));
      const placement=candidates.find(candidate=>candidate.width>0&&candidate.height<=mapFrame.height&&!reserved.concat(occupied).some(rect=>overlaps(inflate(candidate,2),rect)));
      if(placement){snapshot.names.push({visitId:anchor.visitId,text,precisionLabel:suffix,bounds:placement});occupied.push(placement);}
      else snapshot.issues.push({code:'NAME_COLLISION',visitId:anchor.visitId,message:'地点名称空间不足，保留编号与冻结的地点名称。'});
    }
  }
  for(const node of photos){
    const candidates=anchors.filter(anchor=>anchor.photoIds?.includes(node.photoId!));
    const candidateVisitIds=[...new Set(candidates.map(anchor=>anchor.visitId))].sort();
    const binding:PhotoAnchorBinding={nodeId:node.id,photoId:node.photoId!,candidateVisitIds,status:'unlocated'};
    let anchor:typeof anchors[number]|undefined;
    if(node.visitId){anchor=byVisit.get(node.visitId);if(!anchor){binding.status='invalid-explicit-binding';snapshot.issues.push({code:'INVALID_PHOTO_BINDING',nodeId:node.id,visitId:node.visitId,message:'照片显式绑定的到访不在这份冻结地图中。'});}}
    else if(candidateVisitIds.length===1)anchor=byVisit.get(candidateVisitIds[0]);
    else if(candidateVisitIds.length>1){binding.status='ambiguous';snapshot.issues.push({code:'PHOTO_BINDING_AMBIGUOUS',nodeId:node.id,message:'照片属于多次到访，请明确选择一次到访；未自动猜测。'});}
    if(anchor){
      Object.assign(binding,{visitId:anchor.visitId,number:anchor.number,name:anchor.name,precision:anchor.precision,anchor:copy(anchor.point),status:inMap(anchor)?'bound':'outside-map'});
      if(inMap(anchor)){
        const outline=photoOutlines.get(node.id)!;const end=nearestBorder(anchor.point,outline);binding.cardPoint=end;
        if(!insidePolygon(anchor.point,outline)){
          const otherBadges=snapshot.badges.filter(badge=>badge.visitId!==anchor!.visitId&&!contains(badge.bounds,anchor!.point)).map(badge=>inflate(badge.bounds,2));
          const labels=snapshot.names.map(name=>inflate(name.bounds,2));
          addLeader(snapshot,{kind:'photo',visitId:anchor.visitId,nodeId:node.id,photoId:node.photoId!,anchor:copy(anchor.point)},end,[...textObstacles,...otherBadges,...labels]);
        }
      }
    }
    snapshot.photoBindings.push(binding);
  }
  return snapshot;
}
