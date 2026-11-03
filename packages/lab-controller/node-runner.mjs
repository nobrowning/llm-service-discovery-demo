import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createMockServer, defaultNodeLabel } from '../mock-api/index.mjs';
import { createAdvertiser } from '@llm-discovery/advertiser';

const serverDirectory = process.env.LAB_SERVER_DIR ?? '/lab';
const nodeId = (process.env.MOCK_NODE ?? 'A').toUpperCase();
const instanceId = process.env.LLM_DEMO_PARENT_INSTANCE;
const managed = typeof process.send === 'function' && /^[a-f0-9-]{36}$/.test(instanceId ?? '');
const log = event => console.log(JSON.stringify({ time: new Date().toISOString(), node: nodeId, ...event }));
const send = message => new Promise(resolve => {
  if (!managed || !process.connected) return resolve();
  process.send({ protocol: 'llm-demo-node/v1', instanceId, node: nodeId, ...message }, () => resolve());
});
let api, advertiser, node, stopping = false, stopPromise, textEnabled = true, advertisementWork = Promise.resolve();
let bootstrap;
const readinessChanged = ({ serviceId, ready }) => {
  if (!stopping && serviceId) advertisementWork = advertisementWork.then(() => advertiser.setEnabled(serviceId, ready));
  // Keep event-driven failures handled. Explicit control waits on this same
  // promise and reports failure, rather than claiming a withdrawal succeeded.
  advertisementWork.catch(() => log({ type: 'advertisement-error', serviceId }));
};
async function toggleText() {
  await bootstrap;
  if (stopping || nodeId !== 'A') throw new Error('Text readiness control is unavailable.');
  textEnabled = !textEnabled;
  api.setEnabled('a-text', textEnabled);
  await advertisementWork;
  return { service: 'a-text', enabled: textEnabled };
}
async function stop() {
  stopPromise ??= (async () => {
    stopping = true;
    await bootstrap?.catch(() => {});
    api?.events.off('readiness', readinessChanged);
    await advertisementWork.catch(() => {});
    try { await advertiser?.stop(); } finally { await api?.close(); }
  })();
  return stopPromise;
}
const handleStop = () => { void stop().catch(() => { process.exitCode = 1; }).finally(() => { if (managed && process.connected) process.disconnect(); }); };
process.on('SIGTERM', handleStop);
process.on('SIGINT', handleStop);
if (process.platform !== 'win32') process.on('SIGUSR2', () => { if (nodeId === 'A') void toggleText().catch(() => log({ type: 'readiness-control-error' })); });
if (managed) {
  process.on('disconnect', handleStop);
  let commands = Promise.resolve();
  process.on('message', message => {
    if (message?.protocol !== 'llm-demo-node/v1' || message.instanceId !== instanceId || !/^[a-f0-9-]{36}$/.test(message.requestId ?? '') ||
        !['stop', 'toggle-text'].includes(message.action)) return;
    commands = commands.then(async () => {
      try {
        const result = message.action === 'stop' ? (await stop(), { stopped: true }) : await toggleText();
        await send({ type: 'reply', requestId: message.requestId, ok: true, result });
      } catch { await send({ type: 'reply', requestId: message.requestId, ok: false }); }
      if (message.action === 'stop' && process.connected) process.disconnect();
    });
  });
}
bootstrap = (async () => {
  const lab = JSON.parse(await readFile(path.join(serverDirectory, 'lab.json'), 'utf8'));
  node = lab.nodes.find(value => value.id === nodeId);
  if (!node) throw new Error('Unknown node');
  const tokens = JSON.parse(await readFile(path.join(serverDirectory, 'tokens.json'), 'utf8'));
  const nodeLabel = [undefined, `Node ${node.id}`, defaultNodeLabel(node.id)].includes(node.label)
    ? defaultNodeLabel(node.id, { address: lab.address, hostname: node.hostname }) : node.label;
  api = createMockServer({
    node: node.id, nodeLabel, host: '0.0.0.0', port: node.port,
    tls: { key: await readFile(path.join(serverDirectory, 'server-key.pem')), cert: await readFile(path.join(serverDirectory, 'server.pem')) },
    tokens, logger: log, nonstreamOnly: process.env.MOCK_NONSTREAM_ONLY === 'true',
    services: node.services.map(service => ({ id: service.id, base: service.basePath, model: service.model, label: service.label, auth: Object.hasOwn(service, 'auth') ? service.auth : 'required',
      ...(Object.hasOwn(service, 'display_name') ? { display_name: service.display_name } : {}), ...(Object.hasOwn(service, 'deployment') ? { deployment: service.deployment } : {}),
      ...(typeof service.enabled === 'boolean' ? { enabled: service.enabled } : {}), ...(typeof service.ready === 'boolean' ? { ready: service.ready } : {}) })),
  });
  advertiser = createAdvertiser({
    services: api.services.map(service => ({ ...node.services.find(original => original.id === service.id), auth: service.auth, label: service.label, basePath: service.base, enabled: api.getReadiness(service.id), instanceName: `${service.label} ${lab.runId}`, hostname: node.hostname, address: lab.address, port: node.port })),
    interfaceAddress: process.env.MDNS_INTERFACE || (process.platform === 'win32' ? lab.interfaceAddress || lab.address : undefined), logger: log,
  });
  api.events.on('readiness', readinessChanged);
  await api.listen();
  if (!stopping) await advertiser.start();
  if (!stopping) {
    log({ type: 'node-ready', hostname: node.hostname, port: node.port, services: node.services.map(service => service.id) });
    await send({ type: 'ready' });
  }
})();
try { await bootstrap; }
catch (error) {
  const code = /^[A-Z0-9_]{1,40}$/.test(error.code ?? '') ? error.code : 'STARTUP_FAILED';
  await send({ type: 'startup-error', code });
  log({ type: 'startup-error', code });
  process.exitCode = 1;
  handleStop();
}
