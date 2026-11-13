/** Policies are deliberately executable. No default adapter prefetches map areas. */
export interface ProviderPolicy {
  id: string;
  label: string;
  policyURL: string;
  reviewedAt: string;
  requiredAttribution: string[];
  printAttribution: string[];
  cacheMode: 'http' | 'memory' | 'none';
  cacheTTL: number;
  offlineAllowed: boolean;
  bundleAllowed: boolean;
  snapshotBundleAllowed: boolean;
  exportAllowed: boolean;
  maxConcurrency: number;
  minimumIntervalMs: number;
  publicService: boolean;
  notes: string;
}

export const PROVIDER_POLICIES: Readonly<Record<string, ProviderPolicy>> = Object.freeze({
  openfreemap: {
    id: 'openfreemap', label: 'OpenFreeMap', policyURL: 'https://openfreemap.org/tos/', reviewedAt: '2026-11-13',
    requiredAttribution: ['OpenFreeMap', '© OpenMapTiles', '© OpenStreetMap contributors'],
    printAttribution: ['OpenFreeMap · openfreemap.org', '© OpenMapTiles · openmaptiles.org', '© OpenStreetMap contributors · openstreetmap.org/copyright'],
    cacheMode: 'http', cacheTTL: 0, offlineAllowed: false, bundleAllowed: false,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 4, minimumIntervalMs: 0, publicService: true,
    notes: '免密钥，无 SLA。仅按视口获取；区域下载需专属 User-Agent 且不超过 3,000 瓦片或 50 MB，本应用未启用区域下载。底图遵循 OpenMapTiles schema。',
  },
  mapterhorn: {
    id: 'mapterhorn', label: 'Mapterhorn', policyURL: 'https://mapterhorn.com/attribution/', reviewedAt: '2026-11-13',
    requiredAttribution: ['Terrain © Mapterhorn / source providers'],
    printAttribution: ['Terrain © Mapterhorn / source providers · mapterhorn.com/attribution'],
    cacheMode: 'http', cacheTTL: 0, offlineAllowed: false, bundleAllowed: false,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 4, minimumIntervalMs: 0, publicService: true,
    notes: 'Terrarium 512 px WebP；各区域高程来源与精度不同。保存和导出保留完整来源清单链接；不打包原始 DEM 瓦片。',
  },
  aws: {
    id: 'aws', label: 'AWS Terrain Tiles', policyURL: 'https://registry.opendata.aws/terrain-tiles/', reviewedAt: '2026-11-13',
    requiredAttribution: ['Terrain Tiles / Mapzen / source providers'],
    printAttribution: ['Terrain Tiles / Mapzen / source providers · registry.opendata.aws/terrain-tiles'],
    cacheMode: 'http', cacheTTL: 0, offlineAllowed: false, bundleAllowed: false,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 4, minimumIntervalMs: 0, publicService: true,
    notes: '可选备用地形；Terrarium 256 px。数据来源和署名与 Mapterhorn 不同，切换后重新渲染。',
  },
  photon: {
    id: 'photon', label: 'Photon', policyURL: 'https://github.com/komoot/photon#demo-server', reviewedAt: '2026-11-13',
    requiredAttribution: ['© OpenStreetMap contributors'], printAttribution: ['© OpenStreetMap contributors · openstreetmap.org/copyright'],
    cacheMode: 'memory', cacheTTL: 86_400_000, offlineAllowed: false, bundleAllowed: true,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 1, minimumIntervalMs: 1200, publicService: true,
    notes: '官方仅允许合理低频使用，无固定免费额度或 SLA。本应用限显式提交、去重与缓存，保守地串行且请求间隔至少 1.2 秒；不是服务方公布的限额。大规模部署应更换为自营实例。',
  },
});

export function attributionForMap(terrain: boolean, terrainProvider: 'mapterhorn' | 'aws' = 'mapterhorn', print = false): string[] {
  const key = print ? 'printAttribution' : 'requiredAttribution';
  return [...PROVIDER_POLICIES.openfreemap[key], ...(terrain ? PROVIDER_POLICIES[terrainProvider][key] : [])];
}

export type ProviderErrorCode = 'ABORTED' | 'TIMEOUT' | 'RATE_LIMIT' | 'NETWORK' | 'INVALID_RESPONSE' | 'INVALID_INPUT' | 'HTTP_ERROR' | 'CONSENT_REQUIRED' | 'UNSUPPORTED';
export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string, public providerId: string, public retryable = false, public retryAfterMs?: number) {
    super(message); this.name = 'ProviderError';
  }
}

export function abortError(provider = 'runtime'): ProviderError { return new ProviderError('ABORTED', '操作已取消', provider); }
export function throwIfAborted(signal?: AbortSignal, provider?: string): void { if (signal?.aborted) throw abortError(provider); }

export function validateServiceURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError('INVALID_INPUT', '服务地址不是有效 URL', 'configuration'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new ProviderError('INVALID_INPUT', '服务地址必须使用 HTTPS，或本机 HTTP，且不能含凭据或片段', 'configuration');
  }
  return url;
}
