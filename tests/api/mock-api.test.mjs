import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import dnsPacket from 'dns-packet';
import { createMockServer, DEMO_TOOL_NAME } from '../../packages/mock-api/index.mjs';
import { initializeLab, migrateAuthDemo, DEMO_AUTH } from '../../packages/lab-controller/initialize.mjs';

const TOKENS = { 'a-text': 'test-token-a-text', 'a-vision': 'test-token-a-vision', 'b-tools': 'test-token-b-tools', 'c-basic': 'test-token-c-basic' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';

// OS-assigned ephemeral ports can be on Fetch's browser-oriented forbidden list.
// Use HTTP directly for the isolated HTTP fixtures while retaining streaming
// Response readers, status/header checks, and cancellation behavior.
function fixtureHttpRequest(url, { method = 'GET', headers, body, signal } = {}) {
  if (new URL(url).protocol !== 'http:') throw new Error('This helper is only for isolated HTTP fixtures.');
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers, signal, agent: false }, response => {
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers: response.headers }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function fixture(t, node = 'A', options = {}) {
  const logs = [];
  const mock = createMockServer({ node, tokens: TOKENS, allowHttp: true, streamDelayMs: 0, logger: (entry) => logs.push(entry), ...options });
  const address = await mock.listen();
  t.after(() => mock.close());
  const origin = `http://127.0.0.1:${address.port}`;
  const request = async (id, suffix, body, override = {}) => {
    const service = mock.services.find((item) => item.id === id);
    const response = await fixtureHttpRequest(`${origin}${service.base === '/' ? '' : service.base}/${suffix}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(service.auth === 'required' ? { authorization: `Bearer ${TOKENS[id]}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...override,
    });
    return response;
  };
  return { mock, origin, request, logs };
}

function parseSse(text) {
  return text.trim().split('\n\n').filter(Boolean).map((frame) => {
    const event = frame.match(/^event: (.+)$/m)?.[1];
    const data = JSON.parse(frame.match(/^data: (.+)$/m)?.[1]);
    assert.equal(event, data.type, 'event field must agree with body.type');
    return data;
  });
}

test('TLS is required for every service and credentials are required only for protected services', () => {
  assert.throws(() => createMockServer({ node: 'A' }), /Bearer token/);
  assert.throws(() => createMockServer({ node: 'A', tokens: TOKENS }), /TLS/);
  assert.throws(() => createMockServer({ node: 'Z', tokens: TOKENS }), /node/);
  assert.throws(() => createMockServer({ node: 'C' }), /TLS/);
  assert.doesNotThrow(() => createMockServer({ node: 'C', allowHttp: true }));
  assert.throws(() => createMockServer({ node: 'C', allowHttp: true, services: [{ id: 'c-basic', auth: 'required' }] }), /Bearer token/);
  for (const auth of ['optional', '', null, false, 0, undefined]) {
    assert.throws(() => createMockServer({ node: 'C', allowHttp: true, services: [{ id: 'c-basic', auth }] }), /auth/);
  }
});

