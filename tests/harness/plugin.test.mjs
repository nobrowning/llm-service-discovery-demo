import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateKeyPairSync, X509Certificate, createHash } from 'node:crypto';
import forge from 'node-forge';
import { createMockServer } from '../../packages/mock-api/index.mjs';
import { loadTrust, authorizeCandidate, createPinnedTransport } from 'dsh-lan-discovery/trust';
import { ResponsesAdapter, buildResponsesRequest, parseSSE, responsesToHarness, requestShapeDiagnostics } from 'dsh-lan-discovery/responses';
import { DiscoveryController, harnessDefaults } from 'dsh-lan-discovery/controller';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');
const TOKENS = { 'a-text': 'fixture-text', 'a-vision': 'fixture-image', 'b-tools': 'fixture-tools', 'c-basic': 'fixture-basic' };
const clockContext = () => ({ role: 'user', source: { kind: 'time-context', form: 'snapshot' }, content: [{ type: 'text', text: 'Time sampled while preparing a deterministic test step.' }] });
const skillContext = () => ({ role: 'user', source: { kind: 'skill-catalog', form: 'catalog', entries: [] }, content: [{ type: 'text', text: '<system-reminder>Fixture skill catalog.</system-reminder>' }] });
const instructionsContext = () => ({ role: 'user', source: { kind: 'agent-instructions', form: 'instructions', changes: [] }, content: [{ type: 'text', text: 'Fixture workspace instructions.' }] });
const runtimeContext = () => ({ role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections: [] }, content: [{ type: 'text', text: 'Current runtime context. Fixture snapshot.' }] });
const hostContexts = () => [clockContext(), instructionsContext(), skillContext(), runtimeContext()];

async function fixture(t, node = 'A', options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-lan-plugin-test-'));
  t.after(async () => { const target = resolve(dir); assert.ok(target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/')); assert.ok(target.includes('dsh-lan-plugin-test-')); await rm(target, { recursive: true, force: true }); });
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const certificate = forge.pki.createCertificate(); certificate.publicKey = forge.pki.publicKeyFromPem(keys.publicKey); certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date(Date.now() - 60000); certificate.validity.notAfter = new Date(Date.now() + 3600000);
  certificate.setSubject([{ name: 'commonName', value: 'fixture.local' }]); certificate.setIssuer(certificate.subject.attributes);
  certificate.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'fixture.local' }] }]);
  certificate.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());
  const cert = forge.pki.certificateToPem(certificate); const certHash = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  const mock = createMockServer({ node, tokens: TOKENS, streamDelayMs: 0, tls: { key: keys.privateKey, cert }, ...options });
  const address = await mock.listen(); t.after(() => mock.close());
  await writeFile(join(dir, 'ca.pem'), cert); await writeFile(join(dir, 'marker.txt'), `client-only-marker-${Date.now()}`);
  const services = [];
  for (const service of mock.services) { await writeFile(join(dir, `${service.id}.token`), TOKENS[service.id]); services.push({ baseURL: `https://fixture.local:${address.port}${service.base}`, allowedAddresses: ['127.0.0.1'], certificateSha256: certHash, auth: service.auth, ...(service.auth === 'none' ? {} : { tokenFile: `${service.id}.token` }) }); }
  const trustFile = join(dir, 'trust.json'); await writeFile(trustFile, JSON.stringify({ schema: 'llm-discovery-demo-trust/v1', caFile: 'ca.pem', markerFile: 'marker.txt', services }));
  const trust = await loadTrust(trustFile);
  const candidates = mock.services.map((service, index) => ({ id: service.id, instanceName: service.label, baseURL: services[index].baseURL, auth: service.auth, apiProfile: 'openresponses', protocolVersion: '2026-04-24', validation: { valid: true, errors: [] }, profileSupported: true, addresses: ['127.0.0.1'], networkId: 'fixture', expiresAt: Date.now() + 60000 }));
  return { dir, mock, trustFile, trust, candidates };
}

