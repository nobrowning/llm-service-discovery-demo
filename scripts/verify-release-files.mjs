/** Check the extracted deployment on Windows, macOS or Linux. */
import { readFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entries = (await readFile(path.join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n');
const seen = new Set();
for (const line of entries) {
  const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line.replace(/\r$/, ''));
  if (!match) throw new Error('Invalid SHA256SUMS entry');
  const [, expected, name] = match;
  const parts = name.split('/');
  if (name.includes('\\') || name.includes(':') || parts.some(p => !p || p === '.' || p === '..') || seen.has(name)) throw new Error(`Unsafe or duplicate release path: ${name}`);
  seen.add(name);
  let file = root;
  for (const part of parts) {
    file = path.join(file, part);
    if ((await lstat(file)).isSymbolicLink()) throw new Error(`Release links are not supported: ${name}`);
  }
  if (!(await lstat(file)).isFile()) throw new Error(`Release entry is not a regular file: ${name}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest('hex') !== expected) throw new Error(`SHA-256 mismatch: ${name}`);
}
for (const file of ['release-manifest.json', 'package.json', 'vendor/manifest.json']) if (!seen.has(file)) throw new Error(`Missing release entry: ${file}`);
const manifest = JSON.parse(await readFile(path.join(root, 'release-manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.schema !== 'llm-discovery-demo-release/v1' || manifest.version !== pkg.version) throw new Error('Release/package version mismatch');
console.log(JSON.stringify({ verified: entries.length, platform: manifest.platform, version: manifest.version }));
