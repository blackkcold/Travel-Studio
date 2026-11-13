import { abortError, type ProviderPolicy } from './policy';

interface QueuedRequest<T=unknown> {
  task:(signal:AbortSignal)=>Promise<T>;
  signal?:AbortSignal;
  resolve:(value:T)=>void;
  reject:(error:unknown)=>void;
  onAbort:()=>void;
}

/** A provider-wide queue: visible maps and exports share the same request budget. */
export class ProviderRequestScheduler {
  private queue:QueuedRequest[]=[];
  private active=0;
  private nextStart=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private lifecycle=new AbortController();
  constructor(private policy:Pick<ProviderPolicy,'id'|'maxConcurrency'|'minimumIntervalMs'>) {}

  run<T>(task:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T> {
    if(signal?.aborted || this.lifecycle.signal.aborted)return Promise.reject(abortError(this.policy.id));
    return new Promise<T>((resolve,reject)=>{
      const request:QueuedRequest<T>={task,signal,resolve,reject,onAbort:()=>{
        const index=this.queue.indexOf(request as QueuedRequest);
        if(index>=0)this.queue.splice(index,1);
        reject(abortError(this.policy.id));this.pump();
      }};
      signal?.addEventListener('abort',request.onAbort,{once:true});
      this.queue.push(request as QueuedRequest);this.pump();
    });
  }

  /** A 429 delays pending work; it never retries the rejected request automatically. */
  pauseFor(milliseconds:number):void {
    this.nextStart=Math.max(this.nextStart,Date.now()+Math.max(0,milliseconds));this.pump();
  }

  private pump():void {
    if(this.timer){clearTimeout(this.timer);this.timer=undefined;}
    if(this.lifecycle.signal.aborted)return;
    while(this.queue.length && this.active<this.policy.maxConcurrency) {
      const delay=this.nextStart-Date.now();
      if(delay>0){this.timer=setTimeout(()=>this.pump(),Math.min(delay,2_147_483_647));return;}
      const request=this.queue.shift()!;
      request.signal?.removeEventListener('abort',request.onAbort);
      if(request.signal?.aborted){request.reject(abortError(this.policy.id));continue;}
      this.active++;this.nextStart=Date.now()+Math.max(0,this.policy.minimumIntervalMs);
      const signal=request.signal?AbortSignal.any([request.signal,this.lifecycle.signal]):this.lifecycle.signal;
      void Promise.resolve().then(()=>{
        if(signal.aborted)throw abortError(this.policy.id);
        return request.task(signal);
      }).then(request.resolve,request.reject).finally(()=>{this.active--;this.pump();});
    }
  }

  dispose():void {
    if(this.lifecycle.signal.aborted)return;
    this.lifecycle.abort();if(this.timer)clearTimeout(this.timer);
    for(const request of this.queue){request.signal?.removeEventListener('abort',request.onAbort);request.reject(abortError(this.policy.id));}
    this.queue=[];
  }
}
