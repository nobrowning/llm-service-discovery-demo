import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../packages/mock-api/server.mjs', import.meta.url));
const fixtureKey = 'synthetic-standalone-cli-key';

async function launch(t, configuration) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('MOCK_')));
  const child = spawn(process.execPath, [entry], {
    env: { ...inherited, MOCK_ALLOW_HTTP: 'true', MOCK_HOST: '127.0.0.1', MOCK_PORT: '0', ...configuration },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const exited = once(child, 'exit');
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const listening = stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(event => event.event === 'listening');
    if (listening || child.exitCode !== null) return { child, listening, output: () => stdout + stderr };
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Standalone Mock startup exceeded the bounded fixture deadline.');
}

function get(port, pathname, apiKey) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: pathname, headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, agent: false }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.setTimeout(3000, () => request.destroy(new Error('CLI fixture request timed out.')));
    request.on('error', reject);
  });
}

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'llm-discovery-cli-auth-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('llm-discovery-cli-auth-'));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('standalone CLI keyless C listens without credential configuration', async t => {
  const result = await launch(t, { MOCK_NODE: 'C' });
  assert.ok(result.listening, 'Keyless C must start without a credential file.');
  assert.equal(result.listening.services[0].auth, 'none');
  assert.equal(await get(result.listening.address.port, '/api/v1/models'), 200);
});

test('standalone CLI A and B reject missing keys before listening', async t => {
  for (const node of ['A', 'B']) {
    const result = await launch(t, { MOCK_NODE: node });
    assert.equal(result.child.exitCode, 1);
    assert.equal(result.listening, undefined);
    assert.ok(result.output().includes('auth:required'), 'Failure must identify the missing protected-service credential without printing values.');
  }
});

test('standalone CLI A accepts only a Vision key while its text route needs none', async t => {
  const dir = await directory(t);
  const tokenFile = path.join(dir, 'tokens.json');
  await writeFile(tokenFile, JSON.stringify({ 'a-vision': fixtureKey }));
  const result = await launch(t, { MOCK_NODE: 'A', MOCK_TOKENS_FILE: tokenFile });
  assert.ok(result.listening, 'Only the protected Vision service needs a configured key.');
  const port = result.listening.address.port;
  assert.equal(await get(port, '/text/v1/models'), 200);
  assert.equal(await get(port, '/vision/v1/models'), 401);
  assert.equal(await get(port, '/vision/v1/models', fixtureKey), 200);
  assert.ok(!result.output().includes(fixtureKey), 'Startup and request logs must not include the synthetic credential.');
});

test('standalone CLI validates service auth overrides before listening', async t => {
  const dir = await directory(t);
  for (const auth of ['required', 'unknown']) {
    const configFile = path.join(dir, `${auth}.json`);
    await writeFile(configFile, JSON.stringify([{ id: 'c-basic', auth }]));
    const result = await launch(t, { MOCK_NODE: 'C', MOCK_SERVICE_CONFIG_FILE: configFile });
    assert.equal(result.child.exitCode, 1);
    assert.equal(result.listening, undefined);
    assert.ok(result.output().includes(auth === 'required' ? 'Bearer token' : 'auth must be none or required'));
  }
});