test('mixed API authentication is scoped to each path and denies catalogs, capabilities and inference before authorization', async (t) => {
  const nodes = new Map();
  for (const node of ['A', 'B', 'C']) nodes.set(node, await fixture(t, node));
  for (const [node, id, model] of [['A', 'a-text', 'mock-text'], ['A', 'a-vision', 'mock-vision'], ['B', 'b-tools', 'mock-tools'], ['C', 'c-basic', 'mock-basic']]) {
    const { request, mock, logs } = nodes.get(node);
    const auth = DEMO_AUTH[id];
    assert.equal(mock.services.find(service => service.id === id).auth, auth);
    const observed = [];
    const observe = req => observed.push(Object.hasOwn(req.headers, 'authorization'));
    mock.server.on('request', observe);
    for (const suffix of ['models', '_demo/capabilities', '_llm/capabilities', 'responses']) {
      const body = suffix === 'responses' ? { model, input: 'auth-matrix-fixture' } : undefined;
      for (const [kind, token] of [['missing', undefined], ['wrong', 'deliberately-wrong-demo-key'], ['cross-service', TOKENS[id === 'b-tools' ? 'a-vision' : 'b-tools']], ['correct', TOKENS[id]]]) {
        const response = await request(id, suffix, body, { headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
        const denied = auth === 'required' && kind !== 'correct';
        assert.equal(response.status, denied ? 401 : 200, `${id}/${suffix}: ${kind}`);
        const document = await response.json();
        if (denied) {
          assert.equal(response.headers.get('www-authenticate'), 'Bearer');
          assert.deepEqual(Object.keys(document), ['error']);
          assert.equal(document.error.code, 'invalid_api_key');
          assert.ok(!Object.hasOwn(document, 'models') && !Object.hasOwn(document, 'data') && !Object.hasOwn(document, 'output'));
        }
      }
    }
    mock.server.off('request', observe);
    assert.equal(observed.filter(Boolean).length, 12, 'The missing-key requests must actually omit Authorization.');
    const serialized = JSON.stringify(logs);
    assert.ok(Object.values(TOKENS).every(token => !serialized.includes(token)), 'Request logs must not include fixture API keys.');
    assert.ok(!serialized.includes('deliberately-wrong-demo-key'), 'Request logs must not include rejected keys.');
    const caps = await (await request(id, '_demo/capabilities')).json();
    assert.ok(!JSON.stringify(caps).includes('auth') && !JSON.stringify(caps).includes('token'), 'Authentication is not a model capability.');
  }
});

test('HTTPS accepts the independently trusted certificate and rejects a mismatched server identity', async (t) => {
  const { default: forge } = await import('node-forge');
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 3_600_000);
  certificate.setSubject([{ name: 'commonName', value: 'localhost' }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]);
  certificate.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());
  const cert = forge.pki.certificateToPem(certificate);
  const mock = createMockServer({ node: 'C', tokens: TOKENS, tls: { key: keys.privateKey, cert } });
  const address = await mock.listen();
  t.after(() => mock.close());
  const get = (servername, ca) => new Promise((resolve, reject) => {
    const request = https.get({ hostname: '127.0.0.1', port: address.port, servername, ca, path: '/api/v1/models', headers: { authorization: `Bearer ${TOKENS['c-basic']}` }, agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
  });
  const accepted = await get('localhost', cert);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data[0].id, 'mock-basic');
  await assert.rejects(get('wrong-node.local', cert), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  await assert.rejects(get('localhost', undefined), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
});

test('one node exposes two independent models, capability documents and scoped credentials', async (t) => {
  const { request, origin, mock } = await fixture(t);
  assert.equal(mock.services.length, 2);
  for (const [id, model] of [['a-text', 'mock-text'], ['a-vision', 'mock-vision']]) {
    const list = await (await request(id, 'models')).json();
    assert.deepEqual(list.data.map((entry) => entry.id), [model]);
    const caps = await (await request(id, '_demo/capabilities')).json();
    assert.equal(caps.schema, 'llm-discovery-demo-capabilities/v1');
    assert.equal(caps.mock, true);
    assert.equal(caps.models[0].streaming, 'supported');
    assert.equal(caps.models[0].function_calling, 'unsupported');
    assert.deepEqual(caps.models[0].input_modalities, id === 'a-vision' ? ['text', 'image'] : ['text']);
  }
  const denied = await request('a-vision', 'models', undefined, { headers: { authorization: `Bearer ${TOKENS['a-text']}` } });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'invalid_api_key');
  assert.equal((await fixtureHttpRequest(`${origin}/_admin/disable`)).status, 404);
  const wrongModel = await request('a-text', 'responses', { model: 'mock-vision', input: 'hello' });
  assert.equal(wrongModel.status, 404);
});

test('catalogs expose realistic simulated deployment names while request model IDs remain stable', async (t) => {
  const expected = [
    ['A', 'Studio Workstation', 'a-text', 'mock-text', 'DeepSeek-R1-Distill-Qwen-32B', '32B', 'Q4_K_M', 'R1'],
    ['A', 'Studio Workstation', 'a-vision', 'mock-vision', 'Qwen2.5-VL-7B-Instruct', '7B', 'BF16', '2.5-VL'],
    ['B', 'Lab Server', 'b-tools', 'mock-tools', 'GLM-4-9B-Chat', '9B', 'INT4', '4'],
    ['C', 'Mini PC', 'c-basic', 'mock-basic', 'Qwen3-8B', '8B', 'Q8_0', '3'],
  ];
  const servers = new Map();
  for (const [node, nodeLabel, id, model, displayName, parameters, quantization, version] of expected) {
    if (!servers.has(node)) servers.set(node, await fixture(t, node));
    const { request, mock } = servers.get(node);
    const catalog = await (await request(id, 'models')).json();
    const caps = await (await request(id, '_demo/capabilities')).json();
    assert.equal(catalog.data[0].id, model);
    assert.equal(catalog.data[0].name, displayName);
    assert.equal(caps.models[0].display_name, displayName);
    assert.deepEqual(caps.models[0].deployment, { parameters, quantization, version });
    assert.equal(caps.demo_node_label, nodeLabel);
    assert.equal(caps.service_label, mock.services.find(service => service.id === id).label);
    const instance = `${caps.service_label} 12345678`;
    assert.equal(dnsPacket.name.encode(`${instance}._llm-api._tcp.local`)[0], Buffer.byteLength(instance), 'The service instance must be a single DNS label, including names whose official spelling has a dot.');
    assert.equal(caps.mock, true);
    assert.equal((await request(id, 'responses', { model, input: 'presentation-fixture' })).status, 200);
    assert.equal((await request(id, 'responses', { model: displayName, input: 'presentation-fixture' })).status, 404);
  }
});

test('legacy labels refresh in memory while custom labels, deployment and model identity take priority', async (t) => {
  const legacy = { id: 'a-text', model: 'mock-text', label: 'Node A Text', base: '/text/v1' };
  const saved = structuredClone(legacy);
  const { request, mock } = await fixture(t, 'A', { services: [legacy] });
  assert.equal(mock.services[0].label, 'DeepSeek-R1-Distill-Qwen-32B');
  assert.deepEqual(legacy, saved, 'Normalizing presentation must not mutate existing runtime objects.');
  mock.services[0].deployment.quantization = 'must-not-mutate-server';
  assert.equal((await (await request('a-text', '_demo/capabilities')).json()).models[0].deployment.quantization, 'Q4_K_M');
  const deployment = { parameters: '12B', quantization: 'FP16', version: 'custom-v1' };
  const custom = await fixture(t, 'C', { nodeLabel: 'My Workstation', services: [{ id: 'c-basic', model: 'private-model', label: 'My Service', display_name: 'My Local Model', deployment }] });
  const caps = await (await custom.request('c-basic', '_demo/capabilities')).json();
  assert.equal(caps.demo_node_label, 'My Workstation');
  assert.equal(caps.service_label, 'My Service');
  assert.equal(caps.models[0].id, 'private-model');
  assert.equal(caps.models[0].display_name, 'My Local Model');
  assert.deepEqual(caps.models[0].deployment, deployment);
  const customIdOnly = await fixture(t, 'C', { services: [{ id: 'c-basic', model: 'private-model', label: 'Node C Basic' }] });
  const unnamed = await (await customIdOnly.request('c-basic', '_demo/capabilities')).json();
  assert.equal(unnamed.service_label, 'Node C Basic');
  assert.equal(unnamed.models[0].display_name, 'private-model');
  assert.equal(unnamed.models[0].deployment, undefined, 'A different model must not inherit the default model deployment claims.');
});

test('presentation metadata rejects invalid names and unbounded or incomplete deployment fields', () => {
  for (const patch of [
    { display_name: '' }, { display_name: null }, { display_name: 12 }, { display_name: 'x'.repeat(257) },
    { deployment: null }, { deployment: { parameters: '8B', quantization: 'Q4_K_M' } },
    { deployment: { parameters: 'x'.repeat(65), quantization: 'Q4_K_M', version: '1' } },
    { deployment: { parameters: '8B', quantization: 'Q4_K_M', version: '1', unexpected: 'value' } },
  ]) assert.throws(() => createMockServer({ node: 'C', tokens: TOKENS, allowHttp: true, services: [{ id: 'c-basic', ...patch }] }), /display_name|label|[Dd]eployment/);
});

test('new runtime stores presentation defaults and reused legacy runtime keeps trust and files unchanged', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'llm-discovery-presentation-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('llm-discovery-presentation-'));
    await rm(directory, { recursive: true, force: true });
  });
  const options = { address: '192.0.2.10', interfaceAddress: '192.0.2.11', runtimeDir: directory };
  const created = await initializeLab(options);
  const lab = JSON.parse(await readFile(created.configFile, 'utf8'));
  assert.equal(lab.nodes[0].label, 'Studio Workstation');
  assert.equal(lab.nodes[1].label, options.address, 'The IP example must use the reachable deployment address.');
  assert.equal(lab.nodes[2].label, lab.nodes[2].hostname, 'The .local example must use the advertised TLS hostname.');
  assert.equal(lab.nodes[0].services[1].label, 'Qwen2-5-VL-7B-Instruct');
  assert.equal(lab.nodes[0].services[1].display_name, 'Qwen2.5-VL-7B-Instruct');
  assert.equal(lab.nodes[0].services[1].deployment.quantization, 'BF16');
  const trusted = JSON.parse(await readFile(created.trustFile, 'utf8'));
  assert.deepEqual(trusted.services.map(service => service.baseURL), lab.nodes.flatMap(node => node.services.map(service => `https://${node.hostname}:${node.port}${service.basePath}`)));
  // Recreate a legacy configuration without touching generated trust material.
  delete lab.nodes[0].label;
  lab.nodes[0].services[0].label = 'Node A Text';
  delete lab.nodes[0].services[0].display_name;
  delete lab.nodes[0].services[0].deployment;
  for (const relative of ['lab.json', 'server/lab.json']) await writeFile(path.join(directory, relative), JSON.stringify(lab));
  assert.deepEqual(lab.nodes.flatMap(node => node.services.map(service => service.auth)), ['none', 'required', 'required', 'none']);
  assert.deepEqual(trusted.services.map(service => service.auth), ['none', 'required', 'required', 'none']);
  assert.ok(trusted.services.every(service => !Object.hasOwn(service, 'tokenFile')));
  await assert.rejects(access(path.join(directory, 'client', 'tokens')), { code: 'ENOENT' });
  const keys = JSON.parse(await readFile(path.join(directory, 'server', 'tokens.json'), 'utf8'));
  const keyText = await readFile(created.demoKeysFile, 'utf8');
  assert.ok(keyText.includes('DEMO ONLY') && keyText.includes(keys['a-vision']) && keyText.includes(keys['b-tools']), 'The presenter file contains only the required synthetic keys.');
  assert.ok(!keyText.includes(keys['a-text']) && !keyText.includes(keys['c-basic']), 'Unused keys must not be copied to the presenter file.');
  const files = ['lab.json', 'server/lab.json', 'server/server-key.pem', 'server/server.pem', 'server/tokens.json', 'client/trust.json', 'client/ca.pem', 'presenter/demo-api-keys.txt'];
  const hashFile = async relative => createHash('sha256').update(await readFile(path.join(directory, relative))).digest('hex');
  const before = await Promise.all(files.map(hashFile));
  assert.equal((await initializeLab(options)).reused, true);
  const after = await Promise.all(files.map(hashFile));
  assert.deepEqual(after, before, 'Reusing a runtime must not rewrite labels, certificates, endpoint identity or tokens.');
});

