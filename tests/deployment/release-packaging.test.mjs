import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const powershells = (process.platform === 'win32' ? ['pwsh', 'powershell.exe'] : ['pwsh'])
  .filter(command => spawnSync(command, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 10_000 }).status === 0);
const digest = value => createHash('sha256').update(value).digest('hex');
const run = (command, args, cwd) => {
  const env = { ...process.env };
  // A Node process launched from pwsh inherits its Core module path; let the
  // separate Windows PowerShell 5.1 process discover its own built-in modules.
  if (command.toLowerCase().endsWith('powershell.exe')) {
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  }
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60_000 });
};
function success(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout; }

async function fixture(t) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'llm-release-packaging-'));
  t.after(async () => {
    const base = await realpath(tmpdir()), target = await realpath(scratch), relative = path.relative(base, target);
    assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && path.dirname(target) === base);
    await rm(target, { recursive: true, force: true });
  });
  const root = path.join(scratch, 'source fixture');
  async function write(relative, value) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value);
  }
  const componentBytes = Buffer.from('synthetic tarball fixture; never installed');
  const component = { name: '@release-test/component', repository: 'fixture', version: '1.2.3', file: 'fixture-component-1.2.3.tgz', sha256: digest(componentBytes) };
  await write('package.json', JSON.stringify({ name: 'release-test', version: '9.8.7', private: true, type: 'module', dependencies: { [component.name]: `file:vendor/${component.file}` } }));
  await write('package-lock.json', '{}');
  await write('README.md', 'Fixture deployment\n');
  await write('LICENSE', 'Fixture license\n');
  await write('vendor/manifest.json', JSON.stringify({ schema: 'llm-discovery-component-manifest/v1', components: [component] }));
  await write('vendor/README.md', 'Fixture provenance\n');
  await write(`vendor/${component.file}`, componentBytes);
  await write('vendor/old-unused.tgz', 'old component must not be copied');
  await write('packages/lab-controller/native.mjs', '// tracked native entry\n');
  await write('node_modules/@release-test/component/package.json', JSON.stringify({ name: component.name, version: component.version }));
  await write('node_modules/thunky/package.json', '{"name":"thunky","version":"1.1.0"}');
  await write('node_modules/@leichtgewicht/ip-codec/package.json', '{"name":"@leichtgewicht/ip-codec","version":"2.0.5"}');
  await write('node_modules/.bin/ignored.cmd', 'must not be included');
  await write('.runtime/private.txt', 'must not be included');
  await write('.env', 'fixture-only=must-not-be-included');
  for (const script of ['prepare-release.mjs', 'package-release.ps1', 'verify-release-files.mjs']) {
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    await copyFile(path.join(repository, 'scripts', script), path.join(root, 'scripts', script));
  }
  success(run('git', ['init', '--quiet'], root));
  success(run('git', ['add', '--', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'vendor', 'packages', 'scripts'], root));
  success(run('git', ['-c', 'user.name=Release fixture', '-c', 'user.email=release-test@example.invalid', 'commit', '--quiet', '-m', 'Packaging fixture'], root));
  const image = path.join(scratch, 'fixture image.tar.gz');
  await writeFile(image, 'synthetic image bytes; never loaded by Docker');
  const imageId = `sha256:${'a'.repeat(64)}`;
  const prepare = args => run(process.execPath, [path.join(root, 'scripts/prepare-release.mjs'), ...args], root);
  const verify = directory => run(process.execPath, [path.join(directory, 'scripts/verify-release-files.mjs')], directory);
  return { scratch, root, image, imageId, component, prepare, verify };
}

test('native and WSL staging include the matching runtime and hashes without local state', { skip: !gitAvailable && 'Git is required for packaging fixtures' }, async t => {
  const f = await fixture(t);
  const native = path.join(f.scratch, 'native deployment');
  success(f.prepare(['--platform', 'native', '--output', native]));
  const nativeManifest = JSON.parse(await readFile(path.join(native, 'release-manifest.json'), 'utf8'));
  assert.equal(nativeManifest.platform, 'native-node');
  assert.equal(nativeManifest.version, '9.8.7');
  assert.equal(nativeManifest.image, undefined);
  assert.deepEqual(nativeManifest.components, [f.component]);
  success(f.verify(native));
  assert.equal(await readFile(path.join(native, 'packages/lab-controller/native.mjs'), 'utf8'), '// tracked native entry\n');
  for (const name of ['.runtime/private.txt', '.env', 'node_modules/.bin/ignored.cmd', 'vendor/old-unused.tgz']) {
    await assert.rejects(readFile(path.join(native, name)), { code: 'ENOENT' });
  }
  assert.notEqual(f.prepare(['--platform', 'native', '--output', native]).status, 0, 'Do not merge with an existing stage');
  assert.notEqual(f.prepare(['--platform', 'native', '--image', f.image, '--output', path.join(f.scratch, 'invalid-native')]).status, 0);
  const wsl = path.join(f.scratch, 'wsl deployment');
  success(f.prepare(['--platform', 'windows-x64-wsl', '--image', f.image, '--image-id', f.imageId, '--output', wsl]));
  const wslManifest = JSON.parse(await readFile(path.join(wsl, 'release-manifest.json'), 'utf8'));
  assert.equal(wslManifest.platform, 'windows-x64-wsl-ubuntu-amd64');
  assert.equal(wslManifest.image.tag, 'llm-discovery-demo:9.8.7');
  assert.equal(wslManifest.image.file, 'images/llm-discovery-demo-9.8.7.tar.gz');
  assert.equal(wslManifest.image.sha256, digest(await readFile(f.image)));
  success(f.verify(wsl));
});

