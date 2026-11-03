import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { selectNativeNetwork, localIPv4, startNativeLab } from '../../packages/lab-controller/native.mjs';
import { createNativeControl, requestNative, nativeStatus, nativeStop } from '../../packages/lab-controller/native-control.mjs';
import { initializeLab } from '../../packages/lab-controller/initialize.mjs';

const network = { ethernet: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }], loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] };
const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = async () => realpath(await mkdtemp(path.join(tmpdir(), 'llm-native-test-')));
const remove = directory => rm(directory, { recursive: true, force: true });

test('native network selection is explicit for multiple interfaces and rejects nonlocal addresses', () => {
  assert.deepEqual(localIPv4(network), [{ name: 'ethernet', address: '192.0.2.10' }]);
  assert.deepEqual(selectNativeNetwork({}, network), { address: '192.0.2.10', interfaceAddress: '192.0.2.10' });
  const multi = { ...network, wifi: [{ family: 4, internal: false, address: '192.0.2.20' }] };
  assert.throws(() => selectNativeNetwork({}, multi), /More than one/);
  assert.equal(selectNativeNetwork({ interfaceAddress: '192.0.2.20' }, multi).address, '192.0.2.20');
  assert.throws(() => selectNativeNetwork({ interfaceAddress: '127.0.0.1' }, network), /assigned to this computer/);
  assert.throws(() => selectNativeNetwork({ address: '198.51.100.2' }, network), /--address/);
  assert.throws(() => selectNativeNetwork({}, {}), /No usable/);
});

test('initialization refuses partial nonempty runtime instead of overwriting existing files', async () => {
  const directory = await temp();
  try {
    await writeFile(path.join(directory, 'keep.txt'), 'preserve me');
    await assert.rejects(initializeLab({ runtimeDir: directory, address: '192.0.2.10' }), /nonempty/);
    assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'preserve me');
    await assert.rejects(access(path.join(directory, 'server')), { code: 'ENOENT' });
  } finally { await remove(directory); }
});

async function httpControl(record, { action = 'status', authorization = `Bearer ${record.token}`, method = 'GET', origin, host, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: record.port, path: `/native/${record.instanceId}/${action}`, method,
      headers: { authorization, ...(origin ? { origin } : {}), ...(host ? { host } : {}), ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), connection: 'close' },
    }, response => { let value = ''; response.on('data', chunk => { value += chunk; }); response.on('end', () => resolve({ code: response.statusCode, body: value })); });
    request.on('error', reject); request.end(body);
  });
}

test('native control authenticates runtime, rejects browser/incorrect requests, and never returns its token', async () => {
  const directory = await temp();
  let control, toggles = 0, stops = 0;
  try {
    await writeFile(path.join(directory, 'lab.json'), JSON.stringify({ runId: 'fixture' }));
    control = await createNativeControl({ runtimeDir: directory, runId: 'fixture', status: () => ({ state: 'running' }), stop: () => { stops++; }, toggleText: () => ({ enabled: ++toggles % 2 === 0 }) });
    const file = path.join(directory, 'native-control.json');
    const original = await readFile(file, 'utf8');
    const record = JSON.parse(original);
    assert.deepEqual(await requestNative(directory), { state: 'running' });
    assert.ok(!(await httpControl(record)).body.includes(record.token));
    for (const options of [{ authorization: 'Bearer wrong' }, { origin: 'https://example.test' }, { host: 'example.test' }, { method: 'POST' }, { action: 'stop', method: 'GET' }, { action: 'toggle-text', method: 'POST', body: '{}' }]) {
      const response = await httpControl(record, options);
      assert.equal(response.code, 403); assert.ok(!response.body.includes(record.token));
    }
    assert.equal(toggles, 0); assert.equal(stops, 0);
    await assert.rejects(requestNative(directory, 'stop', { expectedInstanceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }), /instance changed/);
    assert.equal(stops, 0);
    await requestNative(directory, 'toggle-text'); assert.equal(toggles, 1);
    await assert.rejects(createNativeControl({ runtimeDir: directory, runId: 'fixture', status: () => ({}), stop() {}, toggleText() {} }), /already exists/);
    await writeFile(file, JSON.stringify({ ...record, host: '192.0.2.50' }));
    await assert.rejects(requestNative(directory, 'stop'), /identity/);
    await writeFile(file, JSON.stringify({ ...record, runId: 'other-runtime' }));
    await assert.rejects(requestNative(directory, 'stop'), /identity/);
    await writeFile(file, original);
    assert.equal(stops, 0);
  } finally { await control?.close(); await remove(directory); }
});