test('explicit auth migration is idempotent and preserves run identity, private material and old token files', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'llm-discovery-auth-migration-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('llm-discovery-auth-migration-'));
    await rm(directory, { recursive: true, force: true });
  });
  await initializeLab({ address: '192.0.2.10', interfaceAddress: '192.0.2.11', runtimeDir: directory });
  const lab = JSON.parse(await readFile(path.join(directory, 'lab.json'), 'utf8'));
  const trust = JSON.parse(await readFile(path.join(directory, 'client/trust.json'), 'utf8'));
  const tokens = JSON.parse(await readFile(path.join(directory, 'server/tokens.json'), 'utf8'));
  await mkdir(path.join(directory, 'client/tokens'));
  for (const node of lab.nodes) for (const service of node.services) {
    delete service.auth;
    const entry = trust.services.find(entry => entry.baseURL === `https://${node.hostname}:${node.port}${service.basePath}`);
    delete entry.auth;
    entry.tokenFile = `tokens/${service.id}.txt`;
    await writeFile(path.join(directory, 'client', entry.tokenFile), tokens[service.id]);
  }
  for (const file of ['lab.json', 'server/lab.json']) await writeFile(path.join(directory, file), JSON.stringify(lab));
  await writeFile(path.join(directory, 'client/trust.json'), JSON.stringify(trust));
  const protectedFiles = ['server/server-key.pem', 'server/server.pem', 'server/ca.pem', 'server/tokens.json', 'client/ca.pem', 'client/marker.txt', ...Object.keys(tokens).map(id => `client/tokens/${id}.txt`)];
  const hashes = async files => Promise.all(files.map(async file => createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex')));
  const before = await hashes(protectedFiles);
  const migrated = await migrateAuthDemo({ runtimeDir: directory });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.credentialsPrinted, false);
  const nextLab = JSON.parse(await readFile(path.join(directory, 'lab.json'), 'utf8'));
  const nextTrust = JSON.parse(await readFile(path.join(directory, 'client/trust.json'), 'utf8'));
  assert.equal(nextLab.runId, lab.runId);
  for (const node of nextLab.nodes) for (const service of node.services) {
    assert.equal(service.auth, DEMO_AUTH[service.id]);
    delete service.auth;
  }
  assert.deepEqual(nextLab, lab, 'Only auth settings change in the lab manifest.');
  for (const [index, entry] of nextTrust.services.entries()) {
    assert.equal(entry.auth, ['none', 'required', 'required', 'none'][index]);
    assert.ok(!Object.hasOwn(entry, 'tokenFile'));
    const original = { ...trust.services[index] }; delete original.tokenFile;
    const current = { ...entry }; delete current.auth;
    assert.deepEqual(current, original, 'Address, CA and certificate policy remain independent of API keys.');
  }
  assert.deepEqual(await hashes(protectedFiles), before, 'No existing credentials or marker may be replaced or removed.');
  const migratedFiles = ['lab.json', 'server/lab.json', 'client/trust.json', 'presenter/demo-api-keys.txt'];
  const first = await hashes(migratedFiles);
  assert.equal((await migrateAuthDemo({ runtimeDir: directory })).changed, false);
  assert.deepEqual(await hashes(migratedFiles), first, 'Repeated migration must be a no-op.');
  // Reject incomplete trust before modifying any file.
  nextTrust.services.pop();
  await writeFile(path.join(directory, 'client/trust.json'), JSON.stringify(nextTrust));
  const rejectedBefore = await hashes(migratedFiles);
  await assert.rejects(migrateAuthDemo({ runtimeDir: directory }), /exact independent trust/);
  assert.deepEqual(await hashes(migratedFiles), rejectedBefore);
});

