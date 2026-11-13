import type { Coordinate, LocationPrecision } from '../domain';
import { PROVIDER_POLICIES, ProviderError, abortError, throwIfAborted, validateServiceURL } from './policy';

export interface PlaceCandidate {
  id: string;
  name: string;
  displayName: string;
  coordinate: Coordinate;
  precision: LocationPrecision;
  providerId: string;
  sourceId: string;
  originalInput: string;
  submittedQuery?: string;
  resolvedAt: string;
  country?: string;
  city?: string;
  status: 'candidate';
}
export interface GeoProvider {
  readonly id: string;
  readonly policy: typeof PROVIDER_POLICIES.photon;
  search(query: string, options?: { signal?: AbortSignal; language?: string; bias?: Coordinate }): Promise<PlaceCandidate[]>;
  reverse(coordinate: Coordinate, options?: { signal?: AbortSignal; language?: string }): Promise<PlaceCandidate[]>;
  dispose(): void;
}

const validCoordinate = (p: unknown): p is Coordinate => Array.isArray(p) && p.length >= 2 &&
  typeof p[0] === 'number' && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180 &&
  typeof p[1] === 'number' && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90;

const stringValue = (value: unknown): string => typeof value === 'string' ? value.slice(0, 500) : '';

/** Unicode word boundaries, not a destination dictionary. Retain a trailing single-character suffix with its word. */
export function normalizeSearchQuery(query: string): string {
  const value = query.trim().replace(/\s+/g, ' ');
  if (!/\p{Script=Han}/u.test(value) || /\s/.test(value) || typeof Intl.Segmenter !== 'function') return value;
  const words: string[] = [];
  for (const part of new Intl.Segmenter('zh', {granularity:'word'}).segment(value)) {
    if (!part.isWordLike) {if (part.segment.trim()) words.push(part.segment);continue;}
    if ([...part.segment].length === 1 && /\p{Script=Han}/u.test(part.segment) && words.length) words[words.length-1] += part.segment;
    else words.push(part.segment);
  }
  return words.length > 1 ? words.join(' ') : value;
}

/** Network data remains candidates until a domain confirmation command is applied. */
export function parsePhotonResponse(body: unknown, query: string, resolvedAt = new Date().toISOString()): PlaceCandidate[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as {features?: unknown}).features)) {
    throw new ProviderError('INVALID_RESPONSE', '地点服务返回了无效数据', 'photon', true);
  }
  const features = (body as {features: unknown[]}).features;
  if (features.length > 1000) throw new ProviderError('INVALID_RESPONSE', '地点服务返回过多候选', 'photon');
  const results: PlaceCandidate[] = [];
  for (const raw of features) {
    if (!raw || typeof raw !== 'object') continue;
    const feature = raw as {geometry?: {type?: string; coordinates?: unknown}; properties?: Record<string,unknown>};
    if (feature.geometry?.type !== 'Point' || !validCoordinate(feature.geometry.coordinates) || !feature.properties) continue;
    const p = feature.properties;
    const name = stringValue(p.name) || stringValue(p.street) || stringValue(p.city) || stringValue(p.country);
    if (!name) continue;
    const sourceId = `${stringValue(p.osm_type) || 'location'}:${typeof p.osm_id === 'number' || typeof p.osm_id === 'string' ? p.osm_id : feature.geometry.coordinates.join(',')}`;
    const locationType = stringValue(p.type) || stringValue(p.osm_value);
    const precision: LocationPrecision = /^(city|town|village|municipality|locality)$/.test(locationType) ? 'city' :
      /^(country|state|region|county)$/.test(locationType) ? 'region' :
      p.osm_key === 'highway' || locationType === 'street' ? 'street' : 'exact';
    const context = [p.housenumber, p.street, p.district, p.city, p.state, p.country].map(stringValue).filter(Boolean);
    const coordinate: Coordinate = [feature.geometry.coordinates[0], feature.geometry.coordinates[1]];
    if (results.some(r => r.sourceId === sourceId)) continue;
    results.push({ id: `photon:${sourceId}`, sourceId, name,
      displayName: [name, ...new Set(context.filter(t => t !== name))].join(' · '), coordinate,
      precision, providerId: 'photon', originalInput: query, resolvedAt,
      country: stringValue(p.country) || undefined, city: stringValue(p.city) || undefined, status: 'candidate' });
  }
  return results;
}

export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 30_000;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 3_600_000)) : 30_000;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, 'photon');
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(abortError('photon')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, {once:true});
  });
}

