/** Parametric superellipse corners, generated at the actual size (never stretched).
 * Cubic Hermite interpolation approximates the n=2.8 superellipse. End tangents
 * meet the straight sides; the same path is used for background, stroke and clip.
 */
export function continuousCornerPath(width:number,height:number,radius=24,smoothing=.7) {
  const r=Math.min(radius,width/2,height/2),n=2+Math.max(0,Math.min(1,smoothing))*1.8,p=2/n;
  const f=(t:number)=>({x:Math.pow(Math.sin(t*Math.PI/2),p),y:1-Math.pow(Math.cos(t*Math.PI/2),p)});
  const points=Array.from({length:13},(_,i)=>f(i/12));
  const corner=(cx:number,cy:number,signX:number,signY:number,rotate=false)=> {
    const pts=points.map(q=>({x:cx+signX*r*(rotate?q.y:q.x),y:cy+signY*r*(rotate?q.x:q.y)}));
    let s='';
    for(let i=0;i<pts.length-1;i++) {const a=pts[i],b=pts[i+1],prev=pts[Math.max(0,i-1)],next=pts[Math.min(pts.length-1,i+2)];let ax=(b.x-prev.x)/6,ay=(b.y-prev.y)/6,bx=(next.x-a.x)/6,by=(next.y-a.y)/6;
      if(i===0){if(rotate)ax=0;else ay=0;}if(i===pts.length-2){if(rotate)by=0;else bx=0;}
      s+=`C${(a.x+ax).toFixed(2)},${(a.y+ay).toFixed(2)} ${(b.x-bx).toFixed(2)},${(b.y-by).toFixed(2)} ${b.x.toFixed(2)},${b.y.toFixed(2)} `;
    }return s;
  };
  if(width<=0||height<=0)return '';
  return `M${r},0 H${width-r} ${corner(width-r,0,1,1)} V${height-r} ${corner(width,height-r,-1,1,true)} H${r} ${corner(r,height,-1,-1)} V${r} ${corner(0,r,1,-1,true)} Z`;
}
