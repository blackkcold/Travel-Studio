/** Policies are deliberately executable. No default adapter prefetches map areas. */
export interface ProviderPolicy {
  id: string;
  label: string;
  policyURL: string;
  reviewedAt: string;
  requiredAttribution: string[];
  /** Plain labels above; safe electronic credit links are paired by index. */
  attributionURLs?: string[];
  printAttribution: string[];
  sourceLicenseURLs?: string[];
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
    attributionURLs: ['https://openfreemap.org/','https://openmaptiles.org/','https://www.openstreetmap.org/copyright'],
    printAttribution: ['OpenFreeMap · https://openfreemap.org/', '© OpenMapTiles · https://openmaptiles.org/', '© OpenStreetMap contributors · https://www.openstreetmap.org/copyright'],
    sourceLicenseURLs: ['https://openfreemap.org/tos/','https://openmaptiles.org/docs/terminology/attribution/','https://www.openstreetmap.org/copyright'],
    cacheMode: 'http', cacheTTL: 0, offlineAllowed: false, bundleAllowed: false,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 4, minimumIntervalMs: 0, publicService: true,
    notes: '免密钥，无 SLA。仅按视口获取；区域下载需专属 User-Agent 且不超过 3,000 瓦片或 50 MB，本应用未启用区域下载。底图遵循 OpenMapTiles schema。',
  },
  mapterhorn: {
    id: 'mapterhorn', label: 'Mapterhorn', policyURL: 'https://mapterhorn.com/attribution/', reviewedAt: '2026-11-13',
    requiredAttribution: ['Terrain © Mapterhorn / source providers'],
    attributionURLs: ['https://mapterhorn.com/attribution/'],
    printAttribution: ['Terrain © Mapterhorn / source providers · https://mapterhorn.com/attribution/'],
    sourceLicenseURLs: ['https://mapterhorn.com/attribution/','https://download.mapterhorn.com/attribution.json','https://mapterhorn.com/data-access/'],
    cacheMode: 'http', cacheTTL: 0, offlineAllowed: false, bundleAllowed: false,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 4, minimumIntervalMs: 0, publicService: true,
    notes: 'Terrarium 512 px WebP；数据依逐源许可，不能把项目代码 BSD 许可用于地形。快照和导出须保留官方来源清单链接及适用原始许可；本应用不打包或区域抓取原始 DEM。4 并发为本应用上限，不是官方额度。',
  },
  aws: {
    id: 'aws', label: 'AWS Terrain Tiles', policyURL: 'https://registry.opendata.aws/terrain-tiles/', reviewedAt: '2026-11-13',
    requiredAttribution: ['Terrain Tiles / Mapzen / source providers'],
    attributionURLs: ['https://github.com/tilezen/joerd/blob/master/docs/attribution.md'],
    printAttribution: ['Terrain Tiles / Mapzen / source providers · https://github.com/tilezen/joerd/blob/master/docs/attribution.md'],
    sourceLicenseURLs: ['https://registry.opendata.aws/terrain-tiles/','https://github.com/tilezen/joerd/blob/master/docs/attribution.md','https://www.mapzen.com/rights/'],
    cacheMode: 'http', cacheTTL: 0, offlineAllowed: false, bundleAllowed: false,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 4, minimumIntervalMs: 0, publicService: true,
    notes: '可选备用地形；Terrarium 256 px。AWS 注册页的 License 指向 Tilezen 逐源署名清单，不是统一 AWS 数据许可。图像/快照须保留源清单，切换后重新渲染；无账号访问不等于无限公共服务额度。4 并发为应用上限。',
  },
  photon: {
    id: 'photon', label: 'Photon', policyURL: 'https://github.com/komoot/photon#demo-server', reviewedAt: '2026-11-13',
    requiredAttribution: ['© OpenStreetMap contributors'], attributionURLs:['https://www.openstreetmap.org/copyright'],printAttribution: ['© OpenStreetMap contributors · https://www.openstreetmap.org/copyright'],
    sourceLicenseURLs:['https://github.com/komoot/photon#demo-server','https://www.openstreetmap.org/copyright'],
    cacheMode: 'memory', cacheTTL: 86_400_000, offlineAllowed: false, bundleAllowed: true,
    snapshotBundleAllowed: true, exportAllowed: true, maxConcurrency: 1, minimumIntervalMs: 1200, publicService: true,
    notes: '官方仅允许合理低频使用，无固定免费额度或 SLA。本应用限显式提交、去重与缓存，保守地串行且请求间隔至少 1.2 秒；不是服务方公布的限额。大规模部署应更换为自营实例。',
  },
});

/** Escape imported plain credit labels; declarative manifests never supply live HTML. */
export function providerAttributionHTML(policy:ProviderPolicy):string {
  const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  return policy.requiredAttribution.map((label,index)=>{
    const url=policy.attributionURLs?.[index];
    return url?`<a href="${escape(validateServiceURL(url).href)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`:escape(label);
  }).join(' · ');
}

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