async function adapterFor(f, id, t) {
  const binding = authorizeCandidate(f.candidates.find(candidate => candidate.id === id), f.trust);
  const transport = createPinnedTransport(binding); t.after(() => transport.close());
  const caps = await transport.json('_demo/capabilities');
  return new ResponsesAdapter({ binding, transport, models: caps.models, mock: caps.mock === true, demoMode: true, readImage: async () => ({ mediaType: 'image/png', data: PNG }) });
}
const collect = async iterable => { const out = []; for await (const value of iterable) out.push(value); return out; };
const textOf = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('');

test('TLS pin, hostname and discovered address are enforced before credential use', async t => {
  const f = await fixture(t); const candidate = f.candidates[0];
  const binding = authorizeCandidate(candidate, f.trust);
  const good = createPinnedTransport(binding); t.after(() => good.close());
  assert.equal((await good.json('models')).data[0].id, 'mock-text');
  assert.throws(() => authorizeCandidate({ ...candidate, addresses: ['192.0.2.66'] }, f.trust), /address/);
  assert.throws(() => authorizeCandidate({ ...candidate, baseURL: candidate.baseURL + '/other' }, f.trust), /authorized/);
  const wrong = createPinnedTransport({ ...binding, certificateSha256: '0'.repeat(64) }); t.after(() => wrong.close());
  await assert.rejects(wrong.json('models'), /transport failed/);
  const wrongName = createPinnedTransport({ ...binding, baseURL: binding.baseURL.replace('fixture.local', 'wrong.local') }); t.after(() => wrongName.close());
  await assert.rejects(wrongName.json('models'), /transport failed/);
});

test('actual HTTPS text and image SSE responses map to Harness chunks', async t => {
  const f = await fixture(t); const text = await adapterFor(f, 'a-text', t); const vision = await adapterFor(f, 'a-vision', t);
  const listed = (await text.listModels(text.binding.provider))[0];
  assert.equal(listed.id, 'mock-text'); assert.equal(listed.name, 'DeepSeek-R1-Distill-Qwen-32B · Q4_K_M · Mock');
  assert.match(listed.description, /32B.*R1.*Simulated deployment/);
  assert.equal((await text.resolveModel(text.binding.provider, 'mock-text')).name, listed.name);
  assert.equal((await buildResponsesRequest({ model: listed.id, messages: [] })).model, 'mock-text', 'Display metadata never changes the wire model identifier.');
  assert.equal((await vision.listModels(vision.binding.provider))[0].name, 'Qwen2.5-VL-7B-Instruct · BF16 · Mock');
  const chunks = await collect(text.stream({ provider: text.binding.provider, model: 'mock-text', messages: [{ role: 'user', content: [{ type: 'text', text: 'adapter hello' }] }, ...hostContexts()] }));
  assert.match(textOf(chunks), /adapter hello/); assert.equal(chunks.at(-1).reason.kind, 'stop');
  assert.doesNotMatch(textOf(chunks), /Time sampled|Fixture skill catalog|Fixture workspace instructions|Current runtime context/);
  const images = await collect(vision.stream({ provider: vision.binding.provider, model: 'mock-vision', messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'fixture-image' } }] }] }));
  assert.ok(textOf(images).includes(createHash('sha256').update(PNG).digest('hex')));
  await assert.rejects(collect(text.stream({ provider: text.binding.provider, model: 'mock-text', messages: [{ role: 'user', content: [{ type: 'image', attachment: {} }] }] })), /cannot send/);
});

