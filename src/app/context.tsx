import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AppServices } from './bootstrap';
export const ServicesContext=createContext<AppServices|undefined>(undefined);
export function useServices(){const value=useContext(ServicesContext);if(!value)throw new Error('应用服务尚未准备好。');return value;}
export function useProject(){const {document}=useServices();return useSyncExternalStore(document.subscribe,document.getSnapshot);}
export function useAssetURL(id?:string){const {storage}=useServices(),[url,setURL]=useState<string>();useEffect(()=>{let disposed=false,objectURL:string|undefined;setURL(undefined);if(id)void storage.assets.getAsset(id).then(blob=>{if(blob&&!disposed){objectURL=URL.createObjectURL(blob);setURL(objectURL);}});return()=>{disposed=true;if(objectURL)URL.revokeObjectURL(objectURL);};},[id,storage]);return url;}
export function saveBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename.replace(/[\\/:*?"<>|]/g,'-');a.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);}