test('client tools keep an internal HMAC integrity key even when API authentication is disabled', async (t) => {
  const { request } = await fixture(t, 'B', { tokens: {}, services: [{ id: 'b-tools', auth: 'none' }] });
  const tools = [{ type: 'function', name: DEMO_TOOL_NAME, parameters: { type: 'object', properties: {} } }];
  const user = { role: 'user', content: 'Call demo_read_marker.' };
  const initial = await (await request('b-tools', 'responses', { model: 'mock-tools', input: [user], tools })).json();
  const call = initial.output[0];
  assert.equal(call.type, 'function_call');
  const output = { type: 'function_call_output', call_id: call.call_id, output: 'synthetic-tool-result' };
  const accepted = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, call, output], tools });
  assert.equal(accepted.status, 200);
  const forgedId = call.call_id.slice(0, -1) + (call.call_id.endsWith('0') ? '1' : '0');
  const forged = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, { ...call, call_id: forgedId }, { ...output, call_id: forgedId }], tools });
  assert.equal((await forged.json()).error.code, 'invalid_tool_call_id');
});

test('nonstream text response identifies the node and service; logs exclude prompt and token', async (t) => {
  const { request, logs } = await fixture(t);
  const prompt = 'private-prompt-must-not-be-logged';
  const response = await request('a-text', 'responses', { model: 'mock-text', input: prompt, stream: false, store: false });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-llm-demo-mock'), 'true');
  const body = await response.json();
  assert.equal(body.object, 'response');
  assert.equal(body.status, 'completed');
  assert.match(body.output[0].content[0].text, /MOCK Node A \/ Text API/);
  assert.match(body.output[0].content[0].text, /private-prompt/);
  assert.equal(body.metadata.mock, 'true');
  assert.equal(body.usage.total_tokens, body.usage.input_tokens + body.usage.output_tokens);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].service_id, 'a-text');
  assert.ok(!JSON.stringify(logs).includes(prompt));
  assert.ok(!JSON.stringify(logs).includes(TOKENS['a-text']));
});

