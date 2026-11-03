import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { initializeLab } from './initialize.mjs';
import { createNativeControl } from './native-control.mjs';

export function localIPv4(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, rows]) => (rows ?? []).filter(row =>
    !row.internal && (row.family === 'IPv4' || row.family === 4) && !/^(0\.|127\.|169\.254\.|22[4-9]\.|23\d\.)/.test(row.address)
  ).map(row => ({ name, address: row.address })));
}

export function selectNativeNetwork({ interfaceAddress, address } = {}, interfaces = os.networkInterfaces()) {
  const candidates = localIPv4(interfaces);
  const addresses = [...new Set(candidates.map(row => row.address))];
  if (!addresses.length) throw new Error('No usable non-loopback IPv4 interface was found. Connect to a local network first.');
  if (!interfaceAddress) {
    if (addresses.length !== 1) throw new Error('More than one local IPv4 interface is available. Run lab doctor, then specify --interface <local IPv4>.');
    interfaceAddress = addresses[0];
  }
  if (!addresses.includes(interfaceAddress)) throw new Error('--interface must be an IPv4 address assigned to this computer. Run lab doctor to list interfaces.');
  address ??= interfaceAddress;
  if (!addresses.includes(address)) throw new Error('--address must be an IPv4 address assigned to this computer; it is the advertised HTTPS address.');
  return { interfaceAddress, address };
}