function fakeFork(children, { failNode, exitNode } = {}) {
  return (_module, _args, options) => {
    const child = new EventEmitter();
    child.connected = true; child.commands = []; child.kills = 0; child.id = options.env.MOCK_NODE;
    const identity = { protocol: 'llm-demo-node/v1', instanceId: options.env.LLM_DEMO_PARENT_INSTANCE, node: child.id };
    const exit = () => { if (!child.connected) return; child.connected = false; child.emit('exit', 0); };
    child.send = (message, callback) => {
      child.commands.push(message.action); callback?.();
      setImmediate(() => {
        child.emit('message', { ...identity, type: 'reply', requestId: message.requestId, ok: true, result: message.action === 'stop' ? { stopped: true } : { service: 'a-text', enabled: false } });
        if (message.action === 'stop') exit();
      });
    };
    child.kill = () => { child.kills++; exit(); return true; };
    child.unexpectedExit = exit;
    children.push(child);
    setImmediate(() => {
      if (child.id === failNode) child.emit('message', { ...identity, type: 'startup-error', code: 'EADDRINUSE' });
      else if (child.id === exitNode) exit();
      else child.emit('message', { ...identity, type: 'ready' });
    });
    return child;
  };
}

test('native supervisor waits for both children, routes control to A, stops only its own children and preserves credentials', async () => {
  const directory = await temp();
  const children = [];
  let controller;
  try {
    controller = await startNativeLab({ runtimeDir: directory }, { forkNode: fakeFork(children), networkInterfaces: network, handleSignals: false });
    const credentials = await readFile(path.join(directory, 'server/tokens.json'));
    const status = await nativeStatus(directory);
    assert.equal(status.state, 'running'); assert.deepEqual(status.nodes, [{ id: 'A', ready: true }, { id: 'B', ready: true }]);
    const record = JSON.parse(await readFile(path.join(directory, 'native-control.json'), 'utf8'));
    assert.ok(!JSON.stringify(status).includes(record.token));
    await requestNative(directory, 'toggle-text');
    assert.deepEqual(children[0].commands, ['toggle-text']); assert.deepEqual(children[1].commands, []);
    assert.equal((await nativeStop(directory)).state, 'stopped');
    assert.equal((await controller.closed).error, undefined);
    assert.deepEqual(children.map(child => child.commands.at(-1)), ['stop', 'stop']);
    assert.equal(children.reduce((sum, child) => sum + child.kills, 0), 0);
    assert.deepEqual(await readFile(path.join(directory, 'server/tokens.json')), credentials);
    assert.equal((await nativeStatus(directory)).state, 'stopped');
    assert.equal((await nativeStop(directory)).state, 'stopped');
  } finally { await controller?.stop(); await remove(directory); }
});

test('second-node startup failure closes the first node and removes only control state', async () => {
  const directory = await temp();
  const children = [];
  try {
    await assert.rejects(startNativeLab({ runtimeDir: directory }, { forkNode: fakeFork(children, { failNode: 'B' }), networkInterfaces: network, handleSignals: false }), /EADDRINUSE/);
    assert.deepEqual(children.map(child => child.commands.at(-1)), ['stop', 'stop']);
    assert.ok(children.every(child => !child.connected && child.kills === 0));
    await assert.rejects(access(path.join(directory, 'native-control.json')), { code: 'ENOENT' });
    await access(path.join(directory, 'server/server-key.pem'));
  } finally { await remove(directory); }
});

test('unexpected owned-child exit closes its sibling and reports failure', async () => {
  const directory = await temp(), children = [];
  let controller;
  try {
    controller = await startNativeLab({ runtimeDir: directory }, { forkNode: fakeFork(children), networkInterfaces: network, handleSignals: false });
    children[0].unexpectedExit();
    assert.match((await controller.closed).error.message, /exited unexpectedly/);
    assert.equal(children[1].commands.at(-1), 'stop');
    assert.ok(!children[1].connected);
  } finally { await controller?.stop(); await remove(directory); }
});

test('CLI help/version/doctor exit normally without starting native services', async () => {
  const exec = promisify(execFile);
  const cli = path.join(root, 'packages/lab-controller/cli.mjs');
  assert.match((await exec(process.execPath, [cli, '--help'])).stdout, /native run\|start/);
  assert.match((await exec(process.execPath, [cli, 'native', 'run', '--help'])).stdout, /foreground/);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal((await exec(process.execPath, [cli, '--version'])).stdout.trim(), pkg.version);
  assert.equal(JSON.parse((await exec(process.execPath, [cli, 'doctor'])).stdout).platform, process.platform);
  assert.ok(Array.isArray(JSON.parse((await exec(process.execPath, [cli, 'list-interfaces'])).stdout)));
  await assert.rejects(exec(process.execPath, [cli, 'native', 'run', '--pid', '123']), /Invalid or repeated option/);
});

test('actual managed node reports initialization failure and exits without binding an API or multicast socket', async () => {
  const directory = await temp();
  const instanceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const child = fork(path.join(root, 'packages/lab-controller/node-runner.mjs'), [], {
    env: { ...process.env, LAB_SERVER_DIR: directory, MOCK_NODE: 'A', LLM_DEMO_PARENT_INSTANCE: instanceId }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  const messages = [];
  child.on('message', message => messages.push(message));
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Managed node failed to exit.')); }, 5000);
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
      child.once('error', reject);
    });
    assert.equal(exitCode, 1);
    assert.ok(messages.some(message => message.type === 'startup-error' && message.code === 'ENOENT' && message.instanceId === instanceId));
    assert.ok(!messages.some(message => message.type === 'ready'));
  } finally { if (child.connected) child.kill('SIGKILL'); await remove(directory); }
});