test('SSE lifecycle has complete ordered events and deltas reconstruct the final output', async (t) => {
  const { request } = await fixture(t);
  const response = await request('a-text', 'responses', { model: 'mock-text', input: 'Please respond.', stream: true });
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const events = parseSse(await response.text());
  assert.deepEqual(events.map((event) => event.sequence_number), events.map((_, index) => index));
  assert.equal(events[0].type, 'response.created');
  assert.equal(events[1].type, 'response.in_progress');
  assert.equal(events[2].type, 'response.output_item.added');
  assert.equal(events[2].item.status, 'in_progress');
  assert.equal(events.at(-1).type, 'response.completed');
  const final = events.at(-1).response;
  const text = events.filter((event) => event.type === 'response.output_text.delta').map((event) => event.delta).join('');
  assert.equal(text, final.output[0].content[0].text);
  assert.ok(events.some((event) => event.type === 'response.output_text.done'));
  assert.ok(events.some((event) => event.type === 'response.content_part.done'));
  assert.equal(events.at(-2).type, 'response.output_item.done');
});

test('text echo selects the latest user message despite trailing system and developer context', async (t) => {
  const { request, logs } = await fixture(t);
  const latest = 'latest-user-prompt-fixture';
  const input = [
    { role: 'user', content: 'earlier-user-prompt-fixture' },
    { role: 'assistant', content: [{ type: 'output_text', text: 'earlier-assistant-fixture' }] },
    { role: 'user', content: [{ type: 'input_text', text: 'latest-user-' }, { type: 'input_text', text: 'prompt-fixture' }] },
    { role: 'system', content: 'system-clock-context-fixture' },
    { role: 'developer', content: [{ type: 'input_text', text: 'developer-clock-context-fixture' }] },
  ];
  for (const stream of [false, true]) {
    const result = await request('a-text', 'responses', { model: 'mock-text', input, stream });
    assert.equal(result.status, 200);
    const response = stream ? parseSse(await result.text()).at(-1).response : await result.json();
    const text = response.output[0].content[0].text;
    assert.ok(text.endsWith(`Received text: ${latest}`));
    assert.ok(!/earlier-|clock-context/.test(text));
  }
  assert.ok(!/user-prompt|clock-context|assistant-fixture/.test(JSON.stringify(logs)));
});

