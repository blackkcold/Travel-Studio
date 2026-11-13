/** M01 composition root: the only place that wires concrete storage and service adapters. */
import { DocumentStore, createEmptyProject, createWorkspace, type WorkspaceState } from '../domain';
import { createBrowserStore, exportProjectPackage, importProjectPackage, persistImportedPackage, recoverLatestProject, ProjectRecoveryError } from '../storage';
import { importPhoto, processPhoto } from '../photo';
import { PhotonProvider, PROVIDER_POLICIES, requestAIImage, requestAILocation } from '../providers';
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
  const extensions=new ExtensionRegistry();
  function restoreDesigns(doc:ProjectDocument){for(const art of doc.artworks)for(const manifest of [art.embeddedStyle,art.embeddedTemplate]){if(!manifest)continue;installDesignManifest(manifest);const entry=extensions.register(manifest);extensions.activate(entry.manifest.id,entry.manifest.version);extensions.retain(entry.manifest.id,entry.manifest.version,art.id);}}
  const recovered=await recoverLatestProject(storage,{validate:restoreDesigns});
  const project = recovered.project ?? createEmptyProject();
  const startupRecovery=recovered.recovery;
  const document = new DocumentStore(project);
  const savedWorkspace=await storage.projects.loadWorkspace(project.id)??(startupRecovery?.sourceProjectId?await storage.projects.loadWorkspace(startupRecovery.sourceProjectId):undefined);
  const workspace:WorkspaceState=savedWorkspace?{...savedWorkspace,projectId:project.id}:{...createWorkspace(project.id),...(project.artworks[0]?{activeArtworkId:project.artworks[0].id,mode:'artwork' as const}:{})};
  if(workspace.activeArtworkId&&!project.artworks.some(art=>art.id===workspace.activeArtworkId)){workspace.activeArtworkId=project.artworks[0]?.id;workspace.mode=workspace.activeArtworkId?'artwork':'atlas';}
  const useUI = create<UIState>((set,get)=>({workspace,saveState:'saved',savedRevision:project.revision,
    setWorkspace(patch){const next={...get().workspace,...patch};set({workspace:next});void storage.projects.saveWorkspace(next).catch(()=>undefined);},
    setSaveState(saveState,savedRevision,error){set({saveState,...(savedRevision!==undefined?{savedRevision}:{}),saveError:error});},
  }));
  let timer:ReturnType<typeof setTimeout>;let queue=Promise.resolve();
  document.subscribe(()=>{clearTimeout(timer);useUI.getState().setSaveState('saving');timer=setTimeout(()=>{const snapshot=document.document;queue=queue.then(async()=>{try{await storage.projects.saveProject(snapshot);if(document.document.revision===snapshot.revision)useUI.getState().setSaveState('saved',snapshot.revision);}catch(error){useUI.getState().setSaveState('error',undefined,error instanceof Error?error.message:'自动保存失败');}});},350);});
  const beforeUnload=(e:BeforeUnloadEvent)=>{if(useUI.getState().saveState!=='saved'){e.preventDefault();}};window.addEventListener('beforeunload',beforeUnload);
  const geo=new PhotonProvider();
  const snapshots=createSnapshotPersistence(document,storage.assets);
  const services={document,useUI,storage,geo,startupRecovery,policies:PROVIDER_POLICIES,createMapController,renderMapFrame,importPhoto,processPhoto,exportProjectPackage,importProjectPackage,persistImportedPackage,requestAIImage,requestAILocation,
    isProjectRecoveryError:(value:unknown):value is ProjectRecoveryError=>value instanceof ProjectRecoveryError,
    scheduler:new TaskScheduler(),leases:new ResourceLeases(),extensions,restoreDesigns,
    snapshots,rendering:{getAsset:storage.assets.getAsset,renderMap:renderMapFrame,processPhoto,onMapFrame:async(...args:Parameters<typeof snapshots.onMapFrame>)=>{try{await snapshots.onMapFrame(...args);}catch(error){useUI.getState().setSaveState('error',undefined,error instanceof Error?error.message:'保存地图快照失败');}}},
    async flush(){clearTimeout(timer);await queue;await storage.projects.saveProject(document.document);useUI.getState().setSaveState('saved',document.document.revision);},
  };
  return services;
}
export type AppServices = Awaited<ReturnType<typeof bootstrap>>;
