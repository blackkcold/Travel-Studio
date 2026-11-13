import type { DomainIssue, ProjectDocument, ValidationResult } from './types';

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const text = (x: unknown): x is string => typeof x === 'string' && x.length <= 100_000;
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 256 && !forbiddenKeys.has(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const coordinate = (x: unknown): boolean => Array.isArray(x) && x.length === 2 && finite(x[0]) && finite(x[1]) && Math.abs(x[0]) <= 180 && Math.abs(x[1]) <= 90;
const enumOf = (x: unknown, choices: string[]): boolean => typeof x === 'string' && choices.includes(x);
const unique = (xs: unknown[]): boolean => new Set(xs).size === xs.length;
const bounded = (value: unknown, min: number, max: number) => finite(value) && value >= min && value <= max;

export function validateProject(input: unknown): ValidationResult {
  const issues: DomainIssue[] = [];
  const issue = (path: string, message: string) => { if (issues.length < 100) issues.push({ path, message }); };
  const check = (condition: unknown, path: string, message: string) => { if (!condition) issue(path, message); };
  let visited = 0;
  const seen = new WeakSet<object>();
  function safeJson(x: unknown, path: string, depth: number): void {
    if (++visited > 2_000_000) { if (visited === 2_000_001) issue(path, '项目超过节点预算'); return; }
    if (depth > 40) { issue(path, '项目嵌套过深'); return; }
    if (typeof x === 'number' && !Number.isFinite(x)) issue(path, '数值必须有限');
    if (typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint') issue(path, '只允许可序列化 JSON');
    if (!x || typeof x !== 'object') return;
    if (seen.has(x)) { issue(path, '项目中不允许循环引用'); return; }
    seen.add(x);
    if (!Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null) issue(path, '只允许普通数据对象');
    for (const [key, val] of Object.entries(x)) { if (forbiddenKeys.has(key)) issue(`${path}.${key}`, '不允许原型字段'); else safeJson(val, `${path}.${key}`, depth + 1); }
    seen.delete(x);
  }
  safeJson(input, '$', 0);
  if (!record(input)) return { valid: false, issues: [{ path: '$', message: '项目必须是对象' }] };
  check(input.schemaVersion === 1, 'schemaVersion', '不支持的项目版本');
  check(id(input.id), 'id', '项目 ID 无效'); check(text(input.name), 'name', '项目名称无效');
  check(Number.isSafeInteger(input.revision) && (input.revision as number) >= 0, 'revision', '修订必须是非负整数');
  check(text(input.createdAt) && text(input.updatedAt), 'timestamps', '缺少项目时间戳');
  if (!record(input.library)) { issue('library', '缺少旅行资料库'); return { valid: false, issues }; }
  function rows(value: unknown, path: string, max = 100_000): Record<string, unknown>[] {
    if (!Array.isArray(value)) { issue(path, '必须是数组'); return []; }
    check(value.length <= max, path, '条目数量超过预算');
    const valid: Record<string, unknown>[] = [];
    value.forEach((item, n) => { if (record(item)) valid.push(item); else issue(`${path}[${n}]`, '条目必须是对象'); });
    check(unique(valid.map(x => x.id)), path, 'ID 不得重复');
    valid.forEach((item, n) => check(id(item.id), `${path}[${n}].id`, 'ID 无效'));
    return valid;
  }
  const photos = rows(input.library.photos, 'library.photos'); const places = rows(input.library.places, 'library.places'); const visits = rows(input.library.visits, 'library.visits');
  const assets = rows(input.assets, 'assets'); const artworks = rows(input.artworks, 'artworks', 1000); const provenance = rows(input.provenance, 'provenance', 10000);
  const assetIds = new Set(assets.map(x => x.id)); const placeIds = new Set(places.map(x => x.id)); const photoIds = new Set(photos.map(x => x.id)); const visitIds = new Set(visits.map(x => x.id));
  const attributionIds = new Set(provenance.map(x => x.id));
  function refs(value: unknown, known: Set<unknown>, path: string): void {
    if (!Array.isArray(value)) { issue(path, '引用必须是数组'); return; }
    check(unique(value), path, '引用不得重复'); value.forEach((ref, n) => check(id(ref) && known.has(ref), `${path}[${n}]`, '引用不存在'));
  }
  function assetRef(value: unknown, path: string, required = false): void { if (required || value !== undefined) check(id(value) && assetIds.has(value), path, '资源引用不存在'); }
  function time(value: unknown, path: string): void {
    if (!record(value)) { issue(path, '缺少时间证据'); return; }
    check(enumOf(value.precision, ['instant', 'local', 'date', 'unknown']), path, '时间精度无效');
    check(enumOf(value.source, ['exif', 'user', 'provider', 'unknown']), path, '时间来源无效');
    if (value.precision !== 'unknown') {
      check(text(value.value), `${path}.value`, '已知时间必须有原值');
      const match = typeof value.value === 'string' ? value.value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/) : null;
      if (!match) issue(`${path}.value`, '时间格式不正确');
      else { const [year, month, day, hour, minute, second] = match.slice(1).map(x => Number(x ?? 0)); const date = new Date(0); date.setUTCFullYear(year, month - 1, day); check(year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59, `${path}.value`, '日期或时刻不存在'); }
      if (value.precision === 'local') check(typeof value.value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value.value), `${path}.value`, '本地墙上时间不得伪装为绝对时刻');
    }
    if (value.offset !== undefined) check(typeof value.offset === 'string' && /^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value.offset), `${path}.offset`, '时区偏移无效');
    if (value.precision === 'date') check(typeof value.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.value), `${path}.value`, '日期必须是 YYYY-MM-DD');
    if (value.precision === 'instant') check(typeof value.value === 'string' && (/([+-]\d{2}:\d{2}|Z)$/.test(value.value) || typeof value.offset === 'string') && Number.isFinite(Date.parse(value.utc as string || `${value.value}${/([+-]\d{2}:\d{2}|Z)$/.test(String(value.value)) ? '' : value.offset ?? ''}`)), `${path}.value`, '绝对时刻缺少可核对的时区偏移');
  }
  assets.forEach((a, i) => {
    const path = `assets[${i}]`; check(typeof a.hash === 'string' && /^[a-f0-9]{64}$/i.test(a.hash), `${path}.hash`, '资源 SHA-256 无效'); check(text(a.mime), `${path}.mime`, '资源 MIME 无效'); check(Number.isSafeInteger(a.byteLength) && (a.byteLength as number) >= 0, `${path}.byteLength`, '资源大小无效');
    check(enumOf(a.kind, ['original', 'proxy', 'thumbnail', 'derived', 'map-snapshot', 'texture', 'font', 'preview']), `${path}.kind`, '资源类型无效'); assetRef(a.sourceAssetId, `${path}.sourceAssetId`);
    if (a.derivation !== undefined) {
      const derived = a.derivation;
      if (!record(derived)) issue(`${path}.derivation`, '衍生来源必须是对象');
      else {
        check(a.kind === 'derived' && derived.kind === 'ai-stylize' && derived.consentPurpose === 'stylize', `${path}.derivation`, 'AI 衍生类型或授权用途不一致');
        check(typeof derived.inputHash === 'string' && /^[a-f0-9]{64}$/i.test(derived.inputHash) && derived.inputHash === a.sourceAssetId, `${path}.derivation.inputHash`, 'AI 输入哈希必须对应 sourceAssetId');
        for (const field of ['providerId', 'model']) check(typeof derived[field] === 'string' && !!(derived[field] as string).trim() && (derived[field] as string).length <= 300, `${path}.derivation.${field}`, 'AI 服务或模型标识无效');
        check(typeof derived.prompt === 'string' && derived.prompt.length <= 40_000, `${path}.derivation.prompt`, 'AI 生成要求过长或无效');
        check(typeof derived.generatedAt === 'string' && derived.generatedAt.length <= 100 && Number.isFinite(Date.parse(derived.generatedAt)), `${path}.derivation.generatedAt`, 'AI 生成时间无效');
      }
    }
  });
  const assetById = new Map(assets.map(a => [a.id, a]));
  for (const asset of assets) { const chain = new Set<unknown>(); let cursor: Record<string, unknown> | undefined = asset; while (cursor?.sourceAssetId) { if (chain.has(cursor.id)) { issue(`assets.${String(asset.id)}`, '衍生资源链不能成环'); break; } chain.add(cursor.id); cursor = assetById.get(cursor.sourceAssetId); } }
  places.forEach((p, i) => { const path = `library.places[${i}]`; check(text(p.name), `${path}.name`, '地点名无效'); check(text(p.crs) && text(p.source), path, '缺少坐标系或来源'); check(enumOf(p.precision, ['exact', 'street', 'city', 'region', 'unknown']), `${path}.precision`, '位置精度无效'); check(enumOf(p.status, ['confirmed', 'candidate', 'missing']), `${path}.status`, '位置状态无效'); if (p.coordinate !== undefined) check(coordinate(p.coordinate), `${path}.coordinate`, '经纬度范围无效'); if (p.status === 'confirmed') check(coordinate(p.coordinate), `${path}.coordinate`, '确认地点必须有有效坐标'); });
  photos.forEach((p, i) => { const path = `library.photos[${i}]`; assetRef(p.assetId, `${path}.assetId`, true); assetRef(p.thumbnailAssetId, `${path}.thumbnailAssetId`); assetRef(p.proxyAssetId, `${path}.proxyAssetId`); check(text(p.name) && text(p.mime), path, '缺少照片名称或格式'); check(finite(p.width) && p.width > 0 && finite(p.height) && p.height > 0, path, '照片尺寸无效'); time(p.time, `${path}.time`); if (p.placeId !== undefined) check(placeIds.has(p.placeId), `${path}.placeId`, '地点引用不存在'); if (p.visitId !== undefined) check(visitIds.has(p.visitId), `${path}.visitId`, '到访引用不存在'); });
  visits.forEach((v, i) => {
    const path = `library.visits[${i}]`; refs(v.photoIds, photoIds, `${path}.photoIds`); if (v.placeId !== undefined) check(placeIds.has(v.placeId), `${path}.placeId`, '地点引用不存在'); check(Number.isSafeInteger(v.stableIndex) && (v.stableIndex as number) >= 0, `${path}.stableIndex`, '稳定次序无效'); time(v.time, `${path}.time`);
    if (v.history !== undefined) {
      if (!Array.isArray(v.history)) issue(`${path}.history`, '到访命令历史必须是数组');
      else for (const [index, entry] of v.history.entries()) {
        const entryPath = `${path}.history[${index}]`;
        if (!record(entry)) { issue(entryPath, '到访命令记录无效'); continue; }
        check(id(entry.id) && enumOf(entry.kind, ['merge', 'split', 'time']) && typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at)), entryPath, '到访命令身份、类型或时间无效');
        check(Array.isArray(entry.targetVisitIds) && entry.targetVisitIds.length > 0 && unique(entry.targetVisitIds) && entry.targetVisitIds.every(id), `${entryPath}.targetVisitIds`, '历史目标身份无效');
        if (!Array.isArray(entry.sourceVisits) || !entry.sourceVisits.length) issue(`${entryPath}.sourceVisits`, '到访命令缺少原始来源');
        else for (const [sourceIndex, source] of entry.sourceVisits.entries()) {
          const sourcePath = `${entryPath}.sourceVisits[${sourceIndex}]`;
          if (!record(source)) { issue(sourcePath, '来源快照必须是对象'); continue; }
          check(id(source.visitId) && Number.isSafeInteger(source.stableIndex) && (source.stableIndex as number) >= 0 && text(source.createdAt), sourcePath, '历史到访来源无效');
          check(Array.isArray(source.photoIds) && unique(source.photoIds) && source.photoIds.every(id), `${sourcePath}.photoIds`, '历史照片身份无效');
          if (source.placeId !== undefined) check(id(source.placeId), `${sourcePath}.placeId`, '历史地点身份无效');
          time(source.time, `${sourcePath}.time`);
        }
      }
    }
  });
  provenance.forEach((p, i) => { check(text(p.label) && typeof p.required === 'boolean', `provenance[${i}]`, '署名数据无效'); if (p.url !== undefined) check(typeof p.url === 'string' && /^https?:\/\//.test(p.url), `provenance[${i}].url`, '来源地址必须是 HTTP(S)'); });
  function selectionRecipe(value: unknown, path: string): void {
    if (!record(value)) { issue(path, '缺少选择规则'); return; }
    check(text(value.scopeId) && enumOf(value.combine, ['all', 'any']), path, '选择范围或组合方式无效');
    for (const name of ['manualInclude', 'manualExclude']) { if (!Array.isArray(value[name])) issue(`${path}.${name}`, '人工例外必须是数组'); else for (const ref of value[name]) check(record(ref) && enumOf(ref.kind, ['photo', 'explicit-visit']) && id(ref.id), `${path}.${name}`, '人工例外引用无效'); }
    if (!Array.isArray(value.predicates)) { issue(`${path}.predicates`, '选择条件必须是数组'); return; }
    for (const p of value.predicates) { if (!record(p)) { issue(`${path}.predicates`, '选择条件无效'); continue; } if (p.type === 'date') check(text(p.anchor) && /^\d{4}-\d{2}-\d{2}$/.test(p.anchor) && Number.isInteger(p.daysBefore) && Number.isInteger(p.daysAfter) && (p.daysBefore as number) >= 0 && (p.daysAfter as number) >= 0, `${path}.predicates`, '日期范围无效'); else if (p.type === 'radius') check(coordinate(p.center) && finite(p.radiusKm) && p.radiusKm >= 0 && p.radiusKm <= 40_100, `${path}.predicates`, '地理半径无效'); else if (p.type === 'bounds') check([p.west, p.south, p.east, p.north].every(finite) && (p.south as number) <= (p.north as number), `${path}.predicates`, '地图范围无效'); else issue(`${path}.predicates`, '未知选择条件'); }
  }
  function crop(value: unknown, path: string): void { if (value === undefined) return; if (!record(value) || !bounded(value.x, 0, 1) || !bounded(value.y, 0, 1) || !bounded(value.zoom, 1, 32) || !bounded(value.rotation, -360, 360)) issue(path, '裁切焦点、倍率或旋转超范围'); }
  artworks.forEach((a, i) => {
    const path = `artworks[${i}]`; check(text(a.name) && text(a.templateId) && text(a.styleId) && text(a.paletteId), path, '作品身份/设计包无效');
    if (!record(a.artboard)) issue(`${path}.artboard`, '缺少画板'); else { for (const key of ['width', 'height', 'physicalWidthMm', 'physicalHeightMm']) check(finite(a.artboard[key]) && (a.artboard[key] as number) > 0 && (a.artboard[key] as number) <= 100_000, `${path}.artboard.${key}`, '画板尺寸无效'); for (const key of ['bleedMm', 'safeMarginMm']) check(finite(a.artboard[key]) && (a.artboard[key] as number) >= 0, `${path}.artboard.${key}`, '出血/安全边距无效'); }
    if (!record(a.canonicalCamera)) issue(`${path}.canonicalCamera`, '缺少作品相机'); else { check(coordinate(a.canonicalCamera.center), `${path}.canonicalCamera.center`, '相机中心无效'); for (const k of ['zoom', 'bearing', 'pitch', 'exaggeration']) check(finite(a.canonicalCamera[k]), `${path}.canonicalCamera.${k}`, '相机参数无效'); check((a.canonicalCamera.zoom as number) >= 0 && (a.canonicalCamera.zoom as number) <= 24, `${path}.canonicalCamera.zoom`, '地图层级超范围'); check((a.canonicalCamera.pitch as number) >= 0 && (a.canonicalCamera.pitch as number) <= 85, `${path}.canonicalCamera.pitch`, '俯仰角超范围'); check(typeof a.canonicalCamera.terrain === 'boolean' && enumOf(a.canonicalCamera.projection, ['mercator', 'globe']) && enumOf(a.canonicalCamera.terrainProvider, ['mapterhorn', 'aws']), `${path}.canonicalCamera`, '地图模式无效'); }
    if (record(a.canonicalCamera)) { const camera = a.canonicalCamera; check(bounded(camera.bearing, -360, 360) && bounded(camera.exaggeration, 0, 10), `${path}.canonicalCamera`, '方位或地形倍率超范围'); if (camera.roll !== undefined) check(bounded(camera.roll, -180, 180), `${path}.canonicalCamera.roll`, '相机滚转超范围'); if (camera.elevation !== undefined) check(bounded(camera.elevation, -12000, 100000), `${path}.canonicalCamera.elevation`, '相机目标高程超范围'); }
    if (!record(a.metadata) || !text(a.metadata.title) || !text(a.metadata.date) || !text(a.metadata.message)) issue(`${path}.metadata`, '作品文字无效');
    if (!record(a.layout) || !enumOf(a.layout.mode, ['auto', 'assisted', 'free']) || !Number.isSafeInteger(a.layout.layoutRevision)) issue(`${path}.layout`, '布局状态无效');
    if (!record(a.visibility) || Object.values(a.visibility).some(x => typeof x !== 'boolean')) issue(`${path}.visibility`, '显隐状态无效');
    const nodes = rows(a.nodes, `${path}.nodes`, 10000); const nodeIds = new Set(nodes.map(x => x.id));
    nodes.forEach((n, j) => { const p = `${path}.nodes[${j}]`; check(enumOf(n.kind, ['background', 'paper', 'map', 'photo', 'text', 'annotation', 'route', 'decoration', 'group', 'attribution']), `${p}.kind`, '未知场景节点'); check(text(n.role) && typeof n.visible === 'boolean' && finite(n.zIndex), p, '节点属性无效'); if (!record(n.transform) || !['x', 'y', 'width', 'height', 'rotation'].every(k => finite((n.transform as Record<string, unknown>)[k]))) issue(`${p}.transform`, '节点变换无效'); else check((n.transform.width as number) >= 0 && (n.transform.height as number) >= 0, `${p}.transform`, '节点尺寸不得为负'); if (!record(n.constraint) || !enumOf(n.constraint.position, ['auto', 'pinned']) || !enumOf(n.constraint.size, ['auto', 'fixed']) || !enumOf(n.constraint.crop, ['auto', 'fixed'])) issue(`${p}.constraint`, '独立锁定约束无效'); assetRef(n.assetId, `${p}.assetId`); if (record(n.photoEdit)) assetRef(n.photoEdit.derivedAssetId, `${p}.photoEdit.derivedAssetId`); if (n.parentId !== undefined) check(nodeIds.has(n.parentId) && n.parentId !== n.id, `${p}.parentId`, '父节点引用无效'); });
    const parentLookup = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
      crop(node.crop, `${path}.nodes.${String(node.id)}.crop`);
      if (record(node.photoEdit)) { crop(node.photoEdit.crop, `${path}.nodes.${String(node.id)}.photoEdit.crop`); check(bounded(node.photoEdit.exposure, -2, 2) && bounded(node.photoEdit.contrast, 0, 2) && bounded(node.photoEdit.saturation, 0, 2) && bounded(node.photoEdit.intensity, 0, 1), `${path}.nodes.${String(node.id)}.photoEdit`, '照片处理参数超范围'); }
      if (node.opacity !== undefined) check(bounded(node.opacity, 0, 1), `${path}.nodes.${String(node.id)}.opacity`, '透明度超范围');
      if (node.fontSize !== undefined) check(bounded(node.fontSize, 1, 1000), `${path}.nodes.${String(node.id)}.fontSize`, '字号超范围');
      if (record(node.transform)) check(Object.values(node.transform).every(value => bounded(value, -100000, 100000)), `${path}.nodes.${String(node.id)}.transform`, '节点变换超预算');
      if (record(node.userOverrides) && node.userOverrides.fontSize !== undefined) check(bounded(Number(node.userOverrides.fontSize), 1, 1000), `${path}.nodes.${String(node.id)}.userOverrides.fontSize`, '人工字号超范围');
      const ancestors = new Set<unknown>(); let cursor: Record<string, unknown> | undefined = node; while (cursor?.parentId) { if (ancestors.has(cursor.id)) { issue(`${path}.nodes.${String(node.id)}.parentId`, '场景父级引用不能成环'); break; } ancestors.add(cursor.id); cursor = parentLookup.get(cursor.parentId); }
    }
    const bindings: Record<string, unknown>[] = Array.isArray(a.frozenPhotoBindings) ? a.frozenPhotoBindings.filter(record) : [];
    check(Array.isArray(a.frozenPhotoBindings), `${path}.frozenPhotoBindings`, '缺少冻结照片引用'); check(unique(bindings.map(b => b.photoId)), `${path}.frozenPhotoBindings`, '冻结照片身份不得重复');
    bindings.forEach((b, j) => { check(id(b.photoId), `${path}.frozenPhotoBindings[${j}]`, '照片身份无效'); for (const k of ['assetId', 'thumbnailAssetId', 'proxyAssetId', 'derivedAssetId']) assetRef(b[k], `${path}.frozenPhotoBindings[${j}].${k}`, k === 'assetId'); });
    assetRef(a.previewAssetId, `${path}.previewAssetId`); assetRef(a.mapSnapshotAssetId, `${path}.mapSnapshotAssetId`); refs(a.attributionIds, attributionIds, `${path}.attributionIds`);
    if (a.derivedAssetIds !== undefined) refs(a.derivedAssetIds, assetIds, `${path}.derivedAssetIds`);
    if (a.mapSnapshot !== undefined) {
      const snapshot = a.mapSnapshot;
      if (!record(snapshot)) issue(`${path}.mapSnapshot`, '地图快照元数据无效');
      else { check(snapshot.version === 1 && id(snapshot.inputHash) && typeof snapshot.snapshotBundleAllowed === 'boolean', `${path}.mapSnapshot`, '快照版本或能力无效'); for (const field of ['width', 'height', 'logicalWidth', 'logicalHeight']) check(bounded(snapshot[field], 1, 100000), `${path}.mapSnapshot.${field}`, '快照尺寸无效'); for (const field of ['attribution', 'printAttribution']) check(Array.isArray(snapshot[field]) && (snapshot[field] as unknown[]).every(text), `${path}.mapSnapshot.${field}`, '快照缺少来源署名'); check(Array.isArray(snapshot.annotations) && snapshot.annotations.every((value: unknown) => record(value) && id(value.visitId) && finite(value.x) && finite(value.y) && typeof value.visible === 'boolean' && (value.number === null || Number.isSafeInteger(value.number))), `${path}.mapSnapshot.annotations`, '快照注释无效'); check(record(snapshot.receipt), `${path}.mapSnapshot.receipt`, '快照缺少资源回执'); }
    }
    if (a.mapSource !== undefined) check(record(a.mapSource), `${path}.mapSource`, '地图 Provider 快照必须是声明式对象');
    if (!record(a.journey)) { issue(`${path}.journey`, '缺少冻结行程'); return; }
    const journey = a.journey; selectionRecipe(journey.recipe, `${path}.journey.recipe`);
    if (journey.sourceLibraryHash !== undefined) check(typeof journey.sourceLibraryHash === 'string' && journey.sourceLibraryHash.length > 0 && journey.sourceLibraryHash.length <= 200, `${path}.journey.sourceLibraryHash`, '资料库内容指纹无效');
    const frozen = rows(journey.resolvedVisits, `${path}.journey.resolvedVisits`); const frozenIds = new Set(frozen.map(x => x.id));
    frozen.forEach((v, j) => { if (v.coordinate !== undefined) check(coordinate(v.coordinate), `${path}.journey.resolvedVisits[${j}].coordinate`, '冻结坐标无效'); time(v.time, `${path}.journey.resolvedVisits[${j}].time`); });
    refs(journey.selectedPhotoIds, new Set(bindings.map(b => b.photoId)), `${path}.journey.selectedPhotoIds`); refs(journey.selectedVisitIds, frozenIds, `${path}.journey.selectedVisitIds`); refs(journey.explicitVisitIds, frozenIds, `${path}.journey.explicitVisitIds`);
    if (!record(journey.order)) issue(`${path}.journey.order`, '缺少到访顺序'); else { check(enumOf(journey.order.mode, ['time', 'manual']) && enumOf(journey.order.timeBasis, ['instant', 'recorded-local']), `${path}.journey.order`, '时间排序依据无效'); refs(journey.order.orderedVisitIds, frozenIds, `${path}.journey.order.orderedVisitIds`); refs(journey.order.unresolvedVisitIds, frozenIds, `${path}.journey.order.unresolvedVisitIds`); if (Array.isArray(journey.order.orderedVisitIds) && Array.isArray(journey.order.unresolvedVisitIds)) check(!journey.order.orderedVisitIds.some(x => (journey.order as Record<string, unknown[]>).unresolvedVisitIds.includes(x)), `${path}.journey.order`, '已排序和待排序不得重叠'); }
    if (!record(journey.route) || !Array.isArray(journey.route.segments)) issue(`${path}.journey.route`, '路线快照无效'); else for (const segment of journey.route.segments) check(record(segment) && frozenIds.has(segment.fromVisitId) && frozenIds.has(segment.toVisitId) && Array.isArray(segment.coordinates) && segment.coordinates.length >= 2 && segment.coordinates.every(coordinate), `${path}.journey.route.segments`, '路线段无效');
  });
  return { valid: issues.length === 0, issues };
}
export function assertValidProject(input: unknown): asserts input is ProjectDocument {
  const result = validateProject(input); if (!result.valid) throw new Error(`项目校验失败：${result.issues.slice(0, 8).map(i => `${i.path}: ${i.message}`).join('；')}`);
}
export function parseProject(input: unknown): ProjectDocument { assertValidProject(input); return structuredClone(input); }
/** v0 used a single artwork object. Migration never mutates the input. */
export function migrateProject(input: unknown): ProjectDocument {
  if (!record(input)) throw new Error('项目不是有效对象');
  if (input.schemaVersion === 1) return parseProject(input);
  if (input.schemaVersion !== 0) throw new Error(`不支持项目版本 ${String(input.schemaVersion)}。请使用兼容版本；原文件保持不变。`);
  const migrated = structuredClone(input); migrated.schemaVersion = 1;
  if (!Array.isArray(migrated.artworks) && record(migrated.artwork)) migrated.artworks = [migrated.artwork];
  delete migrated.artwork;
  return parseProject(migrated);
}
/** Retains hidden nodes, frozen works, derivatives, and recursively their source assets. */
export function collectAssetReferences(project: ProjectDocument): Set<string> {
  const refs = new Set<string>(); const add = (id: string | undefined) => { if (id) refs.add(id); };
  for (const photo of project.library.photos) { add(photo.assetId); add(photo.thumbnailAssetId); add(photo.proxyAssetId); }
  for (const artwork of project.artworks) { add(artwork.previewAssetId); add(artwork.mapSnapshotAssetId); for (const id of artwork.derivedAssetIds ?? []) add(id); for (const binding of artwork.frozenPhotoBindings) { add(binding.assetId); add(binding.thumbnailAssetId); add(binding.proxyAssetId); add(binding.derivedAssetId); } for (const node of artwork.nodes) { add(node.assetId); add(node.photoEdit?.derivedAssetId); } }
  const lookup = new Map(project.assets.map(asset => [asset.id, asset]));
  for (const ref of refs) add(lookup.get(ref)?.sourceAssetId);
  return refs;
}
