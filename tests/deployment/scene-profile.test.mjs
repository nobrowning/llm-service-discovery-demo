import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { servicesForScene } from '../../packages/lab-controller/scene-profile.mjs';
import { defaultServicesForNode, createMockServer } from '../../packages/mock-api/index.mjs';
import { initializeLab } from '../../packages/lab-controller/initialize.mjs';
import { startNativeLab } from '../../packages/lab-controller/native.mjs';

const temp = async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'llm-scene-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};
const identity = service => [service.id, service.model, service.base, service.auth];

test('scene profiles preserve technical service identities and default behavior', () => {
  const defaults = ['A', 'B'].flatMap(defaultServicesForNode);
  assert.deepEqual(['A', 'B'].flatMap(node => servicesForScene(node)), defaults);
  const company = ['A', 'B'].flatMap(node => servicesForScene(node, 'company'));
  assert.deepEqual(company.map(identity), defaults.map(identity));
  assert.deepEqual(company.map(service => [service.display_name, service.deployment, service.enabled]), [
    ['公司·DeepSeek-R1-Distill-Qwen-32B', { parameters: '32B', quantization: 'Q4_K_M', version: 'R1' }, true],
    ['公司·Qwen2.5-VL-7B-Instruct', { parameters: '7B', quantization: 'BF16', version: '2.5-VL' }, true],
    ['公司·GLM-4-9B-Chat', { parameters: '9B', quantization: 'INT4', version: '4' }, true],
  ]);
  const home = ['A', 'B'].flatMap(node => servicesForScene(node, 'home'));
  assert.deepEqual(home.map(identity), defaults.map(identity));
  assert.deepEqual(home.filter(service => service.enabled).map(service => service.id), ['a-text']);
  assert.equal(home[0].display_name, '家庭·Qwen3-8B');
  assert.deepEqual(home[0].deployment, { parameters: '8B', quantization: 'Q8_0', version: '3' });
  assert.ok(home.slice(1).every(service => service.ready === false));
  assert.equal(company[1].label, '公司·Qwen2-5-VL-7B-Instruct', 'DNS instance labels avoid embedded label separators.');
  home[0].deployment.parameters = 'changed';
  assert.equal(servicesForScene('A', 'home')[0].deployment.parameters, '8B');
  assert.deepEqual(['A', 'B'].flatMap(defaultServicesForNode), defaults);
  assert.throws(() => servicesForScene('A', 'unknown'), /Scene must be/);
});

test('CLI initializes independent company/home profiles and reuse preserves every identity file', async t => {
  const directory = await temp(t), exec = promisify(execFile);
  const cli = fileURLToPath(new URL('../../packages/lab-controller/cli.mjs', import.meta.url));
  const options = ['init', '--address', '192.0.2.10', '--interface', '192.0.2.10'];
  const states = [];
  for (const scene of ['company', 'home']) {
    const runtime = path.join(directory, scene);
    await exec(process.execPath, [cli, ...options, '--runtime', runtime, '--scene', scene]);
    const files = ['lab.json', 'server/lab.json', 'server/server-key.pem', 'server/server.pem', 'server/tokens.json', 'client/trust.json', 'client/ca.pem', 'client/marker.txt', 'presenter/demo-api-keys.txt'];
    const snapshot = () => Promise.all(files.map(file => readFile(path.join(runtime, file), 'utf8')));
    const before = await snapshot(), lab = JSON.parse(before[0]);
    assert.equal(lab.scene, scene);
    assert.equal(lab.nodes.flatMap(node => node.services.filter(service => service.enabled)).length, scene === 'company' ? 3 : 1);
    assert.deepEqual(lab.nodes.flatMap(node => node.services.map(service => service.model)), ['mock-text', 'mock-vision', 'mock-tools']);
    const reused = JSON.parse((await exec(process.execPath, [cli, ...options, '--runtime', runtime])).stdout);
    assert.equal(reused.reused, true); assert.equal(reused.topologyMigrationRequired, false); assert.equal(reused.authMigrationRequired, false);
    await exec(process.execPath, [cli, ...options, '--runtime', runtime, '--scene', scene]);
    await assert.rejects(exec(process.execPath, [cli, ...options, '--runtime', runtime, '--scene', scene === 'home' ? 'company' : 'home']), /different scene/);
    assert.deepEqual(await snapshot(), before, 'Reuse and rejected scene changes must preserve config, credentials, trust, certificate and marker bytes.');
    states.push(before);
  }
  assert.notEqual(states[0][3], states[1][3], 'Independent runtimes generate independent TLS identities.');
  assert.notEqual(states[0][4], states[1][4], 'Independent runtimes do not copy credentials.');
});

test('invalid scene is rejected before creating runtime files', async t => {
  const runtimeDir = await temp(t);
  await assert.rejects(initializeLab({ runtimeDir, address: '192.0.2.10', scene: 'office' }), /Scene must be/);
  assert.deepEqual(await readdir(runtimeDir), []);
});

test('home Mock exposes Qwen3 presentation while retaining mock-text protocol and disabling vision', async t => {
  const api = createMockServer({ node: 'A', allowHttp: true, services: servicesForScene('A', 'home'), tokens: { 'a-vision': 'synthetic-vision-key' } });
  t.after(() => api.close());
  const { port } = await api.listen();
  const base = `http://127.0.0.1:${port}`;
  const models = await (await fetch(base + '/text/v1/models')).json();
  assert.equal(models.data[0].id, 'mock-text');
  const capabilities = await (await fetch(base + '/text/v1/_llm/capabilities')).json();
  assert.equal(capabilities.models[0].display_name, '家庭·Qwen3-8B');
  assert.equal(capabilities.mock, true);
  const response = await (await fetch(base + '/text/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'mock-text', input: 'profile protocol unchanged' }) })).json();
  assert.equal(response.status, 'completed');
  const vision = await fetch(base + '/vision/v1/models', { headers: { authorization: 'Bearer synthetic-vision-key' } });
  assert.equal(vision.status, 503);
});

test('native scene option reaches initialization and status lists only enabled home services', async t => {
  const runtimeDir = await temp(t), children = [];
  const forkNode = (_file, _args, options) => {
    const child = new EventEmitter(); child.connected = true;
    const identity = { protocol: 'llm-demo-node/v1', instanceId: options.env.LLM_DEMO_PARENT_INSTANCE, node: options.env.MOCK_NODE };
    child.send = (message, callback) => {
      callback?.();
      setImmediate(() => { child.emit('message', { ...identity, type: 'reply', requestId: message.requestId, ok: true }); if (message.action === 'stop') { child.connected = false; child.emit('exit', 0); } });
    };
    child.kill = () => assert.fail('Expected graceful owned-child stop.');
    children.push(child); setImmediate(() => child.emit('message', { ...identity, type: 'ready' })); return child;
  };
  const controller = await startNativeLab({ runtimeDir, scene: 'home' }, { forkNode, handleSignals: false,
    networkInterfaces: { en0: [{ family: 'IPv4', address: '192.0.2.10', internal: false }] } });
  try {
    assert.equal(controller.status().scene, 'home'); assert.deepEqual(controller.status().services, ['a-text']); assert.equal(children.length, 2);
  } finally { await controller.stop(); }
});
