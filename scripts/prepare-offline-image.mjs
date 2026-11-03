import { mkdir, copyFile, cp, writeFile, readFile, rm, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.runtime', 'container-build');
// Never reuse a stale build context that may contain files outside our whitelist.
// Verify both the lexical path and existing real path before recursive removal.
if (path.relative(root, output) !== path.join('.runtime', 'container-build')) throw new Error('Unexpected container build path');
try {
  const info = await lstat(output);
  if (info.isSymbolicLink() || path.relative(await realpath(root), await realpath(output)) !== path.join('.runtime', 'container-build')) throw new Error('Refusing a redirected container build directory');
  await rm(output, { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output, { recursive: true });
const sources = [
  'packages/mock-api/index.mjs',
  'packages/lab-controller/node-runner.mjs',
];
const manifest = {};
for (const source of sources) {
  const destination = path.join(output, source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, source), destination);
  manifest[source] = createHash('sha256').update(await readFile(destination)).digest('hex');
}
const dependencies = ['@llm-discovery/discovery-core', '@llm-discovery/advertiser', 'multicast-dns', 'dns-packet', 'thunky', '@leichtgewicht/ip-codec'];
for (const dependency of dependencies) {
  await cp(path.join(root, 'node_modules', dependency), path.join(output, 'node_modules', dependency), { recursive: true });
}
await copyFile(path.join(root, 'deploy', 'Dockerfile.offline'), path.join(output, 'Dockerfile'));
await writeFile(path.join(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ context: output, sources: sources.length, dependencies: dependencies.length, secretsIncluded: false }));
