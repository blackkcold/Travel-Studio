import type { PhotoRecord } from '../domain';
import { formatTimeEvidence } from '../journey';
import { Button, Checkbox, Modal, PhotoCard, VirtualList } from '../ui';
import { useAssetURL, useProject } from './context';

function GroupPhoto({photo,checked,onToggle,onLocate}:{photo:PhotoRecord;checked:boolean;onToggle:(checked:boolean)=>void;onLocate:()=>void}){
  const src=useAssetURL(photo.thumbnailAssetId??photo.assetId);
  return <div className="group-photo"><Checkbox checked={checked} aria-label={`选择照片 ${photo.name}`} onChange={event=>onToggle(event.target.checked)}/><PhotoCard src={src} name={photo.name} onClick={onLocate}/><div><strong>{photo.name}</strong><small>{formatTimeEvidence(photo.time)}</small></div><Button variant="quiet" onClick={onLocate}>查看地点</Button></div>;
}
export function PhotoGroupDialog({photoIds,selectedPhotoIds,onToggle,onLocate,onClose}:{photoIds:string[];selectedPhotoIds:string[];onToggle:(photoId:string,checked:boolean)=>void;onLocate:(photoId:string)=>void;onClose:()=>void}){
  const project=useProject(),wanted=new Set(photoIds),photos=project.library.photos.filter(photo=>wanted.has(photo.id));
  return <Modal title={`这里的 ${photos.length} 张照片`} onClose={onClose} wide><p className="help-text">逐张查看与选择。视觉聚类不会合并到访，也不会更改原始位置。</p><VirtualList items={photos} height={420} rowHeight={88} render={photo=><GroupPhoto key={photo.id} photo={photo} checked={selectedPhotoIds.includes(photo.id)} onToggle={checked=>onToggle(photo.id,checked)} onLocate={()=>onLocate(photo.id)}/>}/><div className="modal-actions"><Button onClick={onClose}>完成</Button></div></Modal>;
}
