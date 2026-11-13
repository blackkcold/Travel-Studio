export type ExtensionKind = 'style' | 'template' | 'map-provider';
export interface ExtensionLicense { name: string; license: string; url?: string; attribution?: string }
export interface ExtensionManifest {
  id: string;
  version: string;
  sdkRange: '1.x';
  kind: ExtensionKind;
  name: string;
  capabilities: string[];
  permissions: ('network-map-data')[];
  licenses: ExtensionLicense[];
  recipe: Record<string, unknown>;
}
export interface ExtensionEntry { manifest: ExtensionManifest; state: 'registered' | 'active' | 'inactive'; usedBy: string[] }

const identifier = /^[a-z][a-z0-9._-]{2,79}$/;
const semver = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor', 'script', 'scripts', 'onload', 'onclick', 'eval', 'code', 'worker']);
function assertDeclarative(value: unknown, path = 'manifest', depth = 0): void {
  if (depth > 30) throw new Error(`${path}: 扩展结构过深。`);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    if (value.length > 40_000 || /(?:javascript:|vbscript:|<\s*script|<\s*iframe|<\s*foreignObject|on\w+\s*=|url\s*\()/i.test(value)) throw new Error(`${path}: 不允许可执行代码或外部嵌入。`);
    return;
  }
  if (Array.isArray(value)) { if (value.length > 2_000) throw new Error(`${path}: 项目数过多。`); value.forEach((v, i) => assertDeclarative(v, `${path}[${i}]`, depth + 1)); return; }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${path}: 仅支持声明式 JSON 数据。`);
  for (const [key, nested] of Object.entries(value)) {
    if (dangerousKeys.has(key.toLowerCase())) throw new Error(`${path}.${key}: 不允许脚本或原型字段。`);
    assertDeclarative(nested, `${path}.${key}`, depth + 1);
  }
}
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function publicHttps(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0'));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) && url.hostname.includes('.');
  } catch { return false; }
}

/** Accept data, never JS/SVG/HTML executable bundles. Unknown keys remain data only. */
export function validateExtension(value: unknown): ExtensionManifest {
  assertDeclarative(value);
  if (!plain(value)) throw new Error('扩展清单必须是 JSON 对象。');
  if (typeof value.id !== 'string' || !identifier.test(value.id)) throw new Error('扩展 id 不合法。');
  if (typeof value.version !== 'string' || !semver.test(value.version)) throw new Error('扩展必须使用明确的语义版本。');
  if (value.sdkRange !== '1.x') throw new Error('扩展 SDK 不兼容；已保留原配置，可更新或替换扩展。');
  if (!['style', 'template', 'map-provider'].includes(String(value.kind))) throw new Error('不支持的扩展类型。');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('扩展名称不合法。');
  if (!Array.isArray(value.capabilities) || value.capabilities.some(v => typeof v !== 'string' || v.length > 80)) throw new Error('缺少能力声明。');
  if (!Array.isArray(value.permissions) || value.permissions.some(v => v !== 'network-map-data')) throw new Error('不支持的扩展权限。');
  if (value.kind !== 'map-provider' && value.permissions.length) throw new Error('声明式风格/模板没有联网权限。');
  if (!Array.isArray(value.licenses) || !value.licenses.length || value.licenses.some(v => !plain(v) || typeof v.name !== 'string' || typeof v.license !== 'string' || (v.url && !publicHttps(v.url)))) throw new Error('缺少有效素材许可。');
  if (!plain(value.recipe)) throw new Error('缺少声明式配方。');
  if (value.kind === 'style') {
    const colors = value.recipe.palette;
    if (!plain(colors) || ['paper', 'ink', 'water', 'land', 'road', 'accent'].some(key => typeof colors[key] !== 'string' || !/^#[\da-f]{6}$/i.test(colors[key] as string))) throw new Error('风格需声明 paper/ink/water/land/road/accent 六色。');
    if (findUrls(value.recipe).length) throw new Error('风格配方仅允许本地、纯数据资源。');
  } else if (value.kind === 'template') {
    if (!Array.isArray(value.recipe.slots) || !value.recipe.slots.length || value.recipe.slots.length > 100) throw new Error('模板必须提供有限的 slots。');
    for (const slot of value.recipe.slots) {
      if (!plain(slot) || !['map', 'photo', 'text', 'decoration', 'attribution'].includes(String(slot.kind)) || ['x', 'y', 'width', 'height'].some(key => typeof slot[key] !== 'number' || !Number.isFinite(slot[key]) || (slot[key] as number) < 0 || (slot[key] as number) > 1)) throw new Error('模板槽位须为 0–1 的归一坐标。');
      if ((slot.x as number) + (slot.width as number) > 1.001 || (slot.y as number) + (slot.height as number) > 1.001) throw new Error('模板槽位越出画板。');
    }
    if (findUrls(value.recipe).length) throw new Error('模板仅允许本地、纯数据资源。');
  } else {
    if (!value.permissions.includes('network-map-data')) throw new Error('地图扩展需明确声明 network-map-data。');
    const recipe = value.recipe;
    if (!publicHttps(recipe.tilejson) || !plain(recipe.schema) || ['water', 'transportation', 'building', 'place'].some(key => typeof (recipe.schema as Record<string, unknown>)[key] !== 'string')) throw new Error('地图扩展须声明 HTTPS TileJSON 及语义 schema 映射。');
    if (typeof recipe.attribution !== 'string' || !recipe.attribution.trim() || !plain(recipe.policy) || !publicHttps(recipe.policy.policyURL)) throw new Error('地图扩展缺少来源署名或服务政策。');
    for (const url of findUrls(recipe)) if (!publicHttps(url)) throw new Error('地图扩展只允许公开 HTTPS 地址。');
  }
  return structuredClone(value) as unknown as ExtensionManifest;
}
function findUrls(value: unknown): string[] {
  if (typeof value === 'string') return /^(?:https?:|data:|file:|blob:|\/\/)/i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(findUrls);
  if (plain(value)) return Object.values(value).flatMap(findUrls);
  return [];
}

export class ExtensionRegistry {
  private entries = new Map<string, ExtensionEntry>();
  private key(id: string, version: string): string { return `${id}@${version}`; }
  register(value: unknown): ExtensionEntry {
    const manifest = validateExtension(value);
    const key = this.key(manifest.id, manifest.version);
    const existing = this.entries.get(key);
    if (existing) {
      if (JSON.stringify(existing.manifest) !== JSON.stringify(manifest)) throw new Error('同版本扩展内容不能被静默替换。请增加版本号。');
      return structuredClone(existing);
    }
    const entry: ExtensionEntry = { manifest, state: 'registered', usedBy: [] };
    this.entries.set(key, entry);
    return structuredClone(entry);
  }
  activate(id: string, version: string): ExtensionEntry { const entry = this.require(id, version); entry.state = 'active'; return structuredClone(entry); }
  deactivate(id: string, version: string): void { const entry = this.require(id, version); entry.state = 'inactive'; }
  retain(id: string, version: string, artworkId: string): void { const entry = this.require(id, version); if (!entry.usedBy.includes(artworkId)) entry.usedBy.push(artworkId); }
  release(id: string, version: string, artworkId: string): void { const entry = this.require(id, version); entry.usedBy = entry.usedBy.filter(value => value !== artworkId); }
  dispose(id: string, version: string): void {
    const entry = this.require(id, version);
    if (entry.usedBy.length) throw new Error(`扩展仍被 ${entry.usedBy.length} 件作品引用。请先替换或保留嵌入配方。`);
    this.entries.delete(this.key(id, version));
  }
  snapshot(id: string, version: string): ExtensionManifest { return structuredClone(this.require(id, version).manifest); }
  list(): ExtensionEntry[] { return [...this.entries.values()].map(value => structuredClone(value)); }
  private require(id: string, version: string): ExtensionEntry { const entry = this.entries.get(this.key(id, version)); if (!entry) throw new Error(`缺少扩展 ${id}@${version}；作品仍可使用已保存预览。`); return entry; }
}

export async function readExtensionFile(file: Blob): Promise<ExtensionManifest> {
  if (file.size > 1_000_000) throw new Error('扩展清单超过 1 MB。');
  return validateExtension(JSON.parse(await file.text()));
}