function ownChild(nodeId, options, { forkNode, startupTimeoutMs, onUnexpectedExit }) {
  const child = forkNode(fileURLToPath(new URL('./node-runner.mjs', import.meta.url)), [], {
    env: { ...process.env, LAB_SERVER_DIR: path.join(options.runtimeDir, 'server'), MOCK_NODE: nodeId,
      MDNS_INTERFACE: options.interfaceAddress, LLM_DEMO_PARENT_INSTANCE: options.instanceId },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  const pending = new Map();
  let ready = false, exited = false, stopExpected = false, resolveReady, rejectReady, resolveExit;
  const exit = new Promise(resolve => { resolveExit = resolve; });
  const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error(`Node ${nodeId} did not announce readiness before the startup timeout.`)), startupTimeoutMs);
  const rejectPending = () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Node ${nodeId} is no longer available.`)); } pending.clear(); };
  child.on('message', message => {
    if (message?.protocol !== 'llm-demo-node/v1' || message.instanceId !== options.instanceId || message.node !== nodeId) return;
    if (message.type === 'ready') { ready = true; clearTimeout(timer); resolveReady(); }
    else if (message.type === 'startup-error') {
      const code = /^[A-Z0-9_]{1,40}$/.test(message.code ?? '') ? message.code : 'STARTUP_FAILED';
      clearTimeout(timer); rejectReady(new Error(`Node ${nodeId} failed to start (${code}). Check the selected interface and whether its HTTPS port is already in use.`));
    } else if (message.type === 'reply' && pending.has(message.requestId)) {
      const item = pending.get(message.requestId); pending.delete(message.requestId); clearTimeout(item.timer);
      if (message.ok === true) item.resolve(message.result); else item.reject(new Error(`Node ${nodeId} rejected the control action.`));
    }
  });
  child.once('error', () => { clearTimeout(timer); rejectReady(new Error(`Could not start Node ${nodeId}.`)); rejectPending(); });
  const childExited = () => {
    if (exited) return;
    exited = true; clearTimeout(timer); rejectReady(new Error(`Node ${nodeId} exited before readiness.`)); rejectPending(); resolveExit();
    if (!stopExpected) onUnexpectedExit(nodeId);
  };
  child.once('exit', childExited);
  child.once('close', childExited);
  function command(action) {
    if (exited || !child.connected) return Promise.reject(new Error(`Node ${nodeId} has no active parent control channel.`));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`Node ${nodeId} control action timed out.`)); }, 10000);
      pending.set(requestId, { resolve, reject, timer: timeout });
      child.send({ protocol: 'llm-demo-node/v1', instanceId: options.instanceId, requestId, action }, error => {
        if (error && pending.has(requestId)) { pending.delete(requestId); clearTimeout(timeout); reject(new Error(`Node ${nodeId} control channel failed.`)); }
      });
    });
  }
  return {
    id: nodeId, ready: readyPromise, status: () => ({ id: nodeId, ready: ready && !exited }), command,
    async stop() {
      stopExpected = true;
      if (exited) return;
      await command('stop').catch(() => {});
      let timeout;
      await Promise.race([exit, new Promise(resolve => { timeout = setTimeout(resolve, 3000); })]);
      clearTimeout(timeout);
      if (!exited) {
        // Only this ChildProcess, created above, can be terminated. No PID from
        // a file or caller is ever used; normal shutdown uses its private IPC.
        child.kill('SIGKILL');
        await exit;
      }
    },
  };
}

export async function startNativeLab({ runtimeDir = '.runtime/current', interfaceAddress, address } = {}, {
  forkNode = fork, networkInterfaces = os.networkInterfaces(), startupTimeoutMs = 30000, handleSignals = true,
} = {}) {
  const network = selectNativeNetwork({ interfaceAddress, address }, networkInterfaces);
  const initialized = await initializeLab({ ...network, runtimeDir });
  if (initialized.authMigrationRequired || initialized.topologyMigrationRequired) throw new Error('This runtime requires an explicit Demo migration before native startup.');
  runtimeDir = await realpath(path.resolve(runtimeDir));
  const lab = JSON.parse(await readFile(path.join(runtimeDir, 'lab.json'), 'utf8'));
  if (lab.nodes.map(node => node.id).sort().join(',') !== 'A,B' || lab.nodes.flatMap(node => node.services.map(service => service.id)).sort().join(',') !== 'a-text,a-vision,b-tools') {
    throw new Error('Native mode requires the standard two-node, three-service Demo runtime.');
  }
  const instanceId = randomUUID();
  const children = [];
  let state = 'starting', control, stopping, failure, resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const status = () => ({ backend: 'native', state, instanceId, runId: lab.runId, runtimeDir, ...network,
    trustFile: path.join(runtimeDir, 'client/trust.json'), nodes: children.map(child => child.status()), services: lab.nodes.flatMap(node => node.services.map(service => service.id)) });
  async function stop() {
    stopping ??= (async () => {
      state = 'stopping';
      await Promise.allSettled(children.map(child => child.stop()));
      await control?.close();
      state = 'stopped';
      if (handleSignals) { process.off('SIGINT', signalStop); process.off('SIGTERM', signalStop); }
      resolveClosed({ error: failure });
    })();
    return stopping;
  }
  const signalStop = () => { void stop(); };
  const failed = error => { failure ??= error; void stop(); };
  try {
    control = await createNativeControl({ runtimeDir, runId: lab.runId, instanceId, status, stop,
      toggleText: async () => {
        if (state !== 'running') throw new Error('Native nodes are not ready.');
        return children.find(child => child.id === 'A').command('toggle-text');
      }, onError: failed });
    if (handleSignals) { process.on('SIGINT', signalStop); process.on('SIGTERM', signalStop); }
    for (const id of ['A', 'B']) {
      if (stopping) break;
      const child = ownChild(id, { runtimeDir, instanceId, ...network }, { forkNode, startupTimeoutMs,
        onUnexpectedExit: nodeId => failed(new Error(`Node ${nodeId} exited unexpectedly; both native nodes were stopped.`)) });
      children.push(child);
      await child.ready;
    }
    if (!stopping) state = 'running';
  } catch (error) {
    const wasStopping = !!stopping;
    if (!wasStopping) failure = error;
    await stop();
    if (!wasStopping || failure) throw failure ?? error;
  }
  return { status, stop, closed };
}