test('explicit demo context indices preserve the latest user text despite trailing clock and skill context', async (t) => {
  const { request, logs } = await fixture(t);
  const context = 'synthetic-context-with-no-clock-prefix';
  const input = [
    { role: 'system', content: 'system-fixture' },
    { role: 'user', content: 'actual-user-fixture' },
    { role: 'user', content: [{ type: 'input_text', text: context }] },
    { role: 'user', content: 'synthetic-skills-catalog-fixture' },
  ];
  const metadata = { demo_context_indices: '[2,3]' };
  for (const stream of [false, true]) {
    const result = await request('a-text', 'responses', { model: 'mock-text', input, metadata, stream });
    assert.equal(result.status, 200);
    const body = stream ? parseSse(await result.text()).at(-1).response : await result.json();
    assert.ok(body.output[0].content[0].text.endsWith('Received text: actual-user-fixture'));
  }
  const ordinary = await request('a-text', 'responses', { model: 'mock-text', input });
  assert.ok((await ordinary.json()).output[0].content[0].text.endsWith('Received text: synthetic-skills-catalog-fixture'));
  assert.ok(!/actual-user-fixture|synthetic-context|synthetic-skills/.test(JSON.stringify(logs)));
});

test('legacy clock metadata remains supported alone, while mixed context metadata fails explicitly', async (t) => {
  const { request } = await fixture(t);
  const input = [{ role: 'user', content: 'user-fixture' }, { role: 'user', content: 'clock-fixture' }];
  const legacy = await request('a-text', 'responses', { model: 'mock-text', input, metadata: { demo_time_context_indices: '[1]' } });
  assert.ok((await legacy.json()).output[0].content[0].text.endsWith('Received text: user-fixture'));
  const mixed = await request('a-text', 'responses', { model: 'mock-text', input, metadata: { demo_context_indices: '[1]', demo_time_context_indices: '[1]' } });
  assert.equal(mixed.status, 400);
  assert.equal((await mixed.json()).error.code, 'invalid_demo_context');
  const malformedLegacy = await request('a-text', 'responses', { model: 'mock-text', input, metadata: { demo_time_context_indices: '[2]' } });
  assert.equal((await malformedLegacy.json()).error.code, 'invalid_demo_context');
});

test('demo context sidecar rejects malformed, oversized, duplicate, out-of-range and non-user-text indices', async (t) => {
  const { request } = await fixture(t);
  const input = [{ role: 'user', content: 'user-fixture' }, { role: 'user', content: [{ type: 'input_text', text: 'context-fixture' }] }];
  const cases = [
    { value: [1] }, { value: '{' }, { value: '{}' }, { value: 'null' },
    { value: '[1,1]' }, { value: '[-1]' }, { value: '[1.5]' }, { value: '[2]' }, { value: '["1"]' },
    { value: ' '.repeat(513) }, { value: JSON.stringify(Array.from({ length: 65 }, (_, index) => index)) },
    { value: '[0]', input: 'string-input' },
    ...[
      { role: 'system', content: 'system-fixture' },
      { role: 'developer', content: 'developer-fixture' },
      { role: 'assistant', content: 'assistant-fixture' },
      { type: 'function_call_output', call_id: 'unknown', output: 'result-fixture' },
      { role: 'user', content: [] },
      { role: 'user', content: [{ type: 'input_text', text: 'text' }, { type: 'input_image', image_url: `data:image/png;base64,${PNG}` }] },
    ].map(item => ({ value: '[1]', input: [input[0], item] })),
  ];
  for (const fixtureCase of cases) {
    const response = await request('a-text', 'responses', { model: 'mock-text', input: fixtureCase.input ?? input, metadata: { demo_context_indices: fixtureCase.value } });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'invalid_demo_context');
    assert.equal(body.error.param, 'metadata.demo_context_indices');
  }
});