/** An explicit-submit, serial client. New searches never run on each input keystroke. */
export class PhotonProvider implements GeoProvider {
  readonly id = 'photon';
  readonly policy = PROVIDER_POLICIES.photon;
  private baseURL: URL;
  private queue: Promise<unknown> = Promise.resolve();
  private nextAllowedAt = 0;
  private cache = new Map<string, {at: number; result: PlaceCandidate[]}>();
  private controllers = new Set<AbortController>();
  private disposed = false;
  constructor(options: {baseURL?: string; fetch?: typeof fetch; timeoutMs?: number; minimumIntervalMs?: number} = {}) {
    this.baseURL = validateServiceURL(options.baseURL ?? 'https://photon.komoot.io/');
    if (!this.baseURL.pathname.endsWith('/')) this.baseURL.pathname += '/';
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.minimumIntervalMs = Math.max(0, options.minimumIntervalMs ?? this.policy.minimumIntervalMs);
  }
  private fetcher: typeof fetch;
  private timeoutMs: number;
  private minimumIntervalMs: number;

  search(query: string, options: {signal?: AbortSignal; language?: string; bias?: Coordinate} = {}): Promise<PlaceCandidate[]> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 2 || q.length > 200) return Promise.reject(new ProviderError('INVALID_INPUT', '请输入 2–200 个字符的地点或地址', this.id));
    const url = new URL('api/', this.baseURL); url.searchParams.set('q', normalizeSearchQuery(q)); url.searchParams.set('limit', '8');
    if (options.language) url.searchParams.set('lang', options.language);
    if (options.bias && validCoordinate(options.bias)) { url.searchParams.set('lon', String(options.bias[0])); url.searchParams.set('lat', String(options.bias[1])); }
    return this.request(url, q, options.signal);
  }
  reverse(coordinate: Coordinate, options: {signal?: AbortSignal; language?: string} = {}): Promise<PlaceCandidate[]> {
    if (!validCoordinate(coordinate)) return Promise.reject(new ProviderError('INVALID_INPUT', '经纬度超出有效范围', this.id));
    const url = new URL('reverse', this.baseURL); url.searchParams.set('lon', String(coordinate[0])); url.searchParams.set('lat', String(coordinate[1])); url.searchParams.set('limit', '3');
    if (options.language) url.searchParams.set('lang', options.language);
    return this.request(url, `${coordinate[0]}, ${coordinate[1]}`, options.signal);
  }

  private request(url: URL, query: string, signal?: AbortSignal): Promise<PlaceCandidate[]> {
    if (this.disposed) return Promise.reject(abortError(this.id));
    if (signal?.aborted) return Promise.reject(abortError(this.id));
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.policy.cacheTTL) return Promise.resolve(structuredClone(cached.result));
    const job = this.queue.catch(() => undefined).then(async () => {
      if (this.disposed) throw abortError(this.id);
      throwIfAborted(signal, this.id);
      const nowCached = this.cache.get(key);
      if (nowCached && Date.now() - nowCached.at < this.policy.cacheTTL) return structuredClone(nowCached.result);
      await delay(this.nextAllowedAt - Date.now(), signal);
      throwIfAborted(signal, this.id);
      const controller = new AbortController(); this.controllers.add(controller);
      let timedOut = false;
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, {once:true});
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      this.nextAllowedAt = Date.now() + this.minimumIntervalMs;
      try {
        const response = await this.fetcher(url, {signal: controller.signal, credentials: 'omit', redirect: 'error', headers: {Accept:'application/json'}});
        if (response.status === 429) {
          const retry = parseRetryAfter(response.headers.get('Retry-After'));
          this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + retry);
          throw new ProviderError('RATE_LIMIT', '地点服务暂时限流，请稍后重试', this.id, true, retry);
        }
        if (!response.ok) throw new ProviderError('HTTP_ERROR', `地点服务返回 HTTP ${response.status}`, this.id, response.status >= 500);
        const size = Number(response.headers.get('content-length') || 0);
        if (size > 2_000_000) throw new ProviderError('INVALID_RESPONSE', '地点服务响应过大', this.id);
        const text = await response.text();
        if (text.length > 2_000_000) throw new ProviderError('INVALID_RESPONSE', '地点服务响应过大', this.id);
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { throw new ProviderError('INVALID_RESPONSE', '地点服务未返回 JSON', this.id, true); }
        const result = parsePhotonResponse(parsed, query).map(candidate=>({...candidate,submittedQuery:url.searchParams.get('q') ?? query}));
        throwIfAborted(signal, this.id);
        this.cache.set(key, {at: Date.now(), result});
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value as string);
        return structuredClone(result);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (timedOut) throw new ProviderError('TIMEOUT', '地点服务响应超时，已有作品不受影响', this.id, true);
        if (controller.signal.aborted || signal?.aborted) throw abortError(this.id);
        throw new ProviderError('NETWORK', '无法连接地点服务，请检查网络或手动输入经纬度', this.id, true);
      } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); this.controllers.delete(controller); }
    });
    this.queue = job;
    return job;
  }
  dispose(): void { this.disposed = true; for (const c of this.controllers) c.abort(); this.controllers.clear(); this.cache.clear(); }
}
