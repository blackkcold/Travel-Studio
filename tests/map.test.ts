import { describe,it,expect } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { PbfWriter } from 'pbf';
import { compileMapStyle,DEFAULT_MAP_RECIPE,photoGeoJSON,routeGeoJSON,visitGeoJSON,terrainSource,validateRenderDimensions,OPENFREEMAP_SOURCE,validateMapSourceAdapter,assertGlyphPbf } from '../src/map';
import { DEFAULT_CAMERA,emptyJourney } from '../src/domain';

describe('real map contracts',()=>{
  it('compiles valid vector styles for 2D and terrain with real source-layer semantics',()=>{
    for(const terrain of [false,true]) {
      const style=compileMapStyle({camera:{...DEFAULT_CAMERA,terrain,pitch:terrain?55:0},recipe:DEFAULT_MAP_RECIPE});
      expect(validateStyleMin(style)).toEqual([]);
      expect(style.sources.basemap).toMatchObject({type:'vector',url:'https://tiles.openfreemap.org/planet'});
      expect(style.layers.some(l=>l.id==='roads' && 'source-layer' in l && l['source-layer']==='transportation')).toBe(true);
      expect(Boolean(style.terrain)).toBe(terrain);
    }
  });
  it('sets the right DEM encoding and tile dimensions',()=>{
    expect(terrainSource('mapterhorn')).toMatchObject({encoding:'terrarium',tileSize:512});
    expect(terrainSource('aws')).toMatchObject({encoding:'terrarium',tileSize:256});
  });
  it('does not duplicate route linework or draw visit numbers in export mode',()=>{
    const style=compileMapStyle({camera:DEFAULT_CAMERA,showStops:false});
    expect(style.layers.find(l=>l.id==='visit-numbers')?.layout).toMatchObject({visibility:'none'});
    expect(style.layers.filter(l=>l.id==='journey-line')).toHaveLength(1);
  });
  it('preserves visit identities across A-B-A while photo clustering counts identities once',()=>{
    const journey=emptyJourney();journey.order.orderedVisitIds=['a1','b','a2'];
    journey.resolvedVisits=[{id:'a1',name:'A',coordinate:[120,30],precision:'exact',status:'confirmed',photoIds:[],time:{precision:'unknown',source:'unknown'},stableIndex:0},
      {id:'b',name:'B',coordinate:[121,30],precision:'exact',status:'confirmed',photoIds:[],time:{precision:'unknown',source:'unknown'},stableIndex:1},
      {id:'a2',name:'A',coordinate:[120,30],precision:'exact',status:'confirmed',photoIds:[],time:{precision:'unknown',source:'unknown'},stableIndex:2}];
    expect(visitGeoJSON(journey).features.map(f=>f.properties?.number)).toEqual([1,2,3]);
    expect(photoGeoJSON([{id:'p',coordinate:[120,30]},{id:'p',coordinate:[120,30]}]).features).toHaveLength(1);
  });
  it('only emits route segments that the domain supplied, including explicit gaps',()=>{
    const journey=emptyJourney();journey.route.segments=[{id:'first',fromVisitId:'a',toVisitId:'b',coordinates:[[179,10],[180,10.5]]},{id:'second',fromVisitId:'a',toVisitId:'b',coordinates:[[-180,10.5],[-179,11]]}];
    const result=routeGeoJSON(journey);expect(result.features).toHaveLength(2);expect(result.features[1].geometry.coordinates[0][0]).toBe(-180);
  });
  it('rejects impossible resolution rather than silently scaling a low-resolution map',()=>{
    expect(()=>validateRenderDimensions(1000,600,4.096)).not.toThrow();
    expect(()=>validateRenderDimensions(1000,600,5)).toThrow(/4096/);
    expect(()=>validateRenderDimensions(0,600,1)).toThrow();
  });
  it('requires schema and attribution mappings for replacement providers',()=>{
    expect(()=>validateMapSourceAdapter(OPENFREEMAP_SOURCE)).not.toThrow();
    expect(()=>validateMapSourceAdapter({...OPENFREEMAP_SOURCE,policy:{...OPENFREEMAP_SOURCE.policy,requiredAttribution:[]}})).toThrow();
  });
  it('rejects malformed glyph data before a silent local-font fallback',()=>{
    const make=(bitmapBytes:number)=>{
      const writer=new PbfWriter();writer.writeMessage(1,(_value,stack)=>{
        stack.writeStringField(1,'Noto Sans Regular');stack.writeStringField(2,'0-255');
        stack.writeMessage(3,(_glyph,pbf)=>{pbf.writeVarintField(1,65);pbf.writeBytesField(2,new Uint8Array(bitmapBytes));pbf.writeVarintField(3,1);pbf.writeVarintField(4,2);},null);
      },null);return new Uint8Array(writer.finish()).buffer;
    };
    expect(()=>assertGlyphPbf(make(56))).not.toThrow();
    expect(()=>assertGlyphPbf(make(1))).toThrow();
    expect(()=>assertGlyphPbf(new TextEncoder().encode('<html>network gateway error</html>').buffer)).toThrow();
  });
});
