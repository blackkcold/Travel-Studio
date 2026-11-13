import { readdir, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, 'release/verification-evidence/acceptance-evidence-app/test-results');
const destination = resolve(root, 'examples/projects');
const entries = await readdir(evidence, { recursive: true });
const examples = [
  ['current-artwork-only.travelstudio', 'kyoto-three-visits.travelstudio'],
  ['mobile-photo-only-project.travelstudio', 'photo-with-unknown-facts.travelstudio'],
];
const retry = path => Number(path.match(/-retry(\d+)(?:\/|$)/)?.[1] ?? 0);
const records = [];
await mkdir(destination, { recursive: true });
for (const [input, output] of examples) {
  const candidates = entries.filter(path => path === input || path.endsWith(`/${input}`)).sort((a, b) => retry(b) - retry(a));
  if (!candidates.length) throw new Error(`Accepted example is missing: ${input}`);
  const source = candidates[0], bytes = await readFile(resolve(evidence, source));
  await copyFile(resolve(evidence, source), resolve(destination, output));
  records.push({ file: output, sourceArtifact: 'acceptance-evidence-app', sourceFile: source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(resolve(destination, 'provenance.json'), JSON.stringify({
  commit: process.env.GITHUB_SHA ?? null,
  run: process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  notice: 'Synthetic CC0 test photos and metadata; map data retain their own licenses and attribution. These are not observed travel facts.',
  examples: records,
}, null, 2) + '\n');
console.log(`Collected ${records.length} accepted project examples.`);
