import type { ArtworkDocument, LayoutProposal, SceneNode, Transform, LayoutConflict } from '../domain';
import { resolveTemplate, resolveStyle } from '../design-packages';

export const SOLVER_VERSION = '1.0.0';
const auto = () => ({ position: 'auto' as const, size: 'auto' as const, crop: 'auto' as const });
const tr = (x: number, y: number, width: number, height: number, rotation = 0): Transform => ({ x, y, width, height, rotation });
function make(kind: SceneNode['kind'], id: string, role: string, transform: Transform, zIndex: number, props: Partial<SceneNode> = {}): SceneNode {
  return { id, kind, role, transform, zIndex, visible: true, constraint: auto(), layoutParticipation: 'flow', ...props };
}
function grid(box: Transform, count: number, gap: number, columns?: number): Transform[] {
  if (!count) return [];
  const cols = Math.max(1, Math.min(count, columns ?? Math.ceil(Math.sqrt(count * Math.max(1, box.width) / Math.max(1, box.height)))));
  const rows = Math.ceil(count / cols), actualGap = Math.min(gap, Math.max(12, Math.min(box.width / cols, box.height / rows) * .18));
  const w = (box.width - actualGap * (cols - 1)) / cols, h = (box.height - actualGap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, i) => tr(box.x + i % cols * (w + actualGap), box.y + Math.floor(i / cols) * (h + actualGap), w, h));
}
/** Conservative deterministic estimate; export also measures the loaded font. */
function textLines(text: string, width: number, fontSize: number): number {
  const capacity = Math.max(1, width / fontSize); let lines = 0;
  for (const paragraph of text.split('\n')) { let used = 0, count = 1; for (const char of Array.from(paragraph)) { const units = /[\u0000-\u007f]/.test(char) ? .62 : 1; if (used && used + units > capacity) { count++; used = 0; } used += units; } lines += count; }
  return Math.max(1, lines);
}
export function layoutInputHash(art: ArtworkDocument) {
  const input = JSON.stringify([art.id, art.templateId, art.templateVersion, art.styleId, art.styleVersion, art.paletteId, art.embeddedStyle, art.embeddedTemplate, art.artboard, art.journey.selectionRevision, art.journey.order, art.layout, art.visibility, art.metadata, art.seed, art.frozenPhotoBindings, art.nodes.map(n => [n.id, n.kind, n.visible, n.transform, n.constraint, n.crop, n.photoEdit, n.userOverrides])]);
  let h = 2166136261; for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
function explicitVisibility(old: SceneNode | undefined, defaultVisible: boolean, photo = false): boolean {
  if (typeof old?.userOverrides?.visible === 'boolean') return old.userOverrides.visible;
  // Existing v1 photo nodes used .visible; retain that intent until explicitly overridden.
  if (photo && old && old.visible === false && old.userOverrides?.groupHidden !== true) return false;
  return defaultVisible;
}
function rotatedBounds(t: Transform): Transform {
  if (!t.rotation) return t;
  const angle = t.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const corners = [[0, 0], [t.width, 0], [t.width, t.height], [0, t.height]].map(([x, y]) => ({ x: t.x + x * c - y * s, y: t.y + x * s + y * c }));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return tr(x, y, Math.max(...corners.map(p => p.x)) - x, Math.max(...corners.map(p => p.y)) - y);
}
/** Deterministic proposal. It never mutates the artwork, shares mutable objects, or releases constraints. */
export function solveLayout(art: ArtworkDocument): LayoutProposal {
  const { width: W, height: H } = art.artboard, v = art.visibility;
  const style = resolveStyle(art), template = resolveTemplate(art), customSlots = template.slots;
  const layoutId = template.layoutId ?? template.id;
  const customPhotos = customSlots?.filter(slot => slot.kind === 'photo') ?? [];
  const customTitle = customSlots?.find(slot => slot.kind === 'text' && slot.role === 'title');
  const conflicts: LayoutConflict[] = [];
  const existing = new Map(art.nodes.map(n => [n.id, n]));
  const photoState = new Map(art.nodes.filter(n => n.kind === 'photo' && n.role !== 'photo-art' && n.photoId).map(n => [n.photoId!, n]));
  const film = template.family === 'T05';
  const filmSlots = film ? art.nodes.filter(n => n.kind === 'photo' && n.role === 'photo' && typeof n.userOverrides?.slotIndex === 'number').sort((a, b) => Number(a.userOverrides!.slotIndex) - Number(b.userOverrides!.slotIndex)) : [];
  const availableFilmSlots = filmSlots.filter(n => explicitVisibility(n, true, true));
  let nextFilmSlot = Math.max(-1, ...filmSlots.map(n => Number(n.userOverrides!.slotIndex))) + 1;
  const enabled = (id: string, group: boolean) => group && explicitVisibility(existing.get(id), true);
  const pad = Math.max(28, Math.min(W, H) * .055, Math.min(W, H) * art.artboard.safeMarginMm / Math.max(1, Math.min(art.artboard.physicalWidthMm, art.artboard.physicalHeightMm)));
  const gap = Math.max(8, art.layout.gap), availableWidth = W - 2 * pad;
  const titleSize = Number(existing.get('title')?.userOverrides?.fontSize) || (customTitle?.fontSize ?? Math.min(48, W * .058, customTitle ? customTitle.height * H / 1.28 : Infinity));
  const titleText = String(existing.get('title')?.userOverrides?.text ?? art.metadata.title);
  const titleLineCount = textLines(titleText, availableWidth, titleSize);
  const titleH = enabled('title', v.title) && titleText ? titleSize * 1.28 * titleLineCount + 10 : 0;
  const dateH = enabled('date', v.date) && art.metadata.date ? 27 : 0;
  const messageText = String(existing.get('message')?.userOverrides?.text ?? art.metadata.message);
  const messageH = enabled('message', v.message) && messageText ? textLines(messageText, availableWidth, 16) * 20.48 + 8 : 0;
  const coordinatesH = enabled('coordinates', v.coordinates) ? 22 : 0;
  const orderedVisits = art.journey.order.orderedVisitIds.map(id => art.journey.resolvedVisits.find(v => v.id === id)).filter(Boolean);
  const legendText = orderedVisits.map((visit, i) => `${i + 1}. ${visit!.name}`).join('  ·  ');
  const legendH = enabled('legend', v.legend) && legendText ? textLines(legendText, availableWidth, 12) * 15.36 + 8 : 0;
  const top = pad + titleH + dateH, bottom = pad + 52 + messageH + coordinatesH + legendH;
  const body = tr(pad, top, availableWidth, H - top - bottom);
  const capacity = Math.max(0, Math.min(1000, Math.floor(art.layout.photoCapacity)));
  const photos = art.frozenPhotoBindings.slice(0, capacity);
  // Slot order follows the one VisitOrder; locked frames retain their geometry below.
  const orderIndex = new Map<string, number>(); let orderCounter = 0;
  for (const visit of orderedVisits) for (const photoId of visit!.photoIds) if (!orderIndex.has(photoId)) orderIndex.set(photoId, orderCounter++);
  if (template.family === 'T05') photos.sort((a, b) => (orderIndex.get(a.photoId) ?? 1e9) - (orderIndex.get(b.photoId) ?? 1e9));
  const candidatePhotos = v.photos ? photos.filter(p => explicitVisibility(photoState.get(p.photoId), true, true)) : [];
  const activePhotos = customSlots ? candidatePhotos.slice(0, customPhotos.length) : candidatePhotos;
  if (customSlots && candidatePhotos.length > customPhotos.length) conflicts.push({ code: 'TEMPLATE_CAPACITY', message: `该模板有 ${customPhotos.length} 个照片槽位，当前需要 ${candidatePhotos.length} 个。请调整照片容量或选择其他模板。` });
  const count = activePhotos.length, mapVisible = enabled('map-main', v.map);
  let mapBox = { ...body }, slots: Transform[] = [];
  const ratio = Math.max(.25, Math.min(.8, art.layout.mapRatio));
  if (customSlots) {
    const slot = customSlots.find(slot => slot.kind === 'map')!;
    mapBox = tr(slot.x * W, slot.y * H, slot.width * W, slot.height * H);
    slots = customPhotos.map(slot => tr(slot.x * W, slot.y * H, slot.width * W, slot.height * H));
  } else if (mapVisible && count) {
    switch (layoutId) {
      case 'card-split': mapBox.width = body.width * ratio - gap / 2; slots = grid(tr(mapBox.x + mapBox.width + gap, body.y, body.width - mapBox.width - gap, body.height), count, gap, count < 3 ? 1 : 2); break;
      case 'card-strip': case 'poster-photos': mapBox.height = body.height * .66 - gap; slots = grid(tr(body.x, body.y + mapBox.height + gap, body.width, body.height - mapBox.height - gap), count, gap, Math.min(count, 5)); break;
      case 'torn-map': mapBox.height = body.height * .49; slots = grid(tr(body.x, body.y + mapBox.height + gap, body.width, body.height - mapBox.height - gap), count, gap); break;
      case 'torn-art': {
        mapBox = tr(body.x + body.width * .64, body.y + body.height * .67, body.width * .36, body.height * .33);
        slots = grid(tr(body.x, body.y, body.width, body.height * .61), Math.max(2, count), gap, 2); break;
      }
      case 'ticket-photo': mapBox = tr(body.x + body.width * .72, body.y + body.height * .35, body.width * .28, body.height * .65); slots = grid(tr(body.x, body.y, body.width * .68, body.height), count, gap); break;
      case 'ticket-map': mapBox.width = body.width * .7; slots = grid(tr(body.x + body.width * .74, body.y, body.width * .26, body.height), count, gap, 1); break;
      case 'poster-full': mapBox.height = body.height * .79 - gap; slots = grid(tr(body.x, body.y + body.height * .79, body.width, body.height * .21), count, gap, count); break;
      case 'film-vertical': mapBox = tr(body.x + body.width * .57, body.y, body.width * .43, body.height); slots = grid(tr(body.x + 25, body.y, body.width * .5 - 25, body.height), count, gap, 1); break;
      case 'film-horizontal': mapBox = tr(body.x, body.y, body.width * .3, body.height); slots = grid(tr(body.x + body.width * .33, body.y, body.width * .67, body.height), count, Math.min(gap, 12), count); break;
      case 'collage-scatter': {
        mapBox = tr(body.x + body.width * .12, body.y + body.height * .06, body.width * .76, body.height * .84);
        const rows = Math.ceil(count / 2), boxW = body.width * .27, boxH = Math.min(body.height / Math.max(1, rows) - gap - boxW * .09, boxW * .88);
        slots = Array.from({ length: count }, (_, i) => { const right = i % 2 === 1, row = Math.floor(i / 2); return tr(body.x + (right ? body.width - boxW - boxH * .09 : 4), body.y + boxW * .09 + row * (body.height - boxH - boxW * .18) / Math.max(1, rows - 1), boxW, boxH, right ? 5 : -5); }); break;
      }
      case 'collage-grid': { const cells = grid(body, count + 1, gap); mapBox = cells[0]; slots = cells.slice(1); break; }
      default: { mapBox.width = body.width * ratio - gap / 2; slots = grid(tr(mapBox.x + mapBox.width + gap, body.y, body.width - mapBox.width - gap, body.height), count, gap); }
    }
  } else if (count) slots = grid(body, count, gap);
  const nodes: SceneNode[] = [
    make('background', 'background', 'background', tr(0, 0, W, H), 0, { layoutParticipation: 'overlay', color: style.palette.paper }),
    make('paper', 'paper', 'paper', tr(0, 0, W, H), 1, { layoutParticipation: 'overlay', seed: art.seed, shape: template.shape }),
    make('group', 'content-group', 'content', body, 2, { layoutParticipation: 'overlay' }),
    make('map', 'map-main', 'map', mapBox, 3, { visible: mapVisible, parentId: 'content-group' }),
    make('route', 'route-main', 'route', mapBox, 4, { visible: enabled('route-main', v.route), parentId: 'map-main', layoutParticipation: 'overlay' }),
    make('annotation', 'annotations', 'annotations', mapBox, 5, { visible: explicitVisibility(existing.get('annotations'), true), parentId: 'map-main', layoutParticipation: 'overlay' }),
  ];
  const neutralEdit = () => ({ mode: 'local' as const, exposure: 0, contrast: 1, saturation: 1, intensity: .65, crop: { x: .5, y: .5, zoom: 1, rotation: 0 } });
  activePhotos.forEach((photo, i) => {
    const fixedSlot = film ? availableFilmSlots[i] : undefined;
    const slotIndex = fixedSlot ? Number(fixedSlot.userOverrides!.slotIndex) : film ? nextFilmSlot++ : i;
    const nodeId = film ? fixedSlot?.id ?? `film-slot-${slotIndex}` : `photo-${photo.photoId}`;
    nodes.push(make('photo', nodeId, 'photo', slots[i], 10 + i, { assetId: photo.assetId, photoId: photo.photoId, crop: { x: .5, y: .5, zoom: 1, rotation: 0 }, photoEdit: neutralEdit(), parentId: 'content-group', ...(film ? { userOverrides: { slotIndex } } : {}) }));
  });
  if (layoutId === 'torn-art' && count === 1) nodes.push(make('photo', `art-${activePhotos[0].photoId}`, 'photo-art', slots[1], 12, { assetId: activePhotos[0].assetId, photoId: activePhotos[0].photoId, photoEdit: { ...neutralEdit(), intensity: 1 }, visible: explicitVisibility(existing.get(`art-${activePhotos[0].photoId}`), true, true), parentId: 'content-group' }));
  // Hidden/capacity-excluded photos retain their edits and identity, even when the entire group is hidden.
  const activeIds = new Set(nodes.map(n => n.id));
  const activePhotoIds = new Set(activePhotos.map(photo => photo.photoId));
  for (const photo of art.frozenPhotoBindings) {
    const priorPhoto = photoState.get(photo.photoId);
    const nodeId = film ? priorPhoto && !activeIds.has(priorPhoto.id) ? priorPhoto.id : `film-hidden-${photo.photoId}` : `photo-${photo.photoId}`;
    if (!activePhotoIds.has(photo.photoId)) {
      const prior = priorPhoto ?? existing.get(nodeId), node = prior ? structuredClone(prior) : make('photo', nodeId, 'photo', tr(body.x, body.y, 150, 150), 10, { assetId: photo.assetId, photoId: photo.photoId, parentId: 'content-group' });
      node.id = nodeId;
      if (nodeId.startsWith('film-hidden-')) { node.role = 'photo-unused'; if (node.userOverrides) delete node.userOverrides.slotIndex; }
      node.visible = false; node.userOverrides = { ...node.userOverrides, groupHidden: !v.photos || !photos.some(p => p.photoId === photo.photoId) || (!!customSlots && candidatePhotos.some(p => p.photoId === photo.photoId) && !activePhotoIds.has(photo.photoId)) };
      nodes.push(node);
    }
    const derived = existing.get(`art-${photo.photoId}`);
    if (derived && !activeIds.has(derived.id)) { const hidden = structuredClone(derived); hidden.visible = false; hidden.userOverrides = { ...hidden.userOverrides, groupHidden: true }; nodes.push(hidden); }
  }
  const footer = H - bottom + 5;
  nodes.push(
    make('text', 'title', 'title', tr(pad, pad, availableWidth, Math.max(titleH, titleSize * 1.3)), 30, { text: titleText, fontSize: titleSize, fontFamily: style.font, color: style.palette.ink, visible: enabled('title', v.title) }),
    make('text', 'date', 'date', tr(pad, pad + titleH, availableWidth, 25), 31, { text: art.metadata.date, fontSize: customSlots ? 12 : 13, fontFamily: 'Inter, "Noto Sans SC", sans-serif', color: style.palette.ink, visible: enabled('date', v.date) && !!art.metadata.date }),
    make('text', 'message', 'message', tr(pad, footer, availableWidth, Math.max(messageH, 30)), 32, { text: messageText, fontSize: 16, fontFamily: style.font, color: style.palette.ink, visible: enabled('message', v.message) && !!messageText }),
    make('text', 'coordinates', 'coordinates', tr(pad, footer + messageH, availableWidth, 18), 33, { fontSize: 11, color: style.palette.ink, visible: enabled('coordinates', v.coordinates) }),
    make('text', 'legend', 'legend', tr(pad, footer + messageH + coordinatesH, availableWidth, Math.max(legendH, 20)), 34, { text: legendText, fontSize: 12, color: style.palette.ink, visible: enabled('legend', v.legend) && !!legendText }),
    make('decoration', 'border', 'border', tr(14, 14, W - 28, H - 28), 40, { visible: enabled('border', v.border), layoutParticipation: 'overlay' }),
    make('decoration', 'stamp', 'stamp', tr(W - pad - 60, Math.max(pad, H - pad - 90), 45, 45), 41, { visible: enabled('stamp', v.stamp), layoutParticipation: 'overlay' }),
    make('decoration', 'compass', 'compass', tr(W - pad - 45, H - bottom - 50, 34, 34), 42, { visible: enabled('compass', v.compass), layoutParticipation: 'overlay' }),
    make('decoration', 'string', 'string', tr(W * .5 - 14, 0, 28, 50), 43, { visible: enabled('string', v.string), layoutParticipation: 'overlay' }),
    make('attribution', 'attribution', 'attribution', tr(pad, H - pad - 17, availableWidth, 44), 50, { fontSize: 9, color: style.palette.ink, locked: true, layoutParticipation: 'reserved' }),
  );
  if (customSlots) {
    const assigned = new Set<string>();
    for (const slot of customSlots) {
      if (slot.kind === 'map' || slot.kind === 'photo') continue;
      const role = slot.kind === 'attribution' ? 'attribution' : slot.role!;
      let node = nodes.find(node => node.kind === slot.kind && node.role === role && role !== 'caption');
      if (!node) { const id = `template-${slot.id}`; node = make(slot.kind, id, role, tr(0, 0, 1, 1), slot.kind === 'text' ? 35 : 41, { text: slot.text, fontFamily: style.font, color: style.palette.ink, visible: enabled(id, true) }); nodes.push(node); }
      node.transform = tr(slot.x * W, slot.y * H, slot.width * W, slot.height * H);
      node.userOverrides = { ...node.userOverrides, templateSlot: slot.id };
      if (slot.kind === 'text') node.fontSize = slot.fontSize ?? (role === 'title' ? titleSize : node.fontSize ?? 16);
      assigned.add(node.id);
    }
    // A custom recipe controls its ornaments; omitted decorative slots stay retained but hidden.
    for (const node of nodes.filter(node => node.kind === 'decoration' && !assigned.has(node.id))) node.visible = false;
    const occupied = customSlots.map(slot => tr(slot.x * W, slot.y * H, slot.width * W, slot.height * H));
    const textX = customTitle ? customTitle.x * W : pad, textWidth = customTitle ? customTitle.width * W : availableWidth;
    const contentBottom = Math.max(...customSlots.filter(slot => slot.kind === 'map' || slot.kind === 'photo').map(slot => (slot.y + slot.height) * H));
    for (const node of nodes.filter(node => node.kind === 'text' && node.visible && !assigned.has(node.id))) {
      const fs = Number(existing.get(node.id)?.userOverrides?.fontSize) || node.fontSize || 16;
      const height = textLines(String(existing.get(node.id)?.userOverrides?.text ?? node.text ?? ''), textWidth, fs) * fs * 1.28;
      const preferred = node.role === 'date' && customTitle ? (customTitle.y + customTitle.height) * H + 1 : node.role === 'title' ? pad : contentBottom + 1;
      const candidates = [...new Set([preferred, pad, ...occupied.map(box => box.y + box.height + 1)])].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
      const y = candidates.find(y => y >= 4 && y + height <= H - 4 && !occupied.some(box => intersects(tr(textX, y, textWidth, height), box)));
      if (y === undefined) conflicts.push({ nodeId: node.id, code: 'TEMPLATE_TEXT_CAPACITY', message: `模板空白区域无法容纳「${node.role}」。请选择含对应文字槽位的模板，或主动调整内容显示。` });
      else { node.transform = tr(textX, y, textWidth, height); occupied.push(node.transform); }
    }
  } else if (body.height < 60 || body.width < 100 || (titleH && titleLineCount > 4)) conflicts.push({ nodeId: 'title', code: 'TEXT_OVERFLOW', message: '文字与安全区无法容纳：请缩短文字、增加画布高度或隐藏次要信息。' });
  const merged = nodes.map(n => {
    const old = existing.get(n.id); if (!old) return n;
    let transform = { ...n.transform };
    if (art.layout.mode === 'free' && !['background', 'paper', 'route', 'annotation'].includes(n.kind)) transform = { ...old.transform };
    else { if (old.constraint.position === 'pinned') transform = { ...transform, x: old.transform.x, y: old.transform.y, rotation: old.transform.rotation }; if (old.constraint.size === 'fixed') transform = { ...transform, width: old.transform.width, height: old.transform.height }; }
    const contentPrior = n.kind === 'photo' && n.photoId ? photoState.get(n.photoId) : old;
    const overrides = { ...old.userOverrides, ...n.userOverrides, ...(n.kind === 'photo' ? { groupHidden: !v.photos || !photos.some(p => p.photoId === n.photoId) || (!!customSlots && candidatePhotos.some(p => p.photoId === n.photoId) && !activePhotoIds.has(n.photoId!)) } : {}) };
    return { ...n, transform, constraint: structuredClone(old.constraint), crop: old.constraint.crop === 'fixed' && old.crop ? structuredClone(old.crop) : contentPrior?.crop ? structuredClone(contentPrior.crop) : n.crop, photoEdit: contentPrior?.photoEdit ? structuredClone(contentPrior.photoEdit) : n.photoEdit, userOverrides: overrides, ...(old.userOverrides?.fontSize ? { fontSize: Number(old.userOverrides.fontSize) } : {}), ...(old.userOverrides?.color ? { color: String(old.userOverrides.color) } : {}), ...(old.userOverrides?.text !== undefined ? { text: String(old.userOverrides.text) } : {}) };
  });
  // The map frame alone owns map placement. Sibling annotation nodes share its exact transform.
  const resolvedMap = merged.find(n => n.kind === 'map')!;
  for (const child of merged.filter(n => n.parentId === resolvedMap.id && ['route', 'annotation'].includes(n.kind))) child.transform = { ...resolvedMap.transform };
  const content = merged.filter(n => n.visible && n.layoutParticipation !== 'overlay' && ['photo', 'map', 'text', 'attribution'].includes(n.kind));
  const intentionallyOverlaps = (a: SceneNode, b: SceneNode) => layoutId === 'collage-scatter' && ((a.kind === 'map' && b.kind === 'photo') || (b.kind === 'map' && a.kind === 'photo'));
  const overlaps = (a: SceneNode, b: SceneNode) => !intentionallyOverlaps(a, b) && intersects(rotatedBounds(a.transform), rotatedBounds(b.transform));
  // One constrained placement pass: pinned objects stay fixed, unconstrained content tries stable nearby positions.
  if (art.layout.mode !== 'free') {
    const fixed = content.filter(n => n.constraint.position === 'pinned' || ['text', 'attribution'].includes(n.kind));
    for (const node of content.filter(n => ['photo', 'map'].includes(n.kind) && n.constraint.position !== 'pinned')) {
      if (fixed.some(other => other.id !== node.id && overlaps(node, other))) {
        const original = { ...node.transform }, candidates = [original];
        for (const blocker of fixed) { const b = rotatedBounds(blocker.transform); candidates.push({ ...original, x: b.x + b.width + gap }, { ...original, x: b.x - original.width - gap }, { ...original, y: b.y + b.height + gap }, { ...original, y: b.y - original.height - gap }); }
        candidates.sort((a, b) => Math.hypot(a.x - original.x, a.y - original.y) - Math.hypot(b.x - original.x, b.y - original.y));
        const candidate = candidates.find(t => { const b = rotatedBounds(t); return b.x >= pad - 1 && b.y >= top - 1 && b.x + b.width <= W - pad + 1 && b.y + b.height <= H - bottom + 1 && !fixed.some(other => other.id !== node.id && !intentionallyOverlaps(node, other) && intersects(b, rotatedBounds(other.transform))); });
        if (candidate) node.transform = candidate;
      }
      fixed.push(node);
    }
  }
  // Re-sync after the placement pass as well.
  for (const child of merged.filter(n => n.parentId === resolvedMap.id && ['route', 'annotation'].includes(n.kind))) child.transform = { ...resolvedMap.transform };
  for (const n of content) {
    const t = rotatedBounds(n.transform);
    if (![t.x, t.y, t.width, t.height, n.transform.rotation].every(Number.isFinite) || t.width < 1 || t.height < 1 || t.x < -1 || t.y < -1 || t.x + t.width > W + 1 || t.y + t.height > H + 1) conflicts.push({ nodeId: n.id, code: 'OUTSIDE_ARTBOARD', message: `「${n.role}」超出画板，请释放位置/尺寸锁定或调整版式。` });
    if (n.kind === 'photo' && (n.transform.width < 50 || n.transform.height < 40)) conflicts.push({ nodeId: n.id, code: 'PHOTO_TOO_SMALL', message: '照片槽位过小，请减少本版照片数量或增加画布比例。' });
    if (n.kind === 'text' && n.text && textLines(n.text, n.transform.width, n.fontSize ?? 16) * (n.fontSize ?? 16) * 1.28 > n.transform.height + 2) conflicts.push({ nodeId: n.id, code: 'TEXT_OVERFLOW', message: `「${n.role}」文字超出固定区域，请增加空间或释放尺寸锁定。` });
  }
  for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
    const a = content[i], b = content[j]; if (!overlaps(a, b)) continue;
    // Free mode allows artistic overlap, while attribution remains a hard protected area.
    if (art.layout.mode === 'free' && a.kind !== 'attribution' && b.kind !== 'attribution') continue;
    conflicts.push({ nodeId: a.kind === 'attribution' ? b.id : a.id, code: a.kind === 'attribution' || b.kind === 'attribution' ? 'ATTRIBUTION_COLLISION' : 'CONTENT_COLLISION', message: `「${a.role}」与「${b.role}」重叠，请调整内容或释放相关锁定。` });
  }
  return structuredClone({ inputHash: layoutInputHash(art), selectionRevision: art.journey.selectionRevision, layoutRevision: art.layout.layoutRevision, solverVersion: SOLVER_VERSION, nodes: merged, conflicts });
}
export function intersects(a: Transform, b: Transform) { const epsilon = .1; return a.x < b.x + b.width - epsilon && a.x + a.width > b.x + epsilon && a.y < b.y + b.height - epsilon && a.y + a.height > b.y + epsilon; }
export function applyLayoutProposal(art: ArtworkDocument, proposal: LayoutProposal): ArtworkDocument {
  if (proposal.inputHash !== layoutInputHash(art) || proposal.selectionRevision !== art.journey.selectionRevision || proposal.layoutRevision !== art.layout.layoutRevision) throw new Error('排版结果已过期，请重新计算。');
  if (proposal.conflicts.length) throw new Error(proposal.conflicts.map(c => c.message).join('\n'));
  return { ...structuredClone(art), nodes: structuredClone(proposal.nodes), layout: { ...art.layout, layoutRevision: art.layout.layoutRevision + 1, solverVersion: proposal.solverVersion } };
}
export function snapTransform(t: Transform, width: number, height: number, enabled = true) {
  if (!enabled) return { ...t };
  const snap = (value: number, anchors: number[]) => anchors.find(a => Math.abs(a - value) < 7) ?? Math.round(value);
  return { ...t, x: snap(t.x, [28, (width - t.width) / 2, width - t.width - 28]), y: snap(t.y, [28, (height - t.height) / 2, height - t.height - 28]) };
}
