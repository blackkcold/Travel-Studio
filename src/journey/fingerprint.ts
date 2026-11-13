import type { TravelLibrary } from '../domain';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : canonical(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
/** Stable content-change key, not an asset-integrity or security signature. */
export function libraryFingerprint(library: TravelLibrary): string {
  const source = canonical(library); let a = 2166136261, b = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) { const code = source.charCodeAt(index); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ code, 0x85ebca6b); b ^= b >>> 13; }
  return `lib1-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
