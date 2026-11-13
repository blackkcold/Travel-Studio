import type { TaskContext } from '../domain';
import { ProviderError, throwIfAborted } from './policy';
import { parseRetryAfter,type PlaceCandidate } from './photon';

export interface AIConsent { providerId: string; purpose: 'stylize' | 'locate'; assetHashes: string[]; grantedAt: string }
export interface AIRequest { providerId: string; purpose: AIConsent['purpose']; inputHash: string; image: Blob; prompt: string; model?: string }
export interface AIResult { blob: Blob; providerId: string; inputHash: string; model: string; generatedAt: string }
export interface AILocationCandidate extends PlaceCandidate {
  precision:'unknown'; reason:string; source:'ai'; inputHash:string; model:string;
}
export interface AILocationResult {
  candidates:AILocationCandidate[]; providerId:string; inputHash:string; model:string;
  requiresConfirmation:true; generatedAt:string;
}

/** Validate provenance and keep all model coordinates unconfirmed and imprecise. */
export function parseAILocationResponse(body:unknown,request:Pick<AIRequest,'providerId'|'inputHash'|'prompt'|'model'>,generatedAt=new Date().toISOString()):AILocationResult {
  const invalid=()=>new ProviderError('INVALID_RESPONSE','AI 地点候选的来源、资源或坐标校验失败，请手动确认地点',request.providerId);
  if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();
  const value=body as Record<string,unknown>;
  if(value.providerId!==request.providerId||value.inputHash!==request.inputHash||value.requiresConfirmation!==true||typeof value.model!=='string'||!value.model.trim()||value.model.length>200||!Array.isArray(value.candidates)||value.candidates.length>3)throw invalid();
  if(request.model&&value.model!==request.model)throw invalid();
  const model=value.model;const candidates:AILocationCandidate[]=[];const seen=new Set<string>();
  for(let index=0;index<value.candidates.length;index++){
    const raw=value.candidates[index];if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid();
    const candidate=raw as Record<string,unknown>,point=candidate.coordinate;
    if(typeof candidate.name!=='string'||!candidate.name.trim()||candidate.name.length>300||typeof candidate.reason!=='string'||candidate.reason.length>500||candidate.status!=='candidate'||candidate.precision!=='unknown'||candidate.source!==request.providerId||!Array.isArray(point)||point.length!==2||!point.every(n=>typeof n==='number'&&Number.isFinite(n))||Math.abs(point[0])>180||Math.abs(point[1])>90)throw invalid();
    const name=candidate.name.trim(),key=JSON.stringify([name,point]);if(seen.has(key))continue;seen.add(key);
    const sourceId=`${request.inputHash}:locate:${index}`;
    candidates.push({id:`ai:${request.providerId}:${sourceId}`,sourceId,providerId:request.providerId,name,
      displayName:`${name} · AI 候选，待确认`,coordinate:[point[0],point[1]],precision:'unknown',status:'candidate',
      originalInput:request.prompt,resolvedAt:generatedAt,reason:candidate.reason,source:'ai',inputHash:request.inputHash,model});
  }
  return{candidates,providerId:request.providerId,inputHash:request.inputHash,model,requiresConfirmation:true,generatedAt};
}

