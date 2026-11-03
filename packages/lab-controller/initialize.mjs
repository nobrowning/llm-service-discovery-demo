import forge from 'node-forge';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, access, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { defaultServicesForNode, defaultNodeLabel } from '../mock-api/index.mjs';

export const DEMO_AUTH = Object.freeze({ 'a-text': 'none', 'a-vision': 'required', 'b-tools': 'required', 'c-basic': 'none' });
const demoKeysPath = directory => path.join(directory, 'presenter', 'demo-api-keys.txt');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function demoKeysText(config, tokens) {
  const lines = [
    'DEMO ONLY - SYNTHETIC API KEYS FOR LOCAL MOCK SERVICES',
    'These are not credentials for DeepSeek, Qwen, GLM, or any real provider.',
    'Keep this runtime file local. Do not include it in logs, screenshots, or published evidence.',
    'Manually copy the matching API Key into the Harness service dialog.',
    'The discovery plugin does not load this file or server/tokens.json.',
    `Experiment: ${config.runId}`, '',
  ];
  for (const node of config.nodes) for (const service of node.services) {
    lines.push(`${service.id} - ${service.display_name ?? service.label}`, `Endpoint: https://${node.hostname}:${node.port}${service.basePath}`);
    if (service.auth === 'required') {
      if (typeof tokens[service.id] !== 'string' || !/^[\x21-\x7e]+$/.test(tokens[service.id])) throw new Error('A required service has no valid server-side Demo key. No credentials were generated or replaced.');
      lines.push(`API Key: ${tokens[service.id]}`);
    } else lines.push('No API Key needed.');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function replaceIfChanged(file, content, mode) {
  let current;
  try { current = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current === content) return false;
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, content, mode ? { mode } : undefined);
  await rename(temporary, file);
  return true;
}

/** Explicit offline migration only; never called by initialization or startup. */
export async function migrateAuthDemo({ runtimeDir = '.runtime/current' } = {}) {
  const directory = path.resolve(runtimeDir);
  const configFile = path.join(directory, 'lab.json');
  const serverConfigFile = path.join(directory, 'server', 'lab.json');
  const trustFile = path.join(directory, 'client', 'trust.json');
  const [config, serverConfig, trust, tokens] = await Promise.all([configFile, serverConfigFile, trustFile, path.join(directory, 'server', 'tokens.json')].map(async file => JSON.parse(await readFile(file, 'utf8'))));
  if (config.schema !== 'llm-discovery-demo-lab/v1' || !Array.isArray(config.nodes) || JSON.stringify(config) !== JSON.stringify(serverConfig)) throw new Error('Migration requires matching client/server lab manifests. Preserve this runtime and resolve the mismatch first.');
  if (trust.schema !== 'llm-discovery-demo-trust/v1' || !Array.isArray(trust.services)) throw new Error('Migration requires an existing Demo trust document.');
  const services = config.nodes.flatMap(node => node.services.map(service => ({ node, service })));
  if (services.length !== 4 || new Set(services.map(({ service }) => service.id)).size !== 4 || services.some(({ service }) => !Object.hasOwn(DEMO_AUTH, service.id))) throw new Error('Migration supports the four named Demo services only.');
  const endpoints = services.map(({ node, service }) => `https://${node.hostname}:${node.port}${service.basePath}`);
  if (new Set(endpoints).size !== 4 || trust.services.length !== 4 || endpoints.some(endpoint => trust.services.filter(entry => entry.baseURL === endpoint).length !== 1)) throw new Error('Migration requires an exact independent trust entry for each Demo endpoint.');
  for (const { node, service } of services) {
    service.auth = DEMO_AUTH[service.id];
    const entry = trust.services.find(entry => entry.baseURL === `https://${node.hostname}:${node.port}${service.basePath}`);
    entry.auth = service.auth;
    delete entry.tokenFile;
  }
  // Prepare and validate every document before writing. Existing key material,
  // old client token files, TLS trust, marker, and run identity are untouched.
  const demoKeysFile = demoKeysPath(directory);
  const keyText = demoKeysText(config, tokens);
  const files = [[configFile, json(config)], [serverConfigFile, json(config)], [trustFile, json(trust)], [demoKeysFile, keyText, 0o600]];
  let changed = false;
  for (const [file, content, mode] of files) changed = await replaceIfChanged(file, content, mode) || changed;
  return { configFile, trustFile, demoKeysFile, changed, services: services.map(({ service }) => ({ id: service.id, auth: service.auth })), credentialsPrinted: false };
}

function certificate(keys, subject, issuer, issuerKey, extensions) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${randomBytes(15).toString('hex')}`;
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86400000);
  cert.setSubject(subject);
  cert.setIssuer(issuer);
  cert.setExtensions(extensions);
  cert.sign(issuerKey, forge.md.sha256.create());
  return cert;
}

export async function initializeLab({ address, interfaceAddress, runtimeDir = '.runtime/current' }) {
  if (isIP(address) !== 4 || /^(127\.|0\.|22[4-9]\.|23\d\.)/.test(address)) throw new Error('Use an explicit non-loopback IPv4 address reachable from Windows');
  if (interfaceAddress && isIP(interfaceAddress) !== 4) throw new Error('Invalid Windows discovery interface address');
  const directory = path.resolve(runtimeDir);
  const configFile = path.join(directory, 'lab.json');
  try {
    await access(configFile);
    const existing = JSON.parse(await readFile(configFile, 'utf8'));
    if (existing.address !== address || existing.interfaceAddress !== (interfaceAddress ?? null)) throw new Error('Existing runtime uses different addresses. Choose a new --runtime directory; do not replace active routes.');
    const authMigrationRequired = existing.nodes?.some(node => node.services?.some(service => service.auth !== DEMO_AUTH[service.id])) ?? true;
    return { configFile, trustFile: path.join(directory, 'client', 'trust.json'), reused: true, authMigrationRequired };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.join(directory, 'server'), { recursive: true });
  await mkdir(path.join(directory, 'client'), { recursive: true });
  const runId = randomBytes(4).toString('hex');
  const nodes = [['A', 18443], ['B', 28443], ['C', 38443]].map(([id, port]) => {
    const hostname = `llm-${runId}-${id.toLowerCase()}.local`;
    return {
      id, port, label: defaultNodeLabel(id, { address, hostname }), hostname,
      services: defaultServicesForNode(id).map(service => ({ id: service.id, auth: service.auth, label: service.label, basePath: service.base, model: service.model, display_name: service.display_name, deployment: service.deployment })),
    };
  });
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const serverKeys = forge.pki.rsa.generateKeyPair(2048);
  const issuer = [{ name: 'commonName', value: `LLM Discovery Demo ${runId}` }];
  const ca = certificate(caKeys, issuer, issuer, caKeys.privateKey, [
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  ]);
  const leaf = certificate(serverKeys, [{ name: 'commonName', value: nodes[0].hostname }], issuer, caKeys.privateKey, [
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: nodes.map((node) => ({ type: 2, value: node.hostname })) },
  ]);
  const fingerprint = createHash('sha256').update(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes(), 'binary')).digest('hex');
  const caPem = forge.pki.certificateToPem(ca);
  const tokens = {};
  const trusted = [];
  for (const node of nodes) for (const service of node.services) {
    const token = randomBytes(32).toString('hex');
    tokens[service.id] = token;
    trusted.push({ baseURL: `https://${node.hostname}:${node.port}${service.basePath}`, allowedAddresses: [address], certificateSha256: fingerprint, auth: service.auth });
  }
  await writeFile(path.join(directory, 'server', 'server.pem'), forge.pki.certificateToPem(leaf));
  await writeFile(path.join(directory, 'server', 'server-key.pem'), forge.pki.privateKeyToPem(serverKeys.privateKey), { mode: 0o600 });
  await writeFile(path.join(directory, 'server', 'ca.pem'), caPem);
  await writeFile(path.join(directory, 'server', 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 });
  await writeFile(path.join(directory, 'client', 'ca.pem'), caPem);
  await writeFile(path.join(directory, 'client', 'marker.txt'), `demo-marker-${randomBytes(24).toString('hex')}`, { mode: 0o600 });
  await writeFile(path.join(directory, 'client', 'trust.json'), JSON.stringify({ schema: 'llm-discovery-demo-trust/v1', caFile: 'ca.pem', markerFile: 'marker.txt', services: trusted }, null, 2));
  const config = { schema: 'llm-discovery-demo-lab/v1', runId, address, interfaceAddress: interfaceAddress ?? null, nodes };
  await writeFile(configFile, JSON.stringify(config, null, 2));
  // Server-only mount never includes the client marker or client plugin state.
  await writeFile(path.join(directory, 'server', 'lab.json'), JSON.stringify(config, null, 2));
  const demoKeysFile = demoKeysPath(directory);
  await replaceIfChanged(demoKeysFile, demoKeysText(config, tokens), 0o600);
  return { configFile, trustFile: path.join(directory, 'client', 'trust.json'), demoKeysFile, reused: false, authMigrationRequired: false };
}