test('function call executes client-only marker read and returns exact correlated tool output', async t => {
  const f = await fixture(t, 'B'); const adapter = await adapterFor(f, 'b-tools', t);
  const diagnostics = []; adapter.onRequestDiagnostics = diagnostic => diagnostics.push(diagnostic);
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Please call demo_read_marker.' }] }, ...hostContexts()];
  const tools = [{ name: 'demo_read_marker', description: 'Read client marker', parameters: { type: 'object', properties: {}, additionalProperties: false } }];
  const options = { provider: adapter.binding.provider, model: 'mock-tools', messages, tools };
  const first = await collect(adapter.stream(options));
  assert.equal(first.at(-1).reason.kind, 'tool-calls');
  const call = first.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call').block;
  assert.equal(call.name, 'demo_read_marker'); assert.deepEqual(JSON.parse(call.arguments), {});
  const marker = await readFile(join(f.dir, 'marker.txt'), 'utf8');
  const second = await collect(adapter.stream({ ...options, messages: [...messages, { role: 'assistant', content: [call] }, { role: 'tool', toolCallId: call.id, content: [{ type: 'text', text: marker }] }, ...hostContexts()] }));
  assert.ok(textOf(second).includes(marker)); assert.equal(second.at(-1).reason.kind, 'stop');
  assert.equal(diagnostics.length, 2); assert.deepEqual(diagnostics.at(-1).tools, ['demo_read_marker']);
  assert.deepEqual(diagnostics.at(-1).messages.at(-1), { role: 'user', source: { kind: 'runtime-context', form: 'snapshot' } });
  assert.ok(!JSON.stringify(diagnostics).includes(marker));
  await assert.rejects(collect(adapter.stream({ ...options, messages: [...messages, { role: 'assistant', content: [call] }, { role: 'tool', toolCallId: 'wrong-call', content: [{ type: 'text', text: marker }] }] })), /HTTP 400/);
});

test('explicit kind/form Host producers use metadata while roles, text and unknown producers are preserved', async () => {
  const clock = clockContext();
  const messages = [...hostContexts(), { ...runtimeContext(), source: { kind: 'runtime-context' } }, ...[undefined, { kind: 'user' }, { kind: 'other-plugin', form: 'catalog' }, { kind: 'skill-catalog', form: 'instructions' }, { kind: 'time-context' }, { kind: 'agent-instructions', form: 'catalog' }, { kind: 'runtime-context', form: 'notice' }, { kind: 'goal' }, { kind: 'schedule' }, { kind: 'user-question-reply' }, { kind: 'skill-invocation', form: 'instructions' }].map(source => ({ role: 'user', source, content: clock.content }))];
  const production = await buildResponsesRequest({ model: 'fixture', system: 'Fixture system message.', messages });
  assert.equal(production.metadata, undefined, 'Reusable adapter never adds demo context without explicit opt-in.');
  const body = await buildResponsesRequest({ model: 'fixture', system: 'Fixture system message.', messages }, { demoMode: true });
  assert.deepEqual(body.input.map(item => item.role), ['system', ...messages.map(message => message.role)]);
  assert.deepEqual(body.input.slice(1).map(item => item.content[0].text), messages.map(message => message.content[0].text));
  assert.deepEqual(body.metadata, { demo_context_indices: '[1,2,3,4,5]' }, 'Indices refer to the final wire input and only exact producer kind/form pairs, including the verified runtime clear branch.');
  const ordinary = await buildResponsesRequest({ model: 'fixture', messages: [{ role: 'user', content: clock.content }] });
  assert.equal(ordinary.metadata, undefined, 'Text alone cannot attribute a clock producer.');
  const multimodal = await buildResponsesRequest({ model: 'fixture', messages: [{ ...skillContext(), content: [...skillContext().content, { type: 'image', attachment: {} }] }] }, { imageSupported: true, readImage: async () => ({ mediaType: 'image/png', data: PNG }) });
  assert.equal(multimodal.metadata, undefined, 'The sidecar cannot hide multimodal inputs from turn selection.');
  await assert.rejects(buildResponsesRequest({ model: 'fixture', messages: Array.from({ length: 65 }, clockContext) }, { demoMode: true }), /metadata exceeds/);
  assert.equal(clock.role, 'user', 'The original immutable Harness history must not be altered.');
});

