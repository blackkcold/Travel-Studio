/** M01 composition root: the only place that wires concrete storage and service adapters. */
import { DocumentStore, createEmptyProject, createWorkspace, type WorkspaceState } from '../domain';
import { createBrowserStore, exportProjectPackage, importProjectPackage, persistImportedPackage } from '../storage';
import { importPhoto, processPhoto } from '../photo';
import { PhotonProvider, PROVIDER_POLICIES, requestAIImage } from '../providers';
import { createMapController, renderMapFrame } from '../map';
import { TaskScheduler, ResourceLeases } from '../runtime';
import { ExtensionRegistry } from '../plugins';
import { create } from 'zustand';
import { installDesignManifest } from '../design-packages';
import type { ProjectDocument } from '../domain';
import { createSnapshotPersistence } from './snapshots';

export interface UIState {
  workspace: WorkspaceState; saveState: 'saved' | 'saving' | 'error'; savedRevision: number; saveError?: string;
  setWorkspace(patch: Partial<WorkspaceState>): void;
  setSaveState(state: 'saved' | 'saving' | 'error', revision?: number, error?: string): void;
}
export async function bootstrap() {
  const storage = await createBrowserStore();
  const project = await storage.projects.latestProject() ?? createEmptyProject();
  const extensions=new ExtensionRegistry();
  function restoreDesigns(doc:ProjectDocument){for(const art of doc.artworks)for(const manifest of [art.embeddedStyle,art.embeddedTemplate]){if(!manifest)continue;installDesignManifest(manifest);const entry=extensions.register(manifest);extensions.activate(entry.manifest.id,entry.manifest.version);extensions.retain(entry.manifest.id,entry.manifest.version,art.id);}}
  restoreDesigns(project);
  const document = new DocumentStore(project);
  const workspace = await storage.projects.loadWorkspace(project.id) ?? createWorkspace(project.id);
  const useUI = create<UIState>((set,get)=>({workspace,saveState:'saved',savedRevision:project.revision,
    setWorkspace(patch){const next={...get().workspace,...patch};set({workspace:next});void storage.projects.saveWorkspace(next).catch(()=>undefined);},
    setSaveState(saveState,savedRevision,error){set({saveState,...(savedRevision!==undefined?{savedRevision}:{}),saveError:error});},
  }));
  let timer:ReturnType<typeof setTimeout>;let queue=Promise.resolve();
  document.subscribe(()=>{clearTimeout(timer);useUI.getState().setSaveState('saving');timer=setTimeout(()=>{const snapshot=document.document;queue=queue.then(async()=>{try{await storage.projects.saveProject(snapshot);if(document.document.revision===snapshot.revision)useUI.getState().setSaveState('saved',snapshot.revision);}catch(error){useUI.getState().setSaveState('error',undefined,error instanceof Error?error.message:'自动保存失败');}});},350);});
  const beforeUnload=(e:BeforeUnloadEvent)=>{if(useUI.getState().saveState!=='saved'){e.preventDefault();}};window.addEventListener('beforeunload',beforeUnload);
  const geo=new PhotonProvider();
  const snapshots=createSnapshotPersistence(document,storage.assets);
  const services={document,useUI,storage,geo,policies:PROVIDER_POLICIES,createMapController,renderMapFrame,importPhoto,processPhoto,exportProjectPackage,importProjectPackage,persistImportedPackage,requestAIImage,
    scheduler:new TaskScheduler(),leases:new ResourceLeases(),extensions,restoreDesigns,
    snapshots,rendering:{getAsset:storage.assets.getAsset,renderMap:renderMapFrame,processPhoto,onMapFrame:async(...args:Parameters<typeof snapshots.onMapFrame>)=>{try{await snapshots.onMapFrame(...args);}catch(error){useUI.getState().setSaveState('error',undefined,error instanceof Error?error.message:'保存地图快照失败');}}},
    async flush(){clearTimeout(timer);await queue;await storage.projects.saveProject(document.document);useUI.getState().setSaveState('saved',document.document.revision);},
  };
  return services;
}
export type AppServices = Awaited<ReturnType<typeof bootstrap>>;
