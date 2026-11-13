import { PbfReader } from 'pbf';

/** Validate the public Mapbox glyph PBF envelope before MapLibre can hide a parse failure. */
export function assertGlyphPbf(data:ArrayBuffer):void {
  const pbf=new PbfReader(data);let stacks=0;
  pbf.readFields((tag,_result,reader)=>{
    if(tag!==1)return;
    stacks++;
    reader.readMessage((stackTag,_stack,stackReader)=>{
      if(stackTag!==3)return;
      const glyph=stackReader.readMessage((glyphTag,value,glyphReader)=>{
        if(glyphTag===1)value.id=glyphReader.readVarint();
        else if(glyphTag===2)value.bitmapBytes=glyphReader.readBytes().byteLength;
        else if(glyphTag===3)value.width=glyphReader.readVarint();
        else if(glyphTag===4)value.height=glyphReader.readVarint();
        else if(glyphTag===5 || glyphTag===6)glyphReader.readSVarint();
        else if(glyphTag===7)glyphReader.readVarint();
      },{id:-1,width:0,height:0,bitmapBytes:-1});
      if(!Number.isInteger(glyph.id) || glyph.id<0 || glyph.id>0x10ffff || glyph.width>1024 || glyph.height>1024 ||
        (glyph.bitmapBytes>=0 && glyph.bitmapBytes!==(glyph.width+6)*(glyph.height+6)))throw new Error('字形 PBF 的图像尺寸或码点无效');
    },null);
  },null);
  if(!stacks || pbf.pos!==data.byteLength)throw new Error('字形 PBF 数据不完整');
}
