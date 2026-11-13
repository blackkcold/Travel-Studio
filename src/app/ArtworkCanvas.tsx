import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Shape, Rect, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { ArtworkDocument, Transform } from '../domain';
import { renderArtwork, isNodeVisible, snapTransform, type CompositionResources } from '../composition';
import { prepareResources, mapSnapshotInputHash, type PreparedResources } from '../export';
import { useServices, useAssetURL } from './context';
import { artworkPreviewKey } from './snapshots';
import { Button } from '../ui';

export function ArtworkCanvas({artwork,selectedId,onSelect,onTransform,zoom,onZoom,pan={x:0,y:0},onPan,snap=true,onStatus}:{artwork:ArtworkDocument;selectedId?:string;onSelect:(id?:string)=>void;onTransform:(transforms:Record<string,Transform>)=>void;zoom:number;onZoom:(n:number)=>void;pan?:{x:number;y:number};onPan?:(point:{x:number;y:number})=>void;snap?:boolean;onStatus?:(ready:boolean)=>void}){
  const services=useServices(),container=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:900,height:700}),[prepared,setPrepared]=useState<PreparedResources>(),[phase,setPhase]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0),[readyKey,setReadyKey]=useState(''),[usingSaved,setUsingSaved]=useState(false),[panning,setPanning]=useState(false);
  const previewURL=useAssetURL(artwork.previewAssetId);
  const [live,setLive]=useState<Record<string,Transform>>({}),[multi,setMulti]=useState<string[]>([]),refs=useRef(new Map<string,Konva.Rect>()),transformer=useRef<Konva.Transformer>(null);
  const dragStart=useRef<Record<string,Transform>>({});
  const preparedRef=useRef<PreparedResources | undefined>(undefined);const status=useRef(onStatus);status.current=onStatus;
  useLayoutEffect(()=>{const e=container.current;if(!e)return;const o=new ResizeObserver(()=>setSize({width:e.clientWidth,height:e.clientHeight}));o.observe(e);return()=>o.disconnect();},[]);
  const resourceKey=JSON.stringify([artwork.id,artwork.styleId,artwork.styleVersion,artwork.embeddedStyle,artwork.mapSource,artwork.paletteId,artwork.canonicalCamera,artwork.journey,artwork.visibility.map,artwork.visibility.route,artwork.visibility.arrows,artwork.nodes.filter(n=>['map','photo'].includes(n.kind)).map(n=>[n.id,n.visible,n.transform.width,n.transform.height,n.assetId,n.photoEdit]),retry]);
  useEffect(()=>{
    const abort=new AbortController();let ended=false;
    setPhase('准备作品');setError('');setUsingSaved(false);status.current?.(false);
    const timer=setTimeout(()=>{void (async()=>{
      let result:PreparedResources;
      try { result=await prepareResources(artwork,services.rendering,1,abort.signal,setPhase,!navigator.onLine&&!!artwork.mapSnapshotAssetId); }
      catch(originalError) {
        const saved=services.document.document.artworks.find(item=>item.id===artwork.id);
        if(abort.signal.aborted||!saved?.mapSnapshotAssetId||saved.mapSnapshot?.inputHash!==mapSnapshotInputHash(artwork))throw originalError;
        result=await prepareResources({...artwork,mapSnapshot:saved.mapSnapshot,mapSnapshotAssetId:saved.mapSnapshotAssetId},services.rendering,1,abort.signal,setPhase,true);
      }
      if(ended){result.dispose();return;}
      preparedRef.current?.dispose();preparedRef.current=result;setPrepared(result);setReadyKey(resourceKey);setPhase('');setUsingSaved(result.mapMode==='saved-snapshot');status.current?.(true);
    })().catch(e=>{if(!ended){setError(e instanceof Error?e.message:'预览失败');setPhase('');status.current?.(false);}});},120);
    return()=>{ended=true;clearTimeout(timer);abort.abort();};
  },[resourceKey,services]);
  const previewKey=artworkPreviewKey(artwork);
  useEffect(()=>{if(!prepared||readyKey!==resourceKey||phase||error)return;const timer=setTimeout(()=>{void services.snapshots.savePreview(artwork,prepared.resources).catch(()=>undefined);},500);return()=>clearTimeout(timer);},[previewKey,readyKey,resourceKey,prepared,phase,error,services]);
  useEffect(()=>()=>{preparedRef.current?.dispose();},[]);
  const current=useMemo(()=>({...artwork,nodes:artwork.nodes.map(n=>live[n.id]?{...n,transform:live[n.id]}:n)}),[artwork,live]);
  const resources:CompositionResources=prepared?.resources??{photos:new Map(),attributions:[]},margin=36;
  const fit=Math.min((size.width-50)/(artwork.artboard.width+72),(size.height-45)/(artwork.artboard.height+72)),scale=Math.max(.1,fit*zoom),offset={x:(size.width-(artwork.artboard.width+72)*scale)/2+pan.x,y:(size.height-(artwork.artboard.height+72)*scale)/2+pan.y};
  const selectable=artwork.nodes.filter(n=>isNodeVisible(n,artwork)&&['photo','map','text','decoration'].includes(n.kind)&&!n.locked&&n.role!=='border');
  const ids=multi.includes(selectedId??'')?multi:selectedId?[selectedId]:[];
  useEffect(()=>{const nodes=ids.map(id=>refs.current.get(id)).filter((n):n is Konva.Rect=>!!n);transformer.current?.nodes(nodes);transformer.current?.getLayer()?.batchDraw();},[ids.join(','),artwork.nodes]);
  const commit=()=>{const changes:Record<string,Transform>={};for(const id of ids){const r=refs.current.get(id);if(!r)continue;const w=Math.max(35,r.width()*r.scaleX()),h=Math.max(30,r.height()*r.scaleY());changes[id]=snapTransform({x:r.x()-margin,y:r.y()-margin,width:w,height:h,rotation:r.rotation()},artwork.artboard.width,artwork.artboard.height,snap);r.scaleX(1);r.scaleY(1);}setLive({});onTransform(changes);};
  const gesture=useRef<{distance:number;zoom:number} | undefined>(undefined);
  return <div ref={container} className="artwork-canvas" tabIndex={0} aria-label="作品画布，选择元素后可用方向键微调" onKeyDown={e=>{if(ids.length&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const delta=e.shiftKey?10:1;onTransform(Object.fromEntries(ids.flatMap(id=>{const n=artwork.nodes.find(n=>n.id===id);if(!n)return[];return[[id,{...n.transform,x:n.transform.x+(e.key==='ArrowRight'?delta:e.key==='ArrowLeft'?-delta:0),y:n.transform.y+(e.key==='ArrowDown'?delta:e.key==='ArrowUp'?-delta:0)}]];})));}}}>
    <Stage width={size.width} height={size.height} x={offset.x} y={offset.y} scaleX={scale} scaleY={scale} draggable={panning} onMouseDown={e=>{if(e.target===e.target.getStage()){onSelect(undefined);setMulti([]);setPanning(true);e.target.startDrag();}}} onTouchStart={e=>{if(e.evt.touches.length===1&&e.target===e.target.getStage()){onSelect(undefined);setMulti([]);setPanning(true);e.target.startDrag();}}} onDragEnd={e=>{if(e.target===e.target.getStage()){setPanning(false);onPan?.({x:pan.x+e.target.x()-offset.x,y:pan.y+e.target.y()-offset.y});}}} onWheel={e=>{if(e.evt.ctrlKey||e.evt.metaKey){e.evt.preventDefault();onZoom(Math.min(2.5,Math.max(.4,zoom-e.evt.deltaY*.002)));}}} onTouchMove={e=>{if(e.evt.touches.length===2){e.evt.preventDefault();e.target.getStage()?.stopDrag();setPanning(false);const[a,b]=[e.evt.touches[0],e.evt.touches[1]],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);if(!gesture.current)gesture.current={distance:d,zoom};onZoom(Math.min(2.5,Math.max(.4,gesture.current.zoom*d/gesture.current.distance)));}}} onTouchEnd={()=>{gesture.current=undefined;}}>
      <Layer><Shape listening={false} sceneFunc={context=>{renderArtwork(context._context,current,resources,{intent:'presentation',transparent:true,margin});}}/>
        {selectable.map(n=><Rect key={n.id} ref={r=>{if(r)refs.current.set(n.id,r);else refs.current.delete(n.id);}} x={n.transform.x+margin} y={n.transform.y+margin} width={n.transform.width} height={n.transform.height} rotation={n.transform.rotation} fill="transparent" draggable onClick={e=>{if(e.evt.shiftKey){const next=[...new Set([...ids,n.id])];setMulti(next);}else setMulti([n.id]);onSelect(n.id);}} onTap={()=>{setMulti([n.id]);onSelect(n.id);}} onDragStart={()=>{const group=ids.includes(n.id)?ids:[n.id];if(!ids.includes(n.id)){setMulti([n.id]);onSelect(n.id);}dragStart.current=Object.fromEntries(group.flatMap(id=>{const item=artwork.nodes.find(x=>x.id===id);return item?[[id,{...item.transform}]]:[];}));}} onDragMove={e=>{const r=e.target,origin=dragStart.current[n.id]??n.transform,dx=r.x()-margin-origin.x,dy=r.y()-margin-origin.y;const next=Object.fromEntries(Object.entries(dragStart.current).map(([id,t])=>[id,{...t,x:t.x+dx,y:t.y+dy}]));for(const[id,t]of Object.entries(next)){if(id!==n.id)refs.current.get(id)?.position({x:t.x+margin,y:t.y+margin});}setLive(next);}} onDragEnd={e=>{e.cancelBubble=true;const r=e.target,origin=dragStart.current[n.id]??n.transform,dx=r.x()-margin-origin.x,dy=r.y()-margin-origin.y;const adjusted=snapTransform({...origin,x:origin.x+dx,y:origin.y+dy},artwork.artboard.width,artwork.artboard.height,snap);const changes=Object.fromEntries(Object.entries(dragStart.current).map(([id,t])=>[id,{...t,x:t.x+adjusted.x-origin.x,y:t.y+adjusted.y-origin.y}]));setLive({});onTransform(changes);}} onTransformEnd={commit}/>)}
        <Transformer ref={transformer} rotateEnabled keepRatio={false} flipEnabled={false} enabledAnchors={['top-left','top-right','bottom-left','bottom-right','middle-left','middle-right','top-center','bottom-center']} anchorSize={9} anchorCornerRadius={3} borderStroke="#8261be" anchorStroke="#8261be" anchorFill="#fff" boundBoxFunc={(old,next)=>next.width<35||next.height<30?old:next}/>
      </Layer>
    </Stage>
    <div className="canvas-caption"><span>{artwork.name}</span>{usingSaved&&<span>使用保存的地图快照</span>}<span>修订 {artwork.journey.selectionRevision} · {artwork.artboard.width} × {Math.round(artwork.artboard.height)}</span></div>
    {phase&&<div className="render-status" role="status"><span className="loading-dot"/>{phase}</div>}
    {error&&previewURL&&<img className="saved-artwork-preview" src={previewURL} alt="已保存作品的完整预览"/>}
    {error&&<div className="render-error" role="alert"><strong>预览未完成</strong><p>{error}</p><Button onClick={()=>setRetry(n=>n+1)}>重试</Button><small>已保存预览可供查看；重新渲染需要匹配的完整资源。</small></div>}
  </div>;
}
