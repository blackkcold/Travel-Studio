import {describe,it,expect} from 'vitest';
import {solveAnnotationLayout,clipAnnotationSegment,type AnnotationLayoutInput} from '../src/composition/annotations';
import type {ProjectedGeoAnchor,SceneNode,Transform} from '../src/domain';

const frame:Transform={x:100,y:80,width:400,height:300,rotation:0};
const anchor=(id:string,x=200,y=150,photoIds:string[]=[],number:number|null=1):ProjectedGeoAnchor=>({visitId:id,number,name:id,x,y,visible:true,coordinate:[135,35],photoIds,precision:'exact'});
const photo=(id:string,photoId:string,transform:Partial<Transform>={},visitId?:string):SceneNode=>({id,kind:'photo',role:'photo',photoId,visitId,visible:true,zIndex:10,constraint:{position:'pinned',size:'fixed',crop:'fixed'},layoutParticipation:'flow',transform:{x:540,y:180,width:100,height:80,rotation:0,...transform}});
const input=(anchors:ProjectedGeoAnchor[],extra:Partial<AnnotationLayoutInput>={}):AnnotationLayoutInput=>({mapFrame:frame,viewport:{width:400,height:300},anchors,showNumbers:true,showNames:false,...extra});

describe('canonical annotation layout',()=>{
  it('maps integer projection into a fractional map frame without rewriting coordinates',()=>{
    const source=anchor('visit',200,150);const original=structuredClone(source);
    const output=solveAnnotationLayout(input([source],{mapFrame:{...frame,width:400.4,height:300.2}}));
    expect(output.badges[0].anchor.x).toBeCloseTo(200.2);expect(output.badges[0].anchor.y).toBeCloseTo(150.1);expect(source).toEqual(original);
  });
  it('retains confirmed unknown-time places with an explicit unknown ordinal and precision',()=>{
    const output=solveAnnotationLayout(input([{...anchor('unknown',200,150,[],null),precision:'city'}],{showNames:true}));
    expect(output.badges[0]).toMatchObject({number:null,text:'?',precision:'city'});expect(output.names[0].text).toContain('城市级');
  });
  it('keeps A-B-A visit identities and displaces badges rather than their geographic anchor',()=>{
    const anchors=[anchor('a1',200,150,[],1),anchor('b',80,80,[],2),anchor('a2',200,150,[],3)];
    const result=solveAnnotationLayout(input(anchors));expect(result.badges.map(b=>b.visitId)).toEqual(['a1','b','a2']);
    expect(result.badges[0].anchor).toEqual(result.badges[2].anchor);expect(result.badges[0].center).not.toEqual(result.badges[2].center);
    expect(result.leaders.find(l=>l.kind==='badge'&&l.visitId==='a2')?.anchor).toEqual({x:200,y:150});
  });
  it('binds a photograph only to frozen visit identity and never guesses among repeat visits',()=>{
    const anchors=[anchor('a1',200,150,['photo'],1),anchor('a2',200,150,['photo'],2)];
    const ambiguous=solveAnnotationLayout(input(anchors,{photoNodes:[photo('card','photo')]}));
    expect(ambiguous.photoBindings[0].status).toBe('ambiguous');expect(ambiguous.leaders.filter(l=>l.kind==='photo')).toEqual([]);
    const explicit=solveAnnotationLayout(input(anchors,{photoNodes:[photo('card','photo',{},'a2')]}));
    expect(explicit.photoBindings[0]).toMatchObject({status:'bound',visitId:'a2',number:2});
    const unlocated=solveAnnotationLayout(input(anchors,{photoNodes:[photo('card','different-photo')]}));expect(unlocated.photoBindings[0].status).toBe('unlocated');
  });
  it('transforms a rotated card into the rotated map frame and connects its nearest border',()=>{
    // This artwork point equals local map (200,150) under a 90 degree frame rotation.
    const rotated={...frame,rotation:90};const node=photo('card','p',{x:10,y:330,width:80,height:60,rotation:30});
    const result=solveAnnotationLayout(input([anchor('v',200,150,['p'])],{mapFrame:rotated,photoNodes:[node],showNumbers:false}));
    const binding=result.photoBindings[0];expect(binding.status).toBe('bound');expect(binding.anchor).toEqual({x:200,y:150});
    expect(binding.cardPoint).toBeDefined();expect(Number.isFinite(binding.cardPoint!.x)).toBe(true);
    expect(result.leaders[0]?.anchor).toEqual(binding.anchor);
  });
  it('clips leaders to the map edge while preserving the actual outside card endpoint',()=>{
    const result=solveAnnotationLayout(input([anchor('v',200,150,['p'])],{photoNodes:[photo('card','p')],showNumbers:false}));
    const leader=result.leaders.find(l=>l.kind==='photo')!;expect(leader.points.at(-1)!.x).toBeGreaterThan(frame.width);
    expect(leader.segments.at(-1)![1].x).toBe(frame.width);
    for(const segment of leader.segments)for(const point of segment){expect(point.x).toBeGreaterThanOrEqual(0);expect(point.x).toBeLessThanOrEqual(frame.width);expect(point.y).toBeGreaterThanOrEqual(0);expect(point.y).toBeLessThanOrEqual(frame.height);}
  });
  it('routes a photo leader around text and never draws through its reserved area',()=>{
    const obstacle={id:'message',transform:{x:350,y:195,width:60,height:70,rotation:0}};
    const result=solveAnnotationLayout(input([anchor('v',100,150,['p'])],{photoNodes:[photo('card','p',{y:210})],obstacles:[obstacle],showNumbers:false}));
    const leader=result.leaders.find(l=>l.kind==='photo')!;expect(leader).toBeDefined();expect(leader.points.length).toBeGreaterThan(2);
    const reserved={x:250,y:115,width:60,height:70};
    for(let i=1;i<leader.points.length;i++)expect(clipAnnotationSegment(leader.points[i-1],leader.points[i],reserved)).toBeUndefined();
  });
  it('never invents an edge anchor for a location outside the map and reports invalid explicit bindings',()=>{
    const result=solveAnnotationLayout(input([{...anchor('off',500,100,['p']),visible:false}],{photoNodes:[photo('one','p'),photo('two','p',{},'missing')]}));
    expect(result.badges).toEqual([]);expect(result.leaders).toEqual([]);expect(result.photoBindings.map(b=>b.status)).toEqual(['outside-map','invalid-explicit-binding']);
  });
  it('is deterministic and leaves pinned scene geometry untouched',()=>{
    const value=input([anchor('v',180,140,['p'])],{photoNodes:[photo('card','p')],showNames:true});const before=structuredClone(value);
    const first=solveAnnotationLayout(value),second=solveAnnotationLayout(value);expect(first).toEqual(second);expect(value).toEqual(before);
  });
});
