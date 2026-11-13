/** M06: versioned, declarative recipes; no network, document mutations or UI. */
import type { ArtworkDocument } from '../domain';
export interface ArtPalette {
  id: string; name: string; paper: string; ink: string; accent: string; land: string;
  water: string; park: string; road: string; roadCase: string; building: string;
  label: string; route: string;
}
export interface ArtStyle {
  id: string; version: string; name: string; english: string; description: string;
  font: string; texture: 'rice' | 'pencil' | 'parchment' | 'canvas' | 'grain' | 'none';
  roadWidth: number; labelDensity: number; palettes: ArtPalette[];
}
const palette = (id: string, name: string, paper: string, ink: string, accent: string, land: string, water: string, park: string, road: string, building: string): ArtPalette => ({ id, name, paper, ink, accent, land, water, park, road, roadCase: paper, building, label: ink, route: accent });
const serif = '"Noto Serif SC", Georgia, serif';
const sans = 'Inter, "Noto Sans SC", sans-serif';
export let STYLES: readonly ArtStyle[] = [
  { id: 'ink', version: '1.0.0', name: '东方水墨', english: 'Ink & wash', description: '墨色山水，朱砂留印', font: serif, texture: 'rice', roadWidth: .75, labelDensity: .75, palettes: [palette('jade', '青山', '#f4f0e6', '#303e3a', '#b04c3b', '#e7e8dc', '#bfd0ca', '#c4cbb9', '#7a8680', '#b8c0b8'), palette('indigo', '远岚', '#edf0ed', '#334553', '#ac5260', '#dce4e0', '#aec6d2', '#b9c8c5', '#7d919c', '#b6c4cc')] },
  { id: 'sketch', version: '1.0.0', name: '精致手绘', english: 'Field notes', description: '彩铅线条，轻柔淡彩', font: serif, texture: 'pencil', roadWidth: 1.15, labelDensity: .9, palettes: [palette('meadow', '原野', '#fbf6e9', '#4d5748', '#bc6f52', '#eee9d6', '#b5d9db', '#cad5b2', '#baab89', '#ddbd9d'), palette('rose', '暮色', '#fcf1ed', '#654e54', '#9f5571', '#f0e0da', '#b8cbdc', '#d7d3bd', '#b99f99', '#d7b5b2')] },
  { id: 'parchment', version: '1.0.0', name: '复古羊皮纸', english: 'An old atlas', description: '雕刻般道路，暖棕纸色', font: serif, texture: 'parchment', roadWidth: .95, labelDensity: .65, palettes: [palette('sepia', '航海', '#e8d5ad', '#594b34', '#9c5034', '#decda7', '#b7c2af', '#c3bc91', '#9a8056', '#c5ad80'), palette('night', '星图', '#ded2ba', '#3b4b58', '#aa6c38', '#cec6b5', '#93aab5', '#a9b19b', '#7b8584', '#b5b0a0')] },
  { id: 'oil', version: '1.0.0', name: '古典油画', english: 'Painted places', description: '深沉色块，细腻画布', font: serif, texture: 'canvas', roadWidth: 1.35, labelDensity: .65, palettes: [palette('olive', '橄榄', '#e9e0cb', '#384639', '#b78145', '#c7c7a8', '#809f9e', '#9bac88', '#e5d6b8', '#b8aa87'), palette('coast', '海岸', '#e7e1d8', '#3c5160', '#ac694b', '#cbd2c6', '#85a7ba', '#b3bc9b', '#f0e2cc', '#c6bda9')] },
  { id: 'poster', version: '1.0.0', name: '复古海报', english: 'Wish you were here', description: '限定色域，鲜明留白', font: sans, texture: 'grain', roadWidth: 1.7, labelDensity: .55, palettes: [palette('sunset', '落日', '#f4e6c9', '#2b555b', '#cf6949', '#e7ce9f', '#80b7be', '#b9b993', '#fff0cf', '#cd9e79'), palette('alpine', '山野', '#f0eddd', '#31594e', '#dc8d41', '#d3d7b1', '#9fbfc0', '#9bb896', '#fff2cf', '#c3bd96')] },
  { id: 'modern', version: '1.0.0', name: '极简现代', english: 'Quiet memories', description: '克制线条，让记忆留白', font: sans, texture: 'none', roadWidth: .85, labelDensity: .95, palettes: [palette('sage', '鼠尾草', '#f8f8f3', '#374a43', '#6e8272', '#e7ebe4', '#c4d8da', '#cbd9c5', '#fffef8', '#d8ddd7'), palette('lavender', '雾紫', '#f7f5f8', '#4d4759', '#8b6cac', '#e9e6ec', '#cbd4e0', '#d3dccc', '#ffffff', '#d8d1df')] },
];
export interface TemplateSlot {
  id: string; kind: 'map' | 'photo' | 'text' | 'decoration' | 'attribution';
  x: number; y: number; width: number; height: number;
  role?: string; text?: string; fontSize?: number;
}
export interface TemplateDefinition {
  id: string; family: string; name: string; english: string; description: string;
  ratio: [number, number]; shape: 'rectangle' | 'torn' | 'ticket'; variant: number; version: string;
  /** Extension slots use normalized full-artboard coordinates, never screen pixels. */
  slots?: TemplateSlot[]; aspectRatio?: number;
  layoutEngine?: 'builtin-v1'; layoutId?: string;
}
export let TEMPLATES: readonly TemplateDefinition[] = [
  { id: 'card-split', family: 'T01', name: '照片地图卡', english: 'SIDE BY SIDE', description: '地图与照片，相遇于一页', ratio: [3, 2], shape: 'rectangle', variant: 1, version: '1.0.0' },
  { id: 'card-strip', family: 'T01', name: '地图与影像', english: 'A PLACE, A MOMENT', description: '主地图与底部照片条带', ratio: [1, 1], shape: 'rectangle', variant: 2, version: '1.0.0' },
  { id: 'torn-art', family: 'T02', name: '撕纸双联', english: 'TWO WAYS TO REMEMBER', description: '原图与本地艺术版本', ratio: [3, 4], shape: 'torn', variant: 1, version: '1.0.0' },
  { id: 'torn-map', family: 'T02', name: '地图双联', english: 'A PIECE OF THE JOURNEY', description: '一半风景，一半足迹', ratio: [3, 4], shape: 'torn', variant: 2, version: '1.0.0' },
  { id: 'ticket-photo', family: 'T03', name: '城市旅签', english: 'COLLECT A MEMORY', description: '照片主视觉与旅程信息', ratio: [2, 1], shape: 'ticket', variant: 1, version: '1.0.0' },
  { id: 'ticket-map', family: 'T03', name: '地图旅签', english: 'TICKET TO SOMEWHERE', description: '地图主视觉与信息栏', ratio: [2, 1], shape: 'ticket', variant: 2, version: '1.0.0' },
  { id: 'poster-full', family: 'T04', name: '路线海报', english: 'THE LONG WAY HOME', description: '让整段旅程成为主画', ratio: [2, 3], shape: 'rectangle', variant: 1, version: '1.0.0' },
  { id: 'poster-photos', family: 'T04', name: '风景路线', english: 'PLACES WE KEEP', description: '区域地图与影像组', ratio: [3, 2], shape: 'rectangle', variant: 2, version: '1.0.0' },
  { id: 'film-vertical', family: 'T05', name: '时间胶片', english: 'ONE DAY AT A TIME', description: '按到访顺序留下片段', ratio: [2, 3], shape: 'rectangle', variant: 1, version: '1.0.0' },
  { id: 'film-horizontal', family: 'T05', name: '旅程长卷', english: 'EVERY LITTLE MOMENT', description: '横向胶片与地图', ratio: [3, 1], shape: 'rectangle', variant: 2, version: '1.0.0' },
  { id: 'collage-scatter', family: 'T06', name: '旅行拼贴', english: 'A LITTLE COLLECTION', description: '主地图与散落照片卡', ratio: [1, 1], shape: 'rectangle', variant: 1, version: '1.0.0' },
  { id: 'collage-grid', family: 'T06', name: '记忆方格', english: 'PIECES OF A PLACE', description: '照片网格中的地图', ratio: [4, 3], shape: 'rectangle', variant: 2, version: '1.0.0' },
];

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
STYLES = freeze(STYLES); TEMPLATES = freeze(TEMPLATES);
const styleVersions = new Map(STYLES.map(style => [`${style.id}@${style.version}`, style]));
const templateVersions = new Map(TEMPLATES.map(template => [`${template.id}@${template.version}`, template]));
const builtinStyles = new Map(STYLES.map(style => [style.id, style]));
const builtinIds = new Set([...STYLES, ...TEMPLATES].map(value => value.id));
const manifests = new Map<string, { signature: string; kind: 'style' | 'template'; manifest: DesignManifest }>();
const identifiers = /^[a-z][a-z0-9._-]{2,79}$/;
const versions = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/;
const colors = /^#[\da-f]{6}$/i;
const paletteKeys = ['paper', 'ink', 'accent', 'land', 'water', 'park', 'road', 'roadCase', 'building', 'label', 'route'] as const;
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'script', 'scripts', 'onload', 'onclick', 'eval', 'code', 'worker']);
type Plain = Record<string, unknown>;
export interface DesignManifest extends Record<string, unknown> {
  id: string; version: string; sdkRange: '1.x'; kind: 'style' | 'template'; name: string;
  capabilities: string[]; permissions: []; licenses: Plain[]; recipe: Plain;
}
function plain(value: unknown): value is Plain { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
/** Independent M06 trust boundary: imported artwork snapshots also pass here. */
function assertData(value: unknown, depth = 0, seen = new Set<object>()): void {
  if (depth > 24) throw new Error('设计扩展结构过深。');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('设计扩展不能包含非有限数字。'); return; }
  if (typeof value === 'string') { if (value.length > 40_000 || /(?:javascript:|vbscript:|<\s*(?:script|iframe|foreignObject)|on\w+\s*=|url\s*\()/i.test(value)) throw new Error('设计扩展只能包含声明式数据。'); return; }
  if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value)) || seen.has(value)) throw new Error('设计扩展必须是无循环的纯 JSON 数据。');
  seen.add(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string') || Object.keys(value).length > 2000) throw new Error('设计扩展字段过多或包含非 JSON 字段。');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (forbidden.has(key.toLowerCase()) || !('value' in descriptor)) throw new Error('设计扩展不允许脚本、原型或访问器。');
    if (Array.isArray(value) && key === 'length') continue;
    assertData(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function noResourceUrls(value: unknown): void {
  if (typeof value === 'string' && /(?:https?:|data:|file:|blob:|\/\/)/i.test(value)) throw new Error('风格和模板配方不允许外部资源地址。');
  if (Array.isArray(value)) value.forEach(noResourceUrls);
  else if (plain(value)) Object.values(value).forEach(noResourceUrls);
}
function text(value: unknown, fallback: string, limit = 200): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('设计扩展文字字段不合法。');
  return value;
}
function number(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`设计扩展数字须在 ${min}–${max} 之间。`);
  return value;
}
function manifestData(value: unknown): DesignManifest {
  assertData(value);
  if (!plain(value) || typeof value.id !== 'string' || !identifiers.test(value.id) || typeof value.version !== 'string' || value.version.length > 80 || !versions.test(value.version) || value.version.split('-')[0].split('.').some(part => !Number.isSafeInteger(Number(part)))) throw new Error('设计扩展需要有效 id 和明确语义版本。');
  if (value.sdkRange !== '1.x' || !['style', 'template'].includes(String(value.kind))) throw new Error('设计扩展类型或 SDK 版本不兼容。');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('设计扩展名称不合法。');
  if (!Array.isArray(value.capabilities) || value.capabilities.some(item => typeof item !== 'string' || item.length > 80) || !Array.isArray(value.permissions) || value.permissions.length) throw new Error('设计扩展能力声明不合法，且不能请求网络权限。');
  if (!Array.isArray(value.licenses) || !value.licenses.length || value.licenses.some(item => !plain(item) || typeof item.name !== 'string' || !item.name.trim() || typeof item.license !== 'string' || !item.license.trim() || (item.url !== undefined && (typeof item.url !== 'string' || !/^https:\/\//.test(item.url))))) throw new Error('设计扩展需要有效素材许可。');
  if (!plain(value.recipe)) throw new Error('设计扩展缺少纯数据配方。');
  noResourceUrls(value.recipe);
  return structuredClone(value) as unknown as DesignManifest;
}
function styleFromManifest(manifest: DesignManifest): ArtStyle {
  const recipe = manifest.recipe, base = builtinStyles.get(String(recipe.baseStyleId ?? 'modern'));
  if (!base) throw new Error('风格继承源必须是内置风格。');
  if (!plain(recipe.palette) || ['paper', 'ink', 'water', 'land', 'road', 'accent'].some(key => typeof (recipe.palette as Plain)[key] !== 'string' || !colors.test((recipe.palette as Plain)[key] as string))) throw new Error('风格需要 paper/ink/water/land/road/accent 六色。');
  const makePalette = (supplied: Plain, fallbackId: string, fallbackName: string): ArtPalette => {
    for (const key of paletteKeys) if (supplied[key] !== undefined && (typeof supplied[key] !== 'string' || !colors.test(supplied[key] as string))) throw new Error(`风格颜色 ${key} 不合法。`);
    if (['paper', 'ink', 'water', 'land', 'road', 'accent'].some(key => typeof supplied[key] !== 'string' || !colors.test(supplied[key] as string))) throw new Error('每个配色都需完整声明六个基本颜色。');
    const complete: ArtPalette = { ...base.palettes[0], id: text(supplied.id, fallbackId, 80), name: text(supplied.name, fallbackName, 100) };
    for (const key of paletteKeys) if (supplied[key] !== undefined) complete[key] = supplied[key] as string;
    // Semantic defaults stay consistent when an extension provides only its six required colors.
    complete.roadCase = String(supplied.roadCase ?? complete.paper); complete.label = String(supplied.label ?? complete.ink); complete.route = String(supplied.route ?? complete.accent);
    return complete;
  };
  let palettes = [makePalette(recipe.palette, text(recipe.paletteId, 'default', 80), text(recipe.paletteName, manifest.name, 100))];
  if (recipe.palettes !== undefined) {
    if (!Array.isArray(recipe.palettes) || !recipe.palettes.length || recipe.palettes.length > 8 || recipe.palettes.some(item => !plain(item))) throw new Error('风格配色列表不合法。');
    palettes = recipe.palettes.map((item, index) => makePalette(item as Plain, `palette-${index}`, `${manifest.name} ${index + 1}`));
    if (new Set(palettes.map(item => item.id)).size !== palettes.length) throw new Error('配色 id 不能重复。');
  }
  const texture = recipe.texture ?? base.texture;
  if (!['rice', 'pencil', 'parchment', 'canvas', 'grain', 'none'].includes(String(texture))) throw new Error('不支持的本地纹理。');
  if (recipe.font !== undefined && !['sans', 'serif'].includes(String(recipe.font))) throw new Error('风格字体只能选择已内置的 sans 或 serif。');
  return freeze({ id: manifest.id, version: manifest.version, name: manifest.name, english: text(recipe.english, manifest.name, 100), description: text(recipe.description, '本地声明式配色与地图样式'), font: recipe.font === 'serif' ? serif : recipe.font === 'sans' ? sans : base.font, texture: texture as ArtStyle['texture'], roadWidth: number(recipe.roadWidth, base.roadWidth, .25, 4), labelDensity: number(recipe.labelDensity, base.labelDensity, .2, 1.5), palettes });
}
function templateFromManifest(manifest: DesignManifest): TemplateDefinition {
  const recipe = manifest.recipe, aspectRatio = number(recipe.aspectRatio, 1.5, .25, 4);
  if (recipe.layoutEngine !== undefined) {
    const layoutIds = ['card-split', 'card-strip', 'torn-art', 'torn-map', 'ticket-photo', 'ticket-map', 'poster-full', 'poster-photos', 'film-vertical', 'film-horizontal', 'collage-scatter', 'collage-grid'];
    if (recipe.layoutEngine !== 'builtin-v1' || typeof recipe.layoutId !== 'string' || !layoutIds.includes(recipe.layoutId) || !['T01', 'T02', 'T03', 'T04', 'T05', 'T06'].includes(String(recipe.family)) || !Array.isArray(recipe.ratio) || recipe.ratio.length !== 2 || recipe.ratio.some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 100)) throw new Error('内置布局快照的引擎、比例或家族不兼容。');
    const ratio: [number, number] = [recipe.ratio[0] as number, recipe.ratio[1] as number];
    if (ratio[0] / ratio[1] < .25 || ratio[0] / ratio[1] > 4 || !['rectangle', 'torn', 'ticket'].includes(String(recipe.shape)) || ![1, 2].includes(Number(recipe.variant))) throw new Error('内置布局快照参数不合法。');
    return freeze({ id: manifest.id, version: manifest.version, name: manifest.name, english: text(recipe.english, manifest.name, 100), description: text(recipe.description, '冻结的内置布局配方'), family: String(recipe.family), ratio, shape: recipe.shape as TemplateDefinition['shape'], variant: Number(recipe.variant), layoutEngine: 'builtin-v1', layoutId: recipe.layoutId });
  }
  if (!Array.isArray(recipe.slots) || !recipe.slots.length || recipe.slots.length > 100) throw new Error('模板需声明 1–100 个有限槽位。');
  const ids = new Set<string>(), roles = new Set<string>();
  const slots: TemplateSlot[] = recipe.slots.map(value => {
    if (!plain(value) || typeof value.id !== 'string' || !/^[a-z][a-z0-9._-]{0,79}$/.test(value.id) || ids.has(value.id) || !['map', 'photo', 'text', 'decoration', 'attribution'].includes(String(value.kind))) throw new Error('模板槽位 id 或类型不合法、重复。');
    ids.add(value.id);
    const slot: TemplateSlot = { id: value.id, kind: value.kind as TemplateSlot['kind'], x: number(value.x, -1, 0, 1), y: number(value.y, -1, 0, 1), width: number(value.width, -1, .001, 1), height: number(value.height, -1, .001, 1) };
    if (slot.x < 0 || slot.y < 0 || slot.width <= 0 || slot.height <= 0 || slot.x + slot.width > 1 + 1e-8 || slot.y + slot.height > 1 + 1e-8) throw new Error('模板槽位超出画板或缺少尺寸。');
    if (slot.kind === 'text') {
      const role = String(value.role ?? (['title', 'date', 'message', 'coordinates', 'legend'].includes(slot.id) ? slot.id : 'caption'));
      if (!['title', 'date', 'message', 'coordinates', 'legend', 'caption'].includes(role) || (role !== 'caption' && roles.has(role))) throw new Error('模板文字角色不支持或重复。');
      roles.add(role); slot.role = role;
      if (value.text !== undefined) slot.text = text(value.text, '', 4000);
      if (role === 'caption' && !slot.text) throw new Error('静态文字槽位必须提供内容。');
      if (value.fontSize !== undefined) slot.fontSize = number(value.fontSize, 16, 8, 200);
    } else if (slot.kind === 'decoration') {
      const role = String(value.role ?? value.id);
      if (!['border', 'stamp', 'compass', 'string'].includes(role) || roles.has(role)) throw new Error('模板装饰角色不支持或重复。');
      roles.add(role); slot.role = role;
    }
    return slot;
  });
  if (slots.filter(slot => slot.kind === 'map').length !== 1 || slots.filter(slot => slot.kind === 'attribution').length !== 1) throw new Error('模板必须有且仅有一个地图槽位和一个不可删除的署名槽位。');
  const attribution = slots.find(slot => slot.kind === 'attribution')!;
  if (attribution.width < .2 || attribution.height < .015) throw new Error('模板署名区域过小。');
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    if ((a.kind === 'decoration' || b.kind === 'decoration') && a.kind !== 'attribution' && b.kind !== 'attribution') continue;
    if (a.x < b.x + b.width - 1e-8 && a.x + a.width > b.x + 1e-8 && a.y < b.y + b.height - 1e-8 && a.y + a.height > b.y + 1e-8) throw new Error('模板内容槽位重叠或遮挡署名。');
  }
  const shape = recipe.shape ?? 'rectangle'; if (!['rectangle', 'torn', 'ticket'].includes(String(shape))) throw new Error('模板纸张形状不支持。');
  return freeze({ id: manifest.id, version: manifest.version, family: 'extension', name: manifest.name, english: text(recipe.english, manifest.name, 100), description: text(recipe.description, '声明式地图、照片、文字与署名布局'), ratio: [aspectRatio, 1], aspectRatio, shape: shape as TemplateDefinition['shape'], variant: 1, slots });
}
function newer(next: string, prior: string): boolean {
  const [a, apre] = next.split('-', 2), [b, bpre] = prior.split('-', 2), an = a.split('.').map(Number), bn = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (an[i] !== bn[i]) return an[i] > bn[i];
  return !apre && !!bpre;
}
/** Installs pure data. A given id@version is immutable and every older version stays resolvable. */
export function installDesignManifest(value: unknown): ArtStyle | TemplateDefinition {
  const manifest = manifestData(value), key = `${manifest.id}@${manifest.version}`, signature = canonical(manifest), prior = manifests.get(key);
  if (prior) {
    if (prior.signature !== signature) throw new Error('同版本设计扩展不能被静默替换，请增加版本号。');
    return prior.kind === 'style' ? styleVersions.get(key)! : templateVersions.get(key)!;
  }
  const installed = manifest.kind === 'style' ? styleVersions.get(key) : templateVersions.get(key);
  if (installed) {
    const snapshot = getDesignManifest(manifest.kind, manifest.id, manifest.version);
    if (canonical(snapshot) !== signature) throw new Error('同版本内置设计不能被静默替换，请使用独立扩展 id。');
    manifests.set(key, { signature, kind: manifest.kind, manifest: freeze(manifest) }); return installed;
  }
  if ([...manifests.entries()].some(([existing, data]) => existing.startsWith(`${manifest.id}@`) && data.kind !== manifest.kind)) throw new Error('同一扩展 id 不能改变类型。');
  const definition = manifest.kind === 'style' ? styleFromManifest(manifest) : templateFromManifest(manifest);
  if (manifest.kind === 'style') {
    const style = definition as ArtStyle; styleVersions.set(key, style);
    const latest = STYLES.find(item => item.id === style.id);
    if (!latest || newer(style.version, latest.version)) STYLES = freeze([...STYLES.filter(item => item.id !== style.id), style]);
  } else {
    const template = definition as TemplateDefinition; templateVersions.set(key, template);
    const latest = TEMPLATES.find(item => item.id === template.id);
    if (!latest || newer(template.version, latest.version)) TEMPLATES = freeze([...TEMPLATES.filter(item => item.id !== template.id), template]);
  }
  manifests.set(key, { signature, kind: manifest.kind, manifest: freeze(manifest) });
  return definition;
}
function selectedStyle(style: ArtStyle, paletteId?: string) { return freeze({ ...style, palette: style.palettes.find(item => item.id === paletteId) ?? style.palettes[0] }); }
export function getStyle(id: string, paletteId?: string, version?: string) {
  const style = version ? styleVersions.get(`${id}@${version}`) : STYLES.find(item => item.id === id);
  if (!style && version) throw new Error(`缺少风格 ${id}@${version}，请恢复嵌入配方。`);
  return selectedStyle(style ?? STYLES[0], paletteId);
}
export function getTemplate(id: string, version?: string): TemplateDefinition {
  const template = version ? templateVersions.get(`${id}@${version}`) : TEMPLATES.find(item => item.id === id);
  if (!template && version) throw new Error(`缺少模板 ${id}@${version}，请恢复嵌入配方。`);
  return template ?? TEMPLATES[0];
}
function embedded(value: unknown, kind: 'style' | 'template', id: string, version: string) {
  const manifest = manifestData(value);
  if (manifest.kind !== kind || manifest.id !== id || manifest.version !== version) throw new Error('嵌入配方与作品记录的扩展版本不一致。');
  return kind === 'style' ? styleFromManifest(manifest) : templateFromManifest(manifest);
}
export function resolveStyle(art: Pick<ArtworkDocument, 'styleId' | 'styleVersion' | 'paletteId' | 'embeddedStyle'>) {
  return art.embeddedStyle ? selectedStyle(embedded(art.embeddedStyle, 'style', art.styleId, art.styleVersion) as ArtStyle, art.paletteId) : getStyle(art.styleId, art.paletteId, art.styleVersion);
}
export function resolveTemplate(art: Pick<ArtworkDocument, 'templateId' | 'templateVersion' | 'embeddedTemplate'>): TemplateDefinition {
  return art.embeddedTemplate ? embedded(art.embeddedTemplate, 'template', art.templateId, art.templateVersion) as TemplateDefinition : getTemplate(art.templateId, art.templateVersion);
}
export function templateSize(id: string, version?: string) {
  const [w, h] = getTemplate(id, version).ratio;
  return { width: Math.round(1000 * w / Math.max(w, h)), height: Math.round(1000 * h / Math.max(w, h)) };
}
export function mapRecipe(styleId: string, paletteId?: string, version?: string, embeddedStyle?: Record<string, unknown>) {
  const style = embeddedStyle ? resolveStyle({ styleId, paletteId: paletteId ?? '', styleVersion: version ?? String(embeddedStyle.version), embeddedStyle }) : getStyle(styleId, paletteId, version);
  return { ...style.palette, roadWidth: style.roadWidth, labelDensity: style.labelDensity };
}
/** Full portable recipe, suitable for ArtworkDocument.embeddedStyle / embeddedTemplate. */
export function getDesignManifest(kind: 'style' | 'template', id: string, version?: string): DesignManifest {
  const definition = kind === 'style' ? getStyle(id, undefined, version) : getTemplate(id, version);
  const key = `${definition.id}@${definition.version}`, registered = manifests.get(key);
  if (registered) { if (registered.kind !== kind) throw new Error('设计扩展类型不一致。'); return structuredClone(registered.manifest); }
  if (!builtinIds.has(id)) throw new Error(`缺少可嵌入的设计清单 ${key}。`);
  let recipe: Plain;
  if (kind === 'style') {
    const style = definition as ArtStyle;
    recipe = { english: style.english, description: style.description, font: style.font === serif ? 'serif' : 'sans', texture: style.texture, roadWidth: style.roadWidth, labelDensity: style.labelDensity, palette: structuredClone(style.palettes[0]), palettes: structuredClone(style.palettes) };
  } else {
    const template = definition as TemplateDefinition;
    recipe = { english: template.english, description: template.description, ratio: [...template.ratio], aspectRatio: template.ratio[0] / template.ratio[1], shape: template.shape, family: template.family, variant: template.variant, layoutEngine: 'builtin-v1', layoutId: template.layoutId ?? template.id };
  }
  return { id: definition.id, version: definition.version, sdkRange: '1.x', kind, name: definition.name, capabilities: kind === 'style' ? ['palette', 'map-semantic-colors', 'local-texture'] : ['map-slot', 'photo-slots', 'text', 'attribution', 'builtin-v1-layout'], permissions: [], licenses: [{ name: 'Travel Studio original design', license: 'MIT' }], recipe };
}
export function recommendTemplate(photos: number, visits: number, places: number) {
  if (photos === 1 && places <= 1) return 'ticket-photo';
  if (places > 5) return 'poster-full';
  if (visits > 2 && photos > 2) return 'film-vertical';
  if (photos > 4) return 'collage-scatter';
  return 'card-split';
}
