import type { TaskContext } from '../domain';
import { ProviderError, throwIfAborted } from './policy';

export interface AIConsent { providerId: string; purpose: 'stylize' | 'locate'; assetHashes: string[]; grantedAt: string }
export interface AIRequest { providerId: string; purpose: AIConsent['purpose']; inputHash: string; image: Blob; prompt: string; model?: string }
export interface AIResult { blob: Blob; providerId: string; inputHash: string; model: string; generatedAt: string }

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
