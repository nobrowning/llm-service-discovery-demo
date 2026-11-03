import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createMockServer, defaultNodeLabel } from '../mock-api/index.mjs';
import { createAdvertiser } from '@llm-discovery/advertiser';

const serverDirectory = process.env.LAB_SERVER_DIR ?? '/lab';
const lab = JSON.parse(await readFile(path.join(serverDirectory, 'lab.json'), 'utf8'));
const node = lab.nodes.find((value) => value.id === (process.env.MOCK_NODE ?? 'A').toUpperCase());
if (!node) throw new Error('Unknown node');
const log = (event) => console.log(JSON.stringify({ time: new Date().toISOString(), node: node.id, ...event }));
const tokens = JSON.parse(await readFile(path.join(serverDirectory, 'tokens.json'), 'utf8'));
const nodeLabel = [undefined, `Node ${node.id}`, defaultNodeLabel(node.id)].includes(node.label)
  ? defaultNodeLabel(node.id, { address: lab.address, hostname: node.hostname }) : node.label;
const api = createMockServer({
  node: node.id, nodeLabel, host: '0.0.0.0', port: node.port,
  tls: { key: await readFile(path.join(serverDirectory, 'server-key.pem')), cert: await readFile(path.join(serverDirectory, 'server.pem')) },
  tokens, logger: log, nonstreamOnly: process.env.MOCK_NONSTREAM_ONLY === 'true',
  services: node.services.map((service) => ({ id: service.id, base: service.basePath, model: service.model, label: service.label, auth: Object.hasOwn(service, 'auth') ? service.auth : 'required',
    ...(Object.hasOwn(service, 'display_name') ? { display_name: service.display_name } : {}), ...(Object.hasOwn(service, 'deployment') ? { deployment: service.deployment } : {}),
    ...(typeof service.enabled === 'boolean' ? { enabled: service.enabled } : {}), ...(typeof service.ready === 'boolean' ? { ready: service.ready } : {}) })),
});
const advertiser = createAdvertiser({
  services: api.services.map((service) => ({ ...node.services.find(original => original.id === service.id), auth: service.auth, label: service.label, basePath: service.base, enabled: api.getReadiness(service.id), instanceName: `${service.label} ${lab.runId}`, hostname: node.hostname, address: lab.address, port: node.port })),
  interfaceAddress: process.env.MDNS_INTERFACE || (process.platform === 'win32' ? lab.interfaceAddress || lab.address : undefined), logger: log,
});
let stopping = false;
const readinessChanged = ({ serviceId, ready }) => {
  if (!stopping && serviceId) void advertiser.setEnabled(serviceId, ready).catch((error) => log({ type: 'advertisement-error', serviceId, message: error.message }));
};
api.events.on('readiness', readinessChanged);
try { await api.listen(); await advertiser.start(); }
catch (error) { stopping = true; api.events.off('readiness', readinessChanged); await advertiser.stop(); await api.close(); throw error; }
// SIGUSR2 toggles only A's text route; SIGUSR1 is reserved by Node's inspector.
let textEnabled = true;
process.on('SIGUSR2', () => {
  if (node.id !== 'A') return;
  textEnabled = !textEnabled;
  api.setEnabled('a-text', textEnabled);
});
const stop = async () => {
  if (stopping) return;
  stopping = true;
  api.events.off('readiness', readinessChanged);
  await advertiser.stop(); await api.close();
  process.exitCode = 0;
};
const handleStop = () => { void stop().catch((error) => { log({ type: 'shutdown-error', message: error.message }); process.exitCode = 1; }); };
process.on('SIGTERM', handleStop);
process.on('SIGINT', handleStop);
log({ type: 'node-ready', hostname: node.hostname, port: node.port, services: node.services.map((s) => s.id) });