test('request diagnostics contain only bounded producer labels, roles and actual wire tool names', () => {
  const sensitive = 'PRIVATE_PROMPT_OR_TOKEN';
  const diagnostic = requestShapeDiagnostics({ model: sensitive, system: sensitive, messages: [{ role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections: [{ text: sensitive }], path: 'C:/private/file' }, content: [{ type: 'text', text: sensitive }] }, { role: 'tool', toolCallId: sensitive, source: { kind: 'C:/private/file', form: sensitive + '\n' }, content: [{ type: 'text', text: sensitive }] }] }, { tools: [{ name: 'demo_read_marker', parameters: { secret: sensitive }, description: sensitive }] });
  assert.deepEqual(diagnostic, { messages: [{ role: 'user', source: { kind: 'runtime-context', form: 'snapshot' } }, { role: 'tool', source: { kind: null, form: null } }], messagesTruncated: false, tools: ['demo_read_marker'] });
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE|private|parameters|description|content|sections|toolCallId/);
  assert.equal(requestShapeDiagnostics({ messages: Array.from({ length: 129 }, clockContext) }, {}).messages.length, 128);
  assert.equal(requestShapeDiagnostics({ messages: Array.from({ length: 129 }, clockContext) }, {}).messagesTruncated, true);
});

test('nonstream-only capability is diagnosed before inference', async t => {
  const f = await fixture(t, 'C', { nonstreamOnly: true }); const adapter = await adapterFor(f, 'c-basic', t);
  await assert.rejects(collect(adapter.stream({ provider: adapter.binding.provider, model: 'mock-basic', messages: [] })), /requires a declared streaming/);
});

test('SSE fragmented UTF-8/CRLF and missing terminal are handled honestly', async () => {
  const wire = Buffer.from('data: {"type":"response.output_text.delta","output_index":0,"delta":"中"}\r\n\r\ndata: {"type":"response.output_text.done","output_index":0,"text":"中"}\r\n\r\ndata: {"type":"response.completed","response":{"usage":{}}}\r\n\r\n');
  const source = async function* () { for (const byte of wire) yield Buffer.from([byte]); };
  assert.equal(textOf(await collect(responsesToHarness(parseSSE(source())))), '中');
  await assert.rejects(collect(responsesToHarness((async function* () { yield { type: 'response.created' }; })())), /without a Responses terminal/);
});

test('Harness default CAS preserves unrelated settings and detects a user edit', async () => {
  const value = { provider: 'original', model: 'original-model' }; let revision = 1;
  const settings = { describe() { return [{ ns: 'agent-default-model', revision, value: { ...value } }]; }, async mutate(_ns, ops, expected) { assert.equal(expected, revision); for (const op of ops) op.op === 'set' ? value[op.path[0]] = op.value : delete value[op.path[0]]; revision++; } };
  const defaults = harnessDefaults(settings); const before = defaults.read();
  revision++; value.model = 'user-new';
  await assert.rejects(defaults.compareAndSet(before, { provider: 'lan-test', model: 'mock' }), /concurrently/);
  assert.equal(value.model, 'user-new');
});

