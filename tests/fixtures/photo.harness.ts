import { importPhoto, processPhoto, canvasToBlob } from '../../src/photo';
import { createBrowserStore, hashBytes } from '../../src/storage';
import { createEmptyProject, type ProjectDocument } from '../../src/domain';
import exifr from 'exifr';

const get = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const storage = await createBrowserStore(`photo-contract-${crypto.randomUUID()}`);
let project:ProjectDocument = createEmptyProject('Synthetic pipeline test');
get<HTMLInputElement>('files').addEventListener('change',async event=>{
  get('status').textContent='本地导入';
  const files=Array.from((event.target as HTMLInputElement).files??[]),results=[];
  try{
    for(const file of files){
      const started=performance.now(),result=await importPhoto(file,storage.assets);
      if(!project.library.photos.some(photo=>photo.id===result.photo.id))project.library.photos.push(result.photo);
      for(const asset of result.assets)if(!project.assets.some(existing=>existing.id===asset.id))project.assets.push(asset);
      const original=await storage.assets.getAsset(result.photo.assetId);
      results.push({...result,elapsedMs:performance.now()-started,originalHashUnchanged:!!original&&await hashBytes(original)===await hashBytes(file)});
    }
    await storage.projects.saveProject(project);
    const restored=await storage.projects.loadProject(project.id);
    get('result').textContent=JSON.stringify({results,photoCount:restored?.library.photos.length,assetCount:restored?.assets.length},null,2);
    get('status').textContent='导入与保存完成';get<HTMLButtonElement>('process').disabled=false;
  }catch(error){get('status').textContent=`导入失败：${error instanceof Error?error.message:String(error)}`;}
});
get('process').addEventListener('click',async()=>{
  const photo=project.library.photos[0];if(!photo)return;
  const blob=await storage.assets.getAsset(photo.assetId);if(!blob)return;
  get('status').textContent='执行本地配方';
  const results=[];
  try{
    for(const style of ['ink','sketch','parchment','oil','poster','modern']){
      const canvas=await processPhoto(blob,{mode:'local',exposure:0,contrast:1,saturation:1,intensity:.8},style,1600);
      const outputs=[];
      for(const mime of ['image/png','image/jpeg','image/webp']){
        const encoded=await canvasToBlob(canvas,mime),decoded=await createImageBitmap(encoded);
        let metadata:Record<string,unknown>|undefined,hasExifContainer=false;
        if(mime==='image/webp'){
          const bytes=new Uint8Array(await encoded.arrayBuffer()),view=new DataView(bytes.buffer);let at=12;
          while(at+8<=bytes.length){const name=String.fromCharCode(...bytes.slice(at,at+4)),length=view.getUint32(at+4,true);if(name==='EXIF'||name==='XMP ')hasExifContainer=true;at+=8+length+(length%2);}
          if(at!==bytes.length)throw new Error('WebP RIFF container is malformed');
        }else metadata=await exifr.parse(encoded,{reviveValues:false});
        outputs.push({mime:encoded.type,width:decoded.width,height:decoded.height,bytes:encoded.size,hash:await hashBytes(encoded),hasGPS:!!metadata?.GPSLatitude,hasOriginalTime:!!metadata?.DateTimeOriginal,hasExifContainer});decoded.close();
      }
      const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=URL.createObjectURL(await canvasToBlob(canvas));image.alt=style;caption.textContent=`${style} · local rule-based recipe`;figure.append(image,caption);get('styles').append(figure);
      results.push({style,outputs});canvas.width=1;canvas.height=1;
    }
    get('encoding').textContent=JSON.stringify(results,null,2);get('status').textContent='六种配方与三格式编码完成';
  }catch(error){get('status').textContent=`处理失败：${error instanceof Error?error.message:String(error)}`;}
});