test('release staging rejects stale installed component versions before shipping them', { skip: !gitAvailable && 'Git is required for packaging fixtures' }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'node_modules/@release-test/component/package.json'), JSON.stringify({ name: f.component.name, version: '0.0.1' }));
  const result = f.prepare(['--platform', 'native', '--output', path.join(f.scratch, 'stale deployment')]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version|npm ci/i);
});

test('extracted deployment verification rejects corruption, unsafe paths, duplicates and omissions', { skip: !gitAvailable && 'Git is required for packaging fixtures' }, async t => {
  const f = await fixture(t), stage = path.join(f.scratch, 'verify deployment');
  success(f.prepare(['--platform', 'native', '--output', stage]));
  const sumsFile = path.join(stage, 'SHA256SUMS');
  const sums = await readFile(sumsFile, 'utf8');
  const readme = await readFile(path.join(stage, 'README.md'));
  await writeFile(path.join(stage, 'README.md'), 'changed after packaging');
  assert.match(f.verify(stage).stderr, /SHA-256 mismatch/);
  await writeFile(path.join(stage, 'README.md'), readme);
  for (const invalid of [
    sums + `${'0'.repeat(64)}  ../outside.txt\n`,
    sums + sums.split('\n')[0] + '\n',
    sums.split('\n').filter(line => !line.endsWith('  release-manifest.json')).join('\n'),
  ]) {
    await writeFile(sumsFile, invalid);
    assert.notEqual(f.verify(stage).status, 0);
  }
  await writeFile(sumsFile, sums);
  success(f.verify(stage));
});

test('PowerShell packaging preserves both ZIP checksums and portable entry separators', { skip: !gitAvailable ? 'Git is required for packaging fixtures' : !powershells.length && 'PowerShell is optional for native Node users' }, async t => {
  for (const powershell of powershells) await t.test(powershell, async child => {
    const f = await fixture(child), output = path.join(f.scratch, 'combined release');
    const wrapper = path.join(f.root, 'scripts/package-release.ps1');
    const invoke = args => run(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper, ...args], f.root);
    const inspector = path.join(f.scratch, 'inspect zip.ps1');
    await writeFile(inspector, `param([string]$Zip)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($Zip)
try { ConvertTo-Json -InputObject @($archive.Entries | ForEach-Object { $_.FullName }) -Compress }
finally { $archive.Dispose() }
`);
    success(invoke(['-Platform', 'native', '-OutputDirectory', output]));
    success(invoke(['-Platform', 'windows-x64-wsl', '-ImageArchive', f.image, '-ImageId', f.imageId, '-OutputDirectory', output]));
    const sums = (await readFile(path.join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n');
    assert.equal(sums.length, 2);
    assert.ok(sums.some(line => line.endsWith('-native.zip')));
    assert.ok(sums.some(line => line.endsWith('-windows-x64-wsl.zip')));
    for (const line of sums) {
      const [, expected, name] = /^([a-f0-9]{64})  (.+)$/.exec(line);
      const archivePath = path.join(output, name);
      assert.equal(digest(await readFile(archivePath)), expected);
      const entries = JSON.parse(success(run(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', inspector, '-Zip', archivePath], f.root)));
      assert.ok(entries.some(entry => entry.startsWith('scripts/')), 'Nested ZIP entries use POSIX separators');
      assert.ok(entries.every(entry => !entry.includes('\\') && !entry.startsWith('/') && !entry.includes(':')), 'ZIP entry paths must be portable across Windows/macOS/Linux');
    }
    assert.notEqual(invoke(['-Platform', 'native', '-OutputDirectory', output]).status, 0);
    assert.equal((await readFile(path.join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 2, 'A refused rebuild must not append a duplicate checksum');
  });
});
