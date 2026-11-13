import type { Coordinate } from '../domain';

export const EARTH_RADIUS_KM = 6371.0088;
const rad = (v: number) => v * Math.PI / 180;
const deg = (v: number) => v * 180 / Math.PI;
export function isCoordinate(input: unknown): input is Coordinate { return Array.isArray(input) && input.length === 2 && input.every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(input[0]) <= 180 && Math.abs(input[1]) <= 90; }
export function assertCoordinate(input: unknown): asserts input is Coordinate { if (!isCoordinate(input)) throw new Error('坐标必须为有效的 [经度, 纬度]，经度 ±180、纬度 ±90。'); }
export function normalizeLongitude(longitude: number): number { if (!Number.isFinite(longitude)) throw new Error('经度必须是有限值'); return ((longitude + 180) % 360 + 360) % 360 - 180; }
export function distanceKm(a: Coordinate, b: Coordinate): number {
  assertCoordinate(a); assertCoordinate(b); const dlat = rad(b[1] - a[1]), dlng = rad(normalizeLongitude(b[0] - a[0]));
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dlng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export const haversineKm = distanceKm;
export function parseCoordinate(input: string): Coordinate | null {
  const match = input.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,，]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
  if (!match) return null; const point: Coordinate = [Number(match[1]), Number(match[2])]; return isCoordinate(point) ? point : null;
}
/** Map bounds may extend beyond 180; that is intentional for the minimal dateline span. */
export function minimalBounds(points: Coordinate[]): [[number, number], [number, number]] | null {
  const valid = points.filter(isCoordinate); if (!valid.length) return null;
  const longitudes = valid.map(p => ((p[0] % 360) + 360) % 360).sort((a, b) => a - b);
  let largestGap = -1, afterGap = 0;
  for (let i = 0; i < longitudes.length; i++) { const next = i + 1 === longitudes.length ? longitudes[0] + 360 : longitudes[i + 1]; const gap = next - longitudes[i]; if (gap > largestGap) { largestGap = gap; afterGap = (i + 1) % longitudes.length; } }
  let west = longitudes[afterGap]; let east = west + (360 - largestGap); if (west > 180) { west -= 360; east -= 360; }
  return [[west, Math.min(...valid.map(p => p[1]))], [east, Math.max(...valid.map(p => p[1]))]];
}
export function boundsCenter(points: Coordinate[]): Coordinate | null { const bounds = minimalBounds(points); return bounds ? [normalizeLongitude((bounds[0][0] + bounds[1][0]) / 2), (bounds[0][1] + bounds[1][1]) / 2] : null; }
export function withinBounds(point: Coordinate, bounds: { west: number; south: number; east: number; north: number }): boolean {
  const lng = normalizeLongitude(point[0]); const west = normalizeLongitude(bounds.west), east = normalizeLongitude(bounds.east);
  const longitudeInside = Math.abs(bounds.east - bounds.west) >= 360 || (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east);
  return longitudeInside && point[1] >= bounds.south && point[1] <= bounds.north;
}
/** Splits at ±180 so a short dateline crossing is never rendered around the world. */
export function splitDateline(a: Coordinate, b: Coordinate): Coordinate[][] {
  assertCoordinate(a); assertCoordinate(b);
  if (Math.abs(a[0] - b[0]) <= 180) return [[a.slice() as Coordinate, b.slice() as Coordinate]];
  const adjustedLng = b[0] > a[0] ? b[0] - 360 : b[0] + 360;
  const edge = adjustedLng > a[0] ? 180 : -180;
  const t = (edge - a[0]) / (adjustedLng - a[0]); const latitude = a[1] + (b[1] - a[1]) * t;
  return [[a.slice() as Coordinate, [edge, latitude]], [[-edge, latitude], b.slice() as Coordinate]];
}
/** Spherical interpolation for explicitly labelled geodesic illustrations. */
export function geodesicPoints(a: Coordinate, b: Coordinate, steps = 32): Coordinate[] {
  assertCoordinate(a); assertCoordinate(b); if (!Number.isInteger(steps) || steps < 1 || steps > 1024) throw new Error('采样数量超范围');
  const angle = distanceKm(a, b) / EARTH_RADIUS_KM;
  if (angle < 1e-10) return [a, b];
  if (Math.abs(Math.sin(angle)) < 1e-7) throw new Error('对跖点的大圆路径不唯一，请增加中间站。');
  const result: Coordinate[] = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps; const p = Math.sin((1 - t) * angle) / Math.sin(angle), q = Math.sin(t * angle) / Math.sin(angle); const x = p * Math.cos(rad(a[1])) * Math.cos(rad(a[0])) + q * Math.cos(rad(b[1])) * Math.cos(rad(b[0])); const y = p * Math.cos(rad(a[1])) * Math.sin(rad(a[0])) + q * Math.cos(rad(b[1])) * Math.sin(rad(b[0])); const z = p * Math.sin(rad(a[1])) + q * Math.sin(rad(b[1])); result.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))]); }
  return result;
}