test('truncated text produces incomplete status and terminal event', async (t) => {
  const { request } = await fixture(t);
  for (const stream of [false, true]) {
    const result = await request('a-text', 'responses', { model: 'mock-text', input: 'long response', max_output_tokens: 1, stream });
    const response = stream ? parseSse(await result.text()).at(-1).response : await result.json();
    assert.equal(response.status, 'incomplete');
    assert.equal(response.incomplete_details.reason, 'max_output_tokens');
    assert.equal(response.output[0].status, 'incomplete');
  }
});

test('vision receives actual image bytes, computes their digest, and does not fetch remote URLs', async (t) => {
  const { request } = await fixture(t);
  const input = [{ role: 'user', content: [{ type: 'input_text', text: 'Read this image' }, { type: 'input_image', image_url: `data:image/png;base64,${PNG}` }] }];
  const response = await request('a-vision', 'responses', { model: 'mock-vision', input });
  assert.equal(response.status, 200);
  const text = (await response.json()).output[0].content[0].text;
  assert.ok(text.includes(createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex')));
  assert.match(text, /"width":1,"height":1/);
  assert.match(text, /not visual understanding/);
  const rejected = await request('a-text', 'responses', { model: 'mock-text', input });
  assert.equal((await rejected.json()).error.code, 'unsupported_input_modality');
  input[0].content[1].image_url = 'http://127.0.0.1:1/private';
  const remote = await request('a-vision', 'responses', { model: 'mock-vision', input });
  assert.equal((await remote.json()).error.code, 'unsupported_image');
  input[0].content[1].image_url = `data:image/jpeg;base64,${PNG}`;
  const mismatch = await request('a-vision', 'responses', { model: 'mock-vision', input });
  assert.equal((await mismatch.json()).error.code, 'invalid_image');
});

test('tool call streams a fixed name and empty arguments; only matching client result completes the roundtrip', async (t) => {
  const { request, logs } = await fixture(t, 'B');
  const tools = [{ type: 'function', name: DEMO_TOOL_NAME, description: 'Read the client demo marker.', parameters: { type: 'object', properties: {}, additionalProperties: false } }];
  const user = { role: 'user', content: 'Please read the demo marker.' };
  const response = await request('b-tools', 'responses', { model: 'mock-tools', input: [user], tools, stream: true });
  const events = parseSse(await response.text());
  const call = events.at(-1).response.output[0];
  assert.equal(call.type, 'function_call');
  assert.equal(call.name, DEMO_TOOL_NAME);
  assert.equal(call.arguments, '{}');
  assert.ok(events.some((event) => event.type === 'response.function_call_arguments.done'));
  assert.ok(!JSON.stringify(call).includes('CLIENT-ONLY-NONCE'));
  const output = { type: 'function_call_output', call_id: call.call_id, output: '{"nonce":"CLIENT-ONLY-NONCE"}' };
  const final = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, call, output], tools });
  assert.equal(final.status, 200);
  assert.match((await final.json()).output[0].content[0].text, /CLIENT-ONLY-NONCE/);
  const invalid = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, call, { ...output, call_id: 'call_unknown' }], tools });
  assert.equal((await invalid.json()).error.code, 'invalid_tool_call_id');
  const missingCall = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, output], tools });
  assert.equal((await missingCall.json()).error.code, 'invalid_tool_call_id');
  const changedArgs = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, { ...call, arguments: '{"path":"private.txt"}' }, output], tools });
  assert.equal((await changedArgs.json()).error.code, 'invalid_tool_arguments');
  const nextTurn = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, call, output, { role: 'user', content: 'A new question' }], tools });
  assert.ok(!(await nextTurn.json()).output[0].content[0].text.includes('CLIENT-ONLY-NONCE'));
  assert.ok(!JSON.stringify(logs).includes('CLIENT-ONLY-NONCE'));
});

