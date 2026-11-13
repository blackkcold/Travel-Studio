import { useLayoutEffect, useRef, useState } from 'react';
import type { ArtworkDocument, CameraSpec, TravelLibrary } from '../domain';
import type { MapSourceAdapter } from '../map';
import { Atlas } from './Atlas';

/** CSS scales the canonical viewport; it never changes the geographic camera's framing. */
export function MapFrameEditor({ art, camera, onCamera, library }: { art: ArtworkDocument; camera: CameraSpec; onCamera: (camera: CameraSpec) => void; library: TravelLibrary }) {
  const root=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:800,height:440});
  const map=art.nodes.find(node=>node.kind==='map');
  const width=Math.max(1,Math.round(map?.transform.width??600)),height=Math.max(1,Math.round(map?.transform.height??400));
  useLayoutEffect(()=>{if(!root.current)return;const element=root.current;const observer=new ResizeObserver(()=>setSize({width:element.clientWidth,height:element.clientHeight}));observer.observe(element);return()=>observer.disconnect();},[]);
  const scale=Math.min(size.width/width,size.height/height);
  return <div ref={root} className="frame-editor"><div className="frame-canonical" style={{width,height,left:(size.width-width*scale)/2,top:(size.height-height*scale)/2,transform:`scale(${scale})`}}><Atlas camera={camera} onCamera={onCamera} journey={art.journey} library={library} onSelect={()=>undefined} styleId={art.styleId} paletteId={art.paletteId} styleVersion={art.styleVersion} embeddedStyle={art.embeddedStyle} source={art.mapSource as unknown as MapSourceAdapter|undefined} frameMode/></div></div>;
}
