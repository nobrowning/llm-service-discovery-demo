import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
async function collect(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await collect(file));
    else if (/\.test\.mjs$/.test(entry.name)) result.push(file);
  }
  return result;
}
const files = await collect('tests');
if (!files.length) throw new Error('No tests found');
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });
child.on('exit', (code) => process.exitCode = code ?? 1);