test('clock and skill context do not replace a tool result or bypass call identity and real new-turn checks', async (t) => {
  const { request, logs } = await fixture(t, 'B');
  const tools = [{ type: 'function', name: DEMO_TOOL_NAME, parameters: { type: 'object', properties: {}, additionalProperties: false } }];
  const user = { role: 'user', content: 'Read the demo marker.' };
  const context = { role: 'user', content: 'context-without-tool-trigger-words' };
  const skills = { role: 'user', content: '<system-reminder>skills-catalog-fixture</system-reminder>' };
  const first = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, context, skills], metadata: { demo_context_indices: '[1,2]' }, tools });
  const call = (await first.json()).output[0];
  assert.equal(call.type, 'function_call');
  const output = { type: 'function_call_output', call_id: call.call_id, output: 'CLIENT-RESULT-FIXTURE' };
  const input = [user, call, output, context, skills];
  const metadata = { demo_context_indices: '[3,4]' };
  const final = await request('b-tools', 'responses', { model: 'mock-tools', input, metadata, tools });
  assert.match((await final.json()).output[0].content[0].text, /CLIENT-RESULT-FIXTURE/);
  const forged = await request('b-tools', 'responses', { model: 'mock-tools', input: [user, call, { ...output, call_id: 'call_unknown' }, context, skills], metadata, tools });
  assert.equal((await forged.json()).error.code, 'invalid_tool_call_id');
  const next = await request('b-tools', 'responses', { model: 'mock-tools', input: [...input, { role: 'user', content: 'A new user request' }], metadata, tools });
  const text = (await next.json()).output[0].content[0].text;
  assert.ok(text.endsWith('Received text: A new user request'));
  assert.ok(!text.includes('CLIENT-RESULT-FIXTURE'));
  assert.ok(!JSON.stringify(logs).includes('CLIENT-RESULT-FIXTURE'));
});

test('C nonstream-only scenario declares and enforces its transport capability', async (t) => {
  const { request } = await fixture(t, 'C', { nonstreamOnly: true });
  const caps = await (await request('c-basic', '_demo/capabilities')).json();
  assert.equal(caps.models[0].streaming, 'unsupported');
  assert.equal(caps.models[0].structured_output, 'unsupported');
  const streamed = await request('c-basic', 'responses', { model: 'mock-basic', input: 'hello', stream: true });
  assert.equal(streamed.status, 400);
  assert.equal((await streamed.json()).error.code, 'streaming_not_supported');
  const plain = await request('c-basic', 'responses', { model: 'mock-basic', input: 'hello', stream: false });
  assert.equal((await plain.json()).status, 'completed');
});

test('readiness and disable operations isolate A services and emit lifecycle signals', async (t) => {
  const { request, mock } = await fixture(t);
  const events = [];
  mock.events.on('readiness', (event) => events.push(event));
  mock.setReady('a-text', false);
  assert.equal(mock.getReadiness('a-text'), false);
  assert.equal((await request('a-text', 'models')).status, 503);
  assert.equal((await request('a-vision', 'models')).status, 200);
  mock.setReady('a-text', true);
  mock.setEnabled('a-text', false);
  assert.equal((await request('a-text', 'models')).status, 503);
  mock.setEnabled('a-text', true);
  assert.equal((await request('a-text', 'models')).status, 200);
  assert.deepEqual(events.map((event) => event.ready), [false, true, false, true]);
});

test('root and custom base paths are handled without implicit /v1 prefixes', async (t) => {
  const { request, origin } = await fixture(t, 'C', { services: [{ id: 'c-basic', base: '/', model: 'renamed-model' }] });
  assert.equal((await request('c-basic', 'responses', { model: 'renamed-model', input: 'hello' })).status, 200);
  assert.equal((await fixtureHttpRequest(`${origin}/v1/responses`)).status, 404);
});

test('invalid requests fail explicitly, including unsupported storage, structured output and required tools', async (t) => {
  const { request } = await fixture(t);
  const base = { model: 'mock-text', input: 'hello' };
  for (const [patch, code] of [
    [{ previous_response_id: 'resp_previous' }, 'unsupported_parameter'],
    [{ store: true }, 'unsupported_parameter'],
    [{ text: { format: { type: 'json_schema' } } }, 'unsupported_structured_output'],
    [{ tool_choice: 'required' }, 'unsupported_tool'],
    [{ stream: 'true' }, 'invalid_parameter'],
    [{ max_output_tokens: -1 }, 'invalid_parameter'],
    [{ input: [{ role: 'user', content: [{ type: 'input_audio' }] }] }, 'unsupported_input_modality'],
  ]) {
    const result = await request('a-text', 'responses', { ...base, ...patch });
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error.code, code);
  }
  const malformed = await request('a-text', 'responses', {}, { body: 'not JSON' });
  assert.equal((await malformed.json()).error.code, 'invalid_json');
});

test('request byte limit rejects large inputs before parsing', async (t) => {
  const { request } = await fixture(t, 'A', { maxBodyBytes: 100 });
  const response = await request('a-text', 'responses', { model: 'mock-text', input: 'x'.repeat(200) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'request_too_large');
});

test('client cancellation ends a stream and is recorded without uncaught errors', async (t) => {
  const { request, logs } = await fixture(t, 'A', { streamDelayMs: 5 });
  const response = await request('a-text', 'responses', { model: 'mock-text', input: 'x'.repeat(800), stream: true });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  for (let tries = 0; tries < 20 && logs.length === 0; tries++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].cancelled, true);
});