/** Location is a separate, explicit photo-sharing purpose; it never edits a Place or GPS record. */
export async function requestAILocation(request:AIRequest,consent:AIConsent|undefined,context:TaskContext):Promise<AILocationResult> {
  throwIfAborted(context.signal,request.providerId);
  if(request.purpose!=='locate'||!consent||consent.purpose!=='locate'||consent.providerId!==request.providerId||!consent.assetHashes.includes(request.inputHash))throw new ProviderError('CONSENT_REQUIRED','请单独授权此服务查看所选照片并建议地点；照片风格化授权不能用于定位',request.providerId);
  if(!/^[a-f0-9]{64}$/i.test(request.inputHash)||context.inputHash!==request.inputHash||!request.image.size||request.image.size>20_000_000||!request.prompt.trim()||request.prompt.length>3000)throw new ProviderError('INVALID_INPUT','AI 定位需要当前资源的完整 hash、有效脱敏图片及 1–3000 字符说明',request.providerId);
  const form=new FormData();form.append('image',request.image,'input.png');form.append('prompt',request.prompt);form.append('providerId',request.providerId);form.append('inputHash',request.inputHash);if(request.model)form.append('model',request.model);
  context.onStage?.('发送已单独授权的定位照片');
  let response:Response;
  try{response=await fetch('/api/ai/locate',{method:'POST',body:form,signal:context.signal,credentials:'same-origin',headers:{'X-Travel-Studio-Request':'1'}});}
  catch{throwIfAborted(context.signal,request.providerId);throw new ProviderError('NETWORK','本地 AI 定位网关不可用，可继续地址搜索或地图落点',request.providerId,true);}
  if(response.status===429)throw new ProviderError('RATE_LIMIT','AI 服务繁忙，请等待当前任务完成后再试',request.providerId,true,parseRetryAfter(response.headers.get('Retry-After')));
  if(!response.ok)throw new ProviderError('HTTP_ERROR',response.status===404||response.status===503?'本地 AI 地点候选未启用或暂不可用，请检查网关及视觉模型配置':`AI 定位请求失败 (${response.status})`,request.providerId,response.status>=500);
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')||Number(response.headers.get('Content-Length'))>1_000_000)throw new ProviderError('INVALID_RESPONSE','AI 定位未返回受限大小的 JSON 候选',request.providerId);
  const text=await response.text();if(text.length>1_000_000)throw new ProviderError('INVALID_RESPONSE','AI 地点候选响应过大',request.providerId);
  let body:unknown;try{body=JSON.parse(text);}catch{throw new ProviderError('INVALID_RESPONSE','AI 地点候选不是有效 JSON',request.providerId);}
  throwIfAborted(context.signal,request.providerId);context.onStage?.('候选待人工确认，尚未修改地点');
  return parseAILocationResponse(body,request);
}

/** No credentials in project documents or VITE_ variables. A configured loopback gateway owns secrets. */
export async function requestAIImage(request: AIRequest, consent: AIConsent | undefined, context: TaskContext): Promise<AIResult> {
  throwIfAborted(context.signal, request.providerId);
  if (!consent || consent.providerId !== request.providerId || consent.purpose !== request.purpose || !consent.assetHashes.includes(request.inputHash)) {
    throw new ProviderError('CONSENT_REQUIRED', '请先授权此服务处理所选照片及当前用途', request.providerId);
  }
  if (request.image.size > 20_000_000) throw new ProviderError('INVALID_INPUT', 'AI 输入图片超过 20 MB，请使用脱敏代理图', request.providerId);
  if (request.purpose !== 'stylize') throw new ProviderError('UNSUPPORTED', '地标候选需由支持定位的独立适配器提供；不会用图像生成结果替代定位', request.providerId);
  context.onStage?.('发送已授权照片');
  const form = new FormData(); form.append('image', request.image, 'input.png'); form.append('prompt', request.prompt); form.append('providerId', request.providerId); form.append('inputHash', request.inputHash);
  if (request.model) form.append('model', request.model);
  let response: Response;
  try { response = await fetch('/api/ai/stylize', {method:'POST', body: form, signal: context.signal, credentials:'same-origin', headers:{'X-Travel-Studio-Request':'1'}}); }
  catch { throwIfAborted(context.signal, request.providerId); throw new ProviderError('NETWORK', '本地 AI 网关不可用，本地照片处理仍可继续', request.providerId, true); }
  if (!response.ok) throw new ProviderError('HTTP_ERROR', response.status === 404 ? '尚未配置本地 AI 网关' : `AI 服务请求失败 (${response.status})`, request.providerId, response.status >= 500);
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (!mime || !['image/png','image/jpeg','image/webp'].includes(mime)) throw new ProviderError('INVALID_RESPONSE', 'AI 返回的内容不是支持的图片', request.providerId);
  const blob = await response.blob();
  if (!blob.size || blob.size > 50_000_000) throw new ProviderError('INVALID_RESPONSE', 'AI 返回的图片大小无效', request.providerId);
  throwIfAborted(context.signal, request.providerId);
  return {blob, providerId:request.providerId, inputHash:request.inputHash, model:response.headers.get('X-Model') || request.model || 'configured-model', generatedAt:new Date().toISOString()};
}
