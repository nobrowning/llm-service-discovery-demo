/** Stage a download-ready deployment without copying any local runtime state. */
import { readFile, writeFile, mkdir, copyFile, lstat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--image', '--image-id', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/prepare-release.mjs --image ARCHIVE.tar.gz --image-id sha256:... --output NEW_DIRECTORY');
  options[args[i].slice(2)] = args[i + 1];
}
if (!options.image || !options.output || !/^sha256:[a-f0-9]{64}$/.test(options['image-id'] ?? '')) throw new Error('Image archive, Docker image ID and a new output directory are required.');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const components = JSON.parse(await readFile(path.join(root, 'vendor/manifest.json'), 'utf8'));
const destination = path.resolve(options.output);
const imagePath = path.resolve(options.image);
if (!(await lstat(imagePath)).isFile() || !imagePath.endsWith('.tar.gz')) throw new Error('Expected a regular .tar.gz Docker image archive');
await mkdir(destination); // Fail rather than merge with a previous, possibly contaminated output.
const hashFile = async file => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
};
const hashes = {};
async function copy(source, relative) {
  const info = await lstat(source);
  if (!info.isFile()) throw new Error(`Refusing non-regular release input: ${relative}`);
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  hashes[relative.replaceAll('\\', '/')] = await hashFile(target);
}
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const componentFiles = new Set(components.components.map(c => `vendor/${c.file}`));
const selected = tracked.filter(file =>
  ['README.md', 'README.zh-CN.md', 'IMPLEMENTATION_PLAN.md', 'LICENSE', 'package.json', 'package-lock.json', 'vendor/manifest.json', 'vendor/README.md'].includes(file) ||
  /^spikes\/network\/[^/]+\.(sh|md|mjs|py)$/.test(file) ||
  /^(docs|deploy|packages|schemas|scripts|tests)\//.test(file) || componentFiles.has(file));
for (const relative of selected) await copy(path.join(root, relative), relative);
for (const component of components.components) {
  if (hashes[`vendor/${component.file}`] !== component.sha256) throw new Error(`Component digest mismatch: ${component.name}`);
}
// Copy only installed packages, not npm caches, .bin links, profiles, or the workspace.
async function copyTree(source, relative) {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Release dependencies must not contain links: ${relative}`);
  if (stat.isDirectory()) {
    for (const entry of await readdir(source)) {
      if (entry === '.bin' || entry === '.package-lock.json') continue;
      await copyTree(path.join(source, entry), path.join(relative, entry));
    }
  } else await copy(source, relative);
}
for (const dependency of Object.keys(pkg.dependencies)) await copyTree(path.join(root, 'node_modules', dependency), path.join('node_modules', dependency));
// Direct packages above also have these hoisted transitive runtime dependencies.
for (const dependency of ['thunky', '@leichtgewicht/ip-codec']) {
  if (!pkg.dependencies[dependency]) await copyTree(path.join(root, 'node_modules', dependency), path.join('node_modules', dependency));
}
const imageRelative = `images/llm-discovery-demo-${pkg.version}.tar.gz`;
await copy(imagePath, imageRelative);
const manifest = {
  schema: 'llm-discovery-demo-release/v1', version: pkg.version,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: 'windows-x64-wsl-ubuntu-amd64',
  image: { file: imageRelative, tag: `llm-discovery-demo:${pkg.version}`, id: options['image-id'], sha256: hashes[imageRelative] },
  prerequisites: { node: '>=24', wsl: 'existing x86-64 Ubuntu', harness: ['0.2.1-rc.3', '0.2.1-rc.5'], firstStartNetwork: 'Docker static tools and Compose are downloaded when absent' },
  components: components.components,
};
await writeFile(path.join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
hashes['release-manifest.json'] = await hashFile(path.join(destination, 'release-manifest.json'));
await writeFile(path.join(destination, 'SHA256SUMS'), Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)).map(([file, digest]) => `${digest}  ${file}\n`).join(''));
console.log(JSON.stringify({ directory: destination, version: pkg.version, files: Object.keys(hashes).length, imageId: manifest.image.id, runtimeStateIncluded: false }));
