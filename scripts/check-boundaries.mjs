import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

const root = path.resolve('src');
// Directory aliases are responsibilities, not separately deployable packages.
const moduleOfDirectory = {
  app: 'M01', ui: 'M01', domain: 'M02', journey: 'M03', geo: 'M04', map: 'M05',
  'design-packages': 'M06', photo: 'M07', composition: 'M08', export: 'M09',
  providers: 'M10', storage: 'M11', runtime: 'M12', plugins: 'M12',
};
const allowed = {
  M01: new Set(['M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12']),
  M02: new Set(), M03: new Set(['M02', 'M04']), M04: new Set(['M02']),
  M05: new Set(['M02', 'M04', 'M06', 'M10']), M06: new Set(['M02']),
  M07: new Set(['M02', 'M10', 'M11', 'M12']), M08: new Set(['M02', 'M06']),
  M09: new Set(['M02', 'M05', 'M06', 'M07', 'M08', 'M10', 'M11', 'M12']),
  M10: new Set(['M02', 'M04', 'M12']), M11: new Set(['M02']), M12: new Set(['M02']),
};
const paths = [];
async function walk(directory) { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) await walk(file); else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) paths.push(file); } }
await walk(root);
const failures = [], edges = new Map(Object.keys(allowed).map(id => [id, new Set()]));
function fail(file, node, message) { const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()); failures.push(`${path.relative(process.cwd(), file)}:${position.line + 1}: ${message}`); }
function isTypeOnly(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return true;
    return !!clause && !clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(e => e.isTypeOnly);
  }
  return ts.isExportDeclaration(node) && (node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly)));
}
// TypeScript 7's native parser supplies the same AST without a second parser dependency.
const compiler = new API({ cwd: process.cwd() });
const snapshot = compiler.updateSnapshot({ openProjects: [path.resolve('tsconfig.json')] });
const project = snapshot.getProject(path.resolve('tsconfig.json'));
if (!project) throw new Error('Unable to inspect the TypeScript project.');
for (const file of paths) {
  const source = project.program.getSourceFile(file);
  if (!source) { failures.push(`Unparsed source: ${file}`); continue; }
  const relative = path.relative(root, file).split(path.sep), owner = moduleOfDirectory[relative[0]];
  function inspect(specifier, node, typeOnly) {
    if (!owner) return; // src/main.tsx is the application entry and composition root.
    if (!specifier.startsWith('.')) {
      if (owner === 'M02' && !typeOnly) fail(file, node, `M02 must remain dependency-free; found ${specifier}`);
      if (owner !== 'M01' && /^(react|react-dom|zustand|lucide-react)(\/|$)/.test(specifier)) fail(file, node, 'UI framework imported into a non-UI module');
      if (owner !== 'M05' && /^(maplibre-gl|@maplibre\/)/.test(specifier) && !typeOnly) fail(file, node, 'Only M05 may own a MapLibre runtime');
      return;
    }
    const target = path.resolve(path.dirname(file), specifier.replace(/\?.*$/, ''));
    const targetRelative = path.relative(root, target).split(path.sep), destination = moduleOfDirectory[targetRelative[0]];
    if (!destination) { if (!target.startsWith(root + path.sep)) fail(file, node, 'Imports outside src are not public module ports'); return; }
    if (owner === destination) return;
    const subpath = targetRelative.slice(1).join('/');
    if (subpath && !/^index(?:\.[cm]?[jt]sx?)?$/.test(subpath)) fail(file, node, `Private cross-module import ${specifier}; use the public index`);
    if (!allowed[owner].has(destination)) fail(file, node, `Forbidden dependency ${owner} → ${destination}`);
    if (owner === 'M01' && ['M07', 'M10', 'M11', 'M12'].includes(destination) && !typeOnly && relative.join('/') !== 'app/bootstrap.ts') {
      fail(file, node, `${destination} runtime implementations must be assembled in app/bootstrap.ts and injected into UI`);
    }
    if (!typeOnly) edges.get(owner).add(destination);
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspect(node.moduleSpecifier.text, node, isTypeOnly(node));
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) inspect(node.arguments[0].text, node, false);
    if (owner === 'M02' && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['fetch', 'XMLHttpRequest', 'WebSocket'].includes(node.expression.text)) fail(file, node, 'Domain core cannot perform network I/O');
    node.forEachChild(visit);
  }
  visit(source);
}
snapshot.dispose();
compiler.close();
const visited = new Set(), active = new Set();
function checkCycle(module, chain) {
  if (active.has(module)) { failures.push(`Runtime dependency cycle: ${[...chain, module].join(' → ')}`); return; }
  if (visited.has(module)) return;
  active.add(module); for (const next of edges.get(module)) checkCycle(next, [...chain, module]); active.delete(module); visited.add(module);
}
for (const module of edges.keys()) checkCycle(module, []);
for (const directory of Object.keys(moduleOfDirectory)) {
  if (['app'].includes(directory)) continue;
  try { await fs.access(path.join(root, directory, 'index.ts')); } catch { failures.push(`Missing public boundary: src/${directory}/index.ts`); }
}
if (failures.length) { process.stderr.write(`${failures.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write(`Module boundaries passed: ${paths.length} source files, 12 modules, no runtime dependency cycles.\n`);
