/** M06: versioned, declarative recipes; no network, document mutations or UI. */
export interface ArtPalette {
  id: string; name: string; paper: string; ink: string; accent: string; land: string;
  water: string; park: string; road: string; roadCase: string; building: string;
  label: string; route: string;
}
export interface ArtStyle {
  id: string; version: string; name: string; english: string; description: string;
  font: string; texture: 'rice' | 'pencil' | 'parchment' | 'canvas' | 'grain' | 'none';
  roadWidth: number; labelDensity: number; palettes: [ArtPalette, ArtPalette];
}
const palette = (id: string, name: string, paper: string, ink: string, accent: string, land: string, water: string, park: string, road: string, building: string): ArtPalette => ({ id, name, paper, ink, accent, land, water, park, road, roadCase: paper, building, label: ink, route: accent });
const serif = '"Noto Serif SC", Georgia, serif';
const sans = 'Inter, "Noto Sans", system-ui, sans-serif';
export const STYLES: ArtStyle[] = [
  { id: 'ink', version: '1.0.0', name: '东方水墨', english: 'Ink & wash', description: '墨色山水，朱砂留印', font: serif, texture: 'rice', roadWidth: .75, labelDensity: .75, palettes: [palette('jade', '青山', '#f4f0e6', '#303e3a', '#b04c3b', '#e7e8dc', '#bfd0ca', '#c4cbb9', '#7a8680', '#b8c0b8'), palette('indigo', '远岚', '#edf0ed', '#334553', '#ac5260', '#dce4e0', '#aec6d2', '#b9c8c5', '#7d919c', '#b6c4cc')] },
  { id: 'sketch', version: '1.0.0', name: '精致手绘', english: 'Field notes', description: '彩铅线条，轻柔淡彩', font: serif, texture: 'pencil', roadWidth: 1.15, labelDensity: .9, palettes: [palette('meadow', '原野', '#fbf6e9', '#4d5748', '#bc6f52', '#eee9d6', '#b5d9db', '#cad5b2', '#baab89', '#ddbd9d'), palette('rose', '暮色', '#fcf1ed', '#654e54', '#9f5571', '#f0e0da', '#b8cbdc', '#d7d3bd', '#b99f99', '#d7b5b2')] },
  { id: 'parchment', version: '1.0.0', name: '复古羊皮纸', english: 'An old atlas', description: '雕刻般道路，暖棕纸色', font: serif, texture: 'parchment', roadWidth: .95, labelDensity: .65, palettes: [palette('sepia', '航海', '#e8d5ad', '#594b34', '#9c5034', '#decda7', '#b7c2af', '#c3bc91', '#9a8056', '#c5ad80'), palette('night', '星图', '#ded2ba', '#3b4b58', '#aa6c38', '#cec6b5', '#93aab5', '#a9b19b', '#7b8584', '#b5b0a0')] },
  { id: 'oil', version: '1.0.0', name: '古典油画', english: 'Painted places', description: '深沉色块，细腻画布', font: serif, texture: 'canvas', roadWidth: 1.35, labelDensity: .65, palettes: [palette('olive', '橄榄', '#e9e0cb', '#384639', '#b78145', '#c7c7a8', '#809f9e', '#9bac88', '#e5d6b8', '#b8aa87'), palette('coast', '海岸', '#e7e1d8', '#3c5160', '#ac694b', '#cbd2c6', '#85a7ba', '#b3bc9b', '#f0e2cc', '#c6bda9')] },
  { id: 'poster', version: '1.0.0', name: '复古海报', english: 'Wish you were here', description: '限定色域，鲜明留白', font: sans, texture: 'grain', roadWidth: 1.7, labelDensity: .55, palettes: [palette('sunset', '落日', '#f4e6c9', '#2b555b', '#cf6949', '#e7ce9f', '#80b7be', '#b9b993', '#fff0cf', '#cd9e79'), palette('alpine', '山野', '#f0eddd', '#31594e', '#dc8d41', '#d3d7b1', '#9fbfc0', '#9bb896', '#fff2cf', '#c3bd96')] },
  { id: 'modern', version: '1.0.0', name: '极简现代', english: 'Quiet memories', description: '克制线条，让记忆留白', font: sans, texture: 'none', roadWidth: .85, labelDensity: .95, palettes: [palette('sage', '鼠尾草', '#f8f8f3', '#374a43', '#6e8272', '#e7ebe4', '#c4d8da', '#cbd9c5', '#fffef8', '#d8ddd7'), palette('lavender', '雾紫', '#f7f5f8', '#4d4759', '#8b6cac', '#e9e6ec', '#cbd4e0', '#d3dccc', '#ffffff', '#d8d1df')] },
];
export interface TemplateDefinition { id: string; family: string; name: string; english: string; description: string; ratio: [number, number]; shape: 'rectangle' | 'torn' | 'ticket'; variant: number; version: string }
export const TEMPLATES: TemplateDefinition[] = [
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
export function getStyle(id: string, paletteId?: string) {
  const style = STYLES.find(s => s.id === id) ?? STYLES[0];
  const palette = style.palettes.find(p => p.id === paletteId) ?? style.palettes[0];
  return { ...style, palette };
}
export function getTemplate(id: string) { return TEMPLATES.find(t => t.id === id) ?? TEMPLATES[0]; }
export function templateSize(id: string) {
  const [w, h] = getTemplate(id).ratio;
  return { width: Math.round(1000 * w / Math.max(w, h)), height: Math.round(1000 * h / Math.max(w, h)) };
}
export function mapRecipe(styleId: string, paletteId?: string) {
  const s = getStyle(styleId, paletteId);
  return { ...s.palette, roadWidth: s.roadWidth, labelDensity: s.labelDensity };
}
export function recommendTemplate(photos: number, visits: number, places: number) {
  if (photos === 1 && places <= 1) return 'ticket-photo';
  if (places > 5) return 'poster-full';
  if (visits > 2 && photos > 2) return 'film-vertical';
  if (photos > 4) return 'collage-scatter';
  return 'card-split';
}
