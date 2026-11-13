import type { ArtworkDocument, LayoutProposal, SceneNode, Transform, LayoutConflict } from '../domain';
import { getTemplate, getStyle } from '../design-packages';

export const SOLVER_VERSION = '1.0.0';
const auto = () => ({ position: 'auto' as const, size: 'auto' as const, crop: 'auto' as const });
const tr = (x: number, y: number, width: number, height: number, rotation = 0): Transform => ({ x, y, width, height, rotation });
function make(kind: SceneNode['kind'], id: string, role: string, transform: Transform, zIndex: number, props: Partial<SceneNode> = {}): SceneNode {
  return { id, kind, role, transform, zIndex, visible: true, constraint: auto(), layoutParticipation: 'flow', ...props };
}
function grid(box: Transform, count: number, gap: number, columns?: number): Transform[] {
  if (!count) return [];
  const cols = columns ?? Math.max(1, Math.ceil(Math.sqrt(count * box.width / Math.max(1, box.height))));
  const rows = Math.ceil(count / cols);
  const w = (box.width - gap * (cols - 1)) / cols, h = (box.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, i) => tr(box.x + i % cols * (w + gap), box.y + Math.floor(i / cols) * (h + gap), w, h));
}
export function layoutInputHash(art: ArtworkDocument) {
  const input = JSON.stringify([art.id, art.templateId, art.artboard, art.journey.selectionRevision, art.layout, art.visibility, art.metadata, art.frozenPhotoBindings.map(p => p.photoId), art.nodes.filter(n => n.constraint.position === 'pinned' || n.constraint.size === 'fixed').map(n => [n.id, n.transform])]);
  let h = 2166136261; for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
/** Deterministic proposal. It never mutates the artwork or silently releases a constraint. */
export function solveLayout(art: ArtworkDocument): LayoutProposal {
  const { width: W, height: H } = art.artboard, v = art.visibility;
  const style = getStyle(art.styleId, art.paletteId), template = getTemplate(art.templateId);
  const pad = Math.max(28, Math.min(W, H) * .055), gap = Math.max(8, art.layout.gap);
  const titleSize = Math.min(48, W * .058);
  const titleLines = Math.max(1, Math.ceil(art.metadata.title.length / Math.max(6, Math.floor((W - 2 * pad) / titleSize))));
  const titleH = v.title && art.metadata.title ? titleSize * 1.28 * titleLines + 10 : 0;
  const dateH = v.date && art.metadata.date ? 27 : 0;
  const messageH = v.message && art.metadata.message ? 36 : 0;
  const top = pad + titleH + dateH, bottom = pad + 30 + messageH;
  const body = tr(pad, top, W - 2 * pad, H - top - bottom);
  const photos = art.frozenPhotoBindings.slice(0, art.layout.photoCapacity);
  const existing = new Map(art.nodes.map(n => [n.id, n]));
  const activePhotos = v.photos ? photos.filter(p => existing.get(`photo-${p.photoId}`)?.visible !== false) : [];
  const count = activePhotos.length;
  let mapBox = { ...body }, slots: Transform[] = [];
  const ratio = Math.max(.25, Math.min(.8, art.layout.mapRatio));
  if (v.map && count) {
    switch (template.id) {
      case 'card-split': mapBox.width = body.width * ratio - gap / 2; slots = grid(tr(mapBox.x + mapBox.width + gap, body.y, body.width - mapBox.width - gap, body.height), count, gap, count < 3 ? 1 : 2); break;
      case 'card-strip': case 'poster-photos': mapBox.height = body.height * .68 - gap; slots = grid(tr(body.x, body.y + mapBox.height + gap, body.width, body.height - mapBox.height - gap), count, gap, Math.min(count, 5)); break;
      case 'torn-map': mapBox.height = body.height * .49; slots = grid(tr(body.x, body.y + mapBox.height + gap, body.width, body.height - mapBox.height - gap), count, gap); break;
      case 'torn-art': {
        mapBox = tr(body.x + body.width * .64, body.y + body.height * .65, body.width * .36, body.height * .35);
        slots = grid(tr(body.x, body.y, body.width, body.height * .61), Math.max(2, count), gap, 2); break;
      }
      case 'ticket-photo': mapBox = tr(body.x + body.width * .72, body.y + body.height * .35, body.width * .28, body.height * .65); slots = grid(tr(body.x, body.y, body.width * .68, body.height), count, gap); break;
      case 'ticket-map': mapBox.width = body.width * .7; slots = grid(tr(body.x + body.width * .74, body.y, body.width * .26, body.height), count, gap, 1); break;
      case 'poster-full': mapBox.height = body.height * .82 - gap; slots = grid(tr(body.x, body.y + body.height * .82, body.width, body.height * .18), count, gap, count); break;
      case 'film-vertical': mapBox = tr(body.x + body.width * .57, body.y, body.width * .43, body.height); slots = grid(tr(body.x + 25, body.y, body.width * .5 - 25, body.height), count, gap, 1); break;
      case 'film-horizontal': mapBox = tr(body.x, body.y, body.width * .3, body.height); slots = grid(tr(body.x + body.width * .33, body.y, body.width * .67, body.height), count, gap, count); break;
      case 'collage-scatter': {
        mapBox = tr(body.x + body.width * .12, body.y + body.height * .06, body.width * .76, body.height * .84);
        const boxW = body.width * .29, boxH = Math.min(body.height * .3, boxW * .95);
        slots = Array.from({ length: count }, (_, i) => { const right = i % 2 === 1; const row = Math.floor(i / 2); const rows = Math.ceil(count / 2); return tr(body.x + (right ? body.width - boxW : 0), body.y + row * (body.height - boxH) / Math.max(1, rows - 1), boxW, boxH, right ? 5 : -5); }); break;
      }
      case 'collage-grid': { const cells = grid(body, count + 1, gap); mapBox = cells[0]; slots = cells.slice(1); break; }
    }
  } else if (count) slots = grid(body, count, gap);
  const nodes: SceneNode[] = [
    make('background', 'background', 'background', tr(0, 0, W, H), 0, { layoutParticipation: 'overlay', color: style.palette.paper }),
    make('paper', 'paper', 'paper', tr(0, 0, W, H), 1, { layoutParticipation: 'overlay', seed: art.seed, shape: template.shape }),
    make('group', 'content-group', 'content', body, 2, { layoutParticipation: 'overlay' }),
    make('map', 'map-main', 'map', mapBox, 3, { visible: v.map, parentId: 'content-group' }),
    make('route', 'route-main', 'route', mapBox, 4, { visible: v.route, parentId: 'map-main', layoutParticipation: 'overlay' }),
    make('annotation', 'annotations', 'annotations', mapBox, 5, { parentId: 'map-main', layoutParticipation: 'overlay' }),
  ];
  activePhotos.forEach((photo, i) => nodes.push(make('photo', `photo-${photo.photoId}`, 'photo', slots[i], 10 + i, { assetId: photo.assetId, photoId: photo.photoId, crop: { x: .5, y: .5, zoom: 1, rotation: 0 }, photoEdit: { mode: 'local', exposure: 0, contrast: 0, saturation: 0, intensity: .65, crop: { x: .5, y: .5, zoom: 1, rotation: 0 } }, parentId: 'content-group' })));
  if (template.id === 'torn-art' && count === 1) nodes.push(make('photo', `art-${activePhotos[0].photoId}`, 'photo-art', slots[1], 12, { assetId: activePhotos[0].assetId, photoId: activePhotos[0].photoId, photoEdit: { mode: 'local', exposure: 0, contrast: 0, saturation: 0, intensity: 1, crop: { x: .5, y: .5, zoom: 1, rotation: 0 } } }));
  // Hidden photo objects remain serialized with their original geometry and edits.
  for (const photo of photos) if (!activePhotos.some(p => p.photoId === photo.photoId)) {
    nodes.push(existing.get(`photo-${photo.photoId}`) ?? make('photo', `photo-${photo.photoId}`, 'photo', tr(body.x, body.y, 150, 150), 10, { visible: false, assetId: photo.assetId, photoId: photo.photoId }));
  }
  nodes.push(
    make('text', 'title', 'title', tr(pad, pad, W - pad * 2, Math.max(titleH, titleSize * 1.3)), 30, { text: art.metadata.title, fontSize: titleSize, fontFamily: style.font, color: style.palette.ink, visible: v.title }),
    make('text', 'date', 'date', tr(pad, pad + titleH, W - pad * 2, 25), 31, { text: art.metadata.date, fontSize: 13, fontFamily: 'Inter, sans-serif', color: style.palette.ink, visible: v.date && !!art.metadata.date }),
    make('text', 'message', 'message', tr(pad, H - bottom + 5, W - 2 * pad, Math.max(messageH, 30)), 32, { text: art.metadata.message, fontSize: 16, fontFamily: style.font, color: style.palette.ink, visible: v.message && !!art.metadata.message }),
    make('text', 'coordinates', 'coordinates', tr(pad, H - pad - 40, W - 2 * pad, 18), 33, { fontSize: 11, color: style.palette.ink, visible: v.coordinates, layoutParticipation: 'overlay' }),
    make('decoration', 'border', 'border', tr(14, 14, W - 28, H - 28), 40, { visible: v.border, layoutParticipation: 'overlay' }),
    make('decoration', 'stamp', 'stamp', tr(W - pad - 66, pad + titleH + dateH, 56, 56), 41, { visible: v.stamp, layoutParticipation: 'overlay' }),
    make('decoration', 'compass', 'compass', tr(W - pad - 45, H - bottom - 50, 34, 34), 42, { visible: v.compass, layoutParticipation: 'overlay' }),
    make('decoration', 'string', 'string', tr(W * .5 - 14, 0, 28, 50), 43, { visible: v.string, layoutParticipation: 'overlay' }),
    make('attribution', 'attribution', 'attribution', tr(pad, H - pad + 5, W - 2 * pad, 22), 50, { fontSize: 9, color: style.palette.ink, locked: true, layoutParticipation: 'reserved' }),
  );
  const conflicts: LayoutConflict[] = [];
  if (body.height < 80 || body.width < 100 || titleLines > 4) conflicts.push({ nodeId: 'title', code: 'TEXT_OVERFLOW', message: '文字与安全区无法容纳：请缩短标题、增加画布高度或隐藏次要信息。' });
  const merged = nodes.map(n => {
    const old = existing.get(n.id);
    if (!old) return n;
    let transform = n.transform;
    if (art.layout.mode === 'free') transform = { ...old.transform };
    else {
      if (old.constraint.position === 'pinned') transform = { ...transform, x: old.transform.x, y: old.transform.y, rotation: old.transform.rotation };
      if (old.constraint.size === 'fixed') transform = { ...transform, width: old.transform.width, height: old.transform.height };
    }
    return { ...n, transform, constraint: old.constraint, crop: old.crop ?? n.crop, photoEdit: old.photoEdit ?? n.photoEdit, userOverrides: old.userOverrides, ...(old.userOverrides?.fontSize ? { fontSize: Number(old.userOverrides.fontSize) } : {}), ...(old.userOverrides?.color ? { color: String(old.userOverrides.color) } : {}), ...(old.userOverrides?.text ? { text: String(old.userOverrides.text) } : {}) };
  });
  for (const n of merged) {
    if (!n.visible || n.layoutParticipation === 'overlay') continue;
    const t = n.transform;
    if (t.width < 1 || t.height < 1 || t.x < -1 || t.y < -1 || t.x + t.width > W + 1 || t.y + t.height > H + 1) conflicts.push({ nodeId: n.id, code: 'OUTSIDE_ARTBOARD', message: `「${n.role}」超出画板，请释放位置/尺寸锁定或调整版式。` });
    if (n.kind === 'photo' && (t.width < 50 || t.height < 40)) conflicts.push({ nodeId: n.id, code: 'PHOTO_TOO_SMALL', message: '照片槽位过小，请减少本版照片数量或增加画布比例。' });
  }
  // Reserved attribution must never be covered by a manually pinned content object.
  const attr = merged.find(n => n.kind === 'attribution')!;
  for (const n of merged.filter(n => n.visible && n.constraint.position === 'pinned' && ['photo','map','text'].includes(n.kind))) {
    if (intersects(n.transform, attr.transform)) conflicts.push({ nodeId: n.id, code: 'ATTRIBUTION_COLLISION', message: '锁定内容覆盖来源署名，请移动内容或释放位置锁定。' });
  }
  return { inputHash: layoutInputHash(art), selectionRevision: art.journey.selectionRevision, layoutRevision: art.layout.layoutRevision, solverVersion: SOLVER_VERSION, nodes: merged, conflicts };
}
export function intersects(a: Transform, b: Transform) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
export function applyLayoutProposal(art: ArtworkDocument, proposal: LayoutProposal): ArtworkDocument {
  if (proposal.inputHash !== layoutInputHash(art) || proposal.selectionRevision !== art.journey.selectionRevision || proposal.layoutRevision !== art.layout.layoutRevision) throw new Error('排版结果已过期，请重新计算。');
  if (proposal.conflicts.length) throw new Error(proposal.conflicts.map(c => c.message).join('\n'));
  return { ...art, nodes: proposal.nodes, layout: { ...art.layout, layoutRevision: art.layout.layoutRevision + 1, solverVersion: proposal.solverVersion } };
}
export function snapTransform(t: Transform, width: number, height: number, enabled = true) {
  if (!enabled) return t;
  const snap = (value: number, anchors: number[]) => anchors.find(a => Math.abs(a - value) < 7) ?? Math.round(value);
  return { ...t, x: snap(t.x, [28, (width - t.width) / 2, width - t.width - 28]), y: snap(t.y, [28, (height - t.height) / 2, height - t.height - 28]) };
}