test('provider connection is immutable and disconnect preserves a later user default', async t => {
  const f = await fixture(t); let current = { value: { provider: 'user', model: 'first' }, revision: 1 }; const active = new Map();
  const controller = new DiscoveryController({ discovery: { subscribe() { return () => {}; }, snapshot() { return f.candidates; }, async start() {}, async stop() {} }, config: { trustFile: f.trustFile, autoStart: false },
    llm: { registerAdapter(names, adapter) { active.set(names[0], adapter); return () => active.delete(names[0]); } },
    defaults: { read() { return structuredClone(current); }, async compareAndSet(expected, next) { assert.deepEqual(expected, current); current = { value: { ...next }, revision: current.revision + 1 }; return structuredClone(current); } }
  }); t.after(() => controller.close()); await controller.initialize();
  const a = await controller.connect('a-text'); const b = await controller.connect('a-vision');
  assert.equal(a.model, 'mock-text'); assert.equal(a.modelName, 'DeepSeek-R1-Distill-Qwen-32B · Q4_K_M · Mock');
  assert.equal((await active.get(a.provider).listModels(a.provider))[0].name, a.modelName);
  assert.deepEqual(controller.snapshot().candidates.find(candidate => candidate.id === 'a-text').details.models[0].deployment, { parameters: '32B', quantization: 'Q4_K_M', version: 'R1' });
  assert.notEqual(a.provider, b.provider); assert.equal(active.size, 2);
  assert.deepEqual(controller.state.baseline, { provider: 'user', model: 'first' });
  current = { value: { provider: 'user-edited', model: 'preserve-me' }, revision: current.revision + 1 };
  const result = await controller.disconnect(); assert.equal(result.restored, false); assert.equal(current.value.model, 'preserve-me'); assert.equal(active.size, 0);
});

test('interactive keys verify real HTTPS metadata, connect SSE and clear without persistence', async t => {
  const f = await fixture(t);
  const document = JSON.parse(await readFile(f.trustFile, 'utf8'));
  for (const service of document.services) delete service.tokenFile;
  await writeFile(f.trustFile, JSON.stringify(document));
  let current = { value: { provider: 'original', model: 'default' }, revision: 1 };
  const active = new Map();
  const controller = new DiscoveryController({
    discovery: { subscribe() { return () => {}; }, snapshot: () => f.candidates, async start() {}, async stop() {} },
    config: { trustFile: f.trustFile, autoStart: false, demoMode: true },
    llm: { registerAdapter(names, adapter) { active.set(names[0], adapter); return () => active.delete(names[0]); } },
    defaults: { read: () => structuredClone(current), async compareAndSet(expected, next) { assert.deepEqual(expected, current); current = { value: next, revision: current.revision + 1 }; return structuredClone(current); } },
  });
  t.after(() => controller.close()); await controller.initialize();
  await controller.connect('a-text'); await controller.disconnect();
  await assert.rejects(controller.connect('a-vision'), { code: 'API_KEY_REQUIRED' });
  await assert.rejects(controller.setCredential('a-vision', 'synthetic-invalid'), { code: 'API_KEY_REJECTED' });
  await controller.setCredential('a-vision', TOKENS['a-vision']);
  const result = await controller.connect('a-vision');
  const chunks = await collect(active.get(result.provider).stream({ provider: result.provider, model: result.model, messages: [{ role: 'user', content: [{ type: 'text', text: 'interactive-key-accepted' }] }] }));
  assert.match(textOf(chunks), /interactive-key-accepted/);
  assert.ok(!JSON.stringify(controller.snapshot()).includes(TOKENS['a-vision']));
  assert.ok(!(await readFile(join(f.dir, 'plugin-state.json'), 'utf8')).includes(TOKENS['a-vision']));
  await controller.forgetCredential('a-vision');
  assert.equal(active.size, 0); assert.equal(current.value.provider, 'original');
  await assert.rejects(controller.connect('a-vision'), { code: 'API_KEY_REQUIRED' });
});

test('keyless HTTPS transport omits credentials even if supplied by its caller', async t => {
  const f = await fixture(t);
  let observed = false;
  f.mock.server.prependListener('request', req => { observed = true; assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined); });
  const binding = authorizeCandidate(f.candidates.find(candidate => candidate.id === 'a-text'), f.trust);
  const transport = createPinnedTransport(binding, { apiKey: 'synthetic-secret', attribution: { Authorization: 'Bearer synthetic-injected', Cookie: 'synthetic-cookie' } });
  t.after(() => transport.close());
  assert.equal((await transport.json('models')).data[0].id, 'mock-text');
  assert.equal(observed, true, 'A real HTTPS request reached the service without credentials.');
});
