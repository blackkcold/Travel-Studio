import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const output = resolve('dist');
const html = readFileSync(resolve(output, 'index.html'), 'utf8');
if (!html.includes('Travel Studio') || html.includes('/src/main.tsx')) {
  throw new Error('The static entry point is missing or not compiled.');
}
const refs = [...html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)].map(match => match[1]);
let builtJS = 0;
for (const ref of refs) {
  if (/^(?:https?:|data:|mailto:|#|\/\/)/i.test(ref)) continue;
  const path = ref.split(/[?#]/, 1)[0];
  if (path.startsWith('/')) throw new Error(`Root-absolute asset breaks Pages subpath: ${ref}`);
  const full = resolve(output, path);
  if (!full.startsWith(output + sep)) throw new Error(`Asset escapes output folder: ${ref}`);
  if (!existsSync(full)) throw new Error(`Missing built asset: ${ref}`);
  if (/\.js$/i.test(path)) builtJS++;
}
if (builtJS === 0) throw new Error('No compiled JavaScript found in the entry point.');
console.log(`Validated ${refs.length} entry-point references under dist/.`);
