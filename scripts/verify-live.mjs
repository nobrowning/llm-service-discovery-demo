/** Real container mDNS -> plugin trust/HTTPS/Responses adapter integration check.
 * This process never configures Harness, advertises DNS, or injects candidates.
 * The tool loop below runs in this verifier, not inside the Desktop tool runtime.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createDiscoveryClient } from '@llm-discovery/discovery-core';
import { loadTrust, authorizeCandidate, createPinnedTransport, canonicalBaseURL } from 'dsh-lan-discovery/trust';
import { ResponsesAdapter, buildResponsesRequest } from 'dsh-lan-discovery/responses';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = { runtime: resolve(root, '.runtime/current'), output: resolve(root, 'artifacts/live-verification.json'), timeoutMs: 30000 };
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (['--runtime', '--output', '--timeout-ms'].includes(flag) && args[index + 1]) {
    const value = args[++index];
    if (flag === '--runtime') options.runtime = resolve(value);
    else if (flag === '--output') options.output = resolve(value);
    else options.timeoutMs = Number(value);
  } else throw new Error('Usage: node scripts/verify-live.mjs [--runtime DIR] [--output FILE] [--timeout-ms N]');
}
if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) throw new Error('Discovery timeout must be 1000..120000 ms.');

const started = Date.now();
const report = {
  schema: 'llm-discovery-demo-live-verification/v1',
  startedAt: new Date(started).toISOString(),
  status: 'failed',
  scenario: 'three-services-one-free-two-authenticated',
  execution: { discovery: 'real-mdns-udp', transport: 'plugin-scoped-https-ca-hostname-fingerprint-address-pin', streaming: 'plugin-ResponsesAdapter', toolExecutor: 'standalone-verifier-client', credentials: 'explicit-server-test-keys-required-services-only', desktopSessionExecuted: false },
  discovery: { expected: 3, found: 0, events: {}, services: [] },
  checks: [],
};
const hash = value => createHash('sha256').update(value).digest('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');
const tool = { name: 'demo_read_marker', description: 'Read the fixed client-only experiment marker file.', parameters: { type: 'object', properties: {}, additionalProperties: false } };
const user = text => ({ role: 'user', content: [{ type: 'text', text }] });
const collect = async iterable => { const result = []; for await (const chunk of iterable) result.push(chunk); return result; };
const streamText = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('');
const responseText = response => (response.output ?? []).flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text).join('');
function completed(chunks, reason = 'stop') { assert.equal(chunks.at(-1)?.type, 'finish', 'Missing adapter terminal chunk.'); assert.equal(chunks.at(-1)?.reason?.kind, reason, 'Unexpected adapter finish reason.'); }
function responseOK(response) { assert.equal(response.object, 'response', 'Not a Responses object.'); assert.equal(response.status, 'completed', 'Response did not complete.'); }
// Error messages may contain untrusted server content, assertion values, or local paths.
// Preserve only a bounded machine category, never a stack, response, token, or marker.
function errorCategory(error) {
  if (error?.code === 'ERR_ASSERTION') return 'assertion-failed';
  if (['API_KEY_REQUIRED', 'API_KEY_REJECTED', 'API_KEY_INVALID'].includes(error?.code)) return error.code.toLowerCase().replaceAll('_', '-');
  if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) return `local-file-${error.code}`;
  const status = /Service returned HTTP (\d{3})/.exec(String(error?.message));
  if (status) return `http-${status[1]}`;
  const network = /Service transport failed \(([A-Z0-9_]+)\)/.exec(String(error?.message));
  if (network) return `transport-${network[1]}`;
  return 'validation-or-runtime-error';
}
async function check(service, name, fn) {
  const at = Date.now();
  try { const evidence = await fn(); report.checks.push({ service, name, status: 'passed', durationMs: Date.now() - at, ...(evidence ? { evidence } : {}) }); console.log(`PASS ${service} ${name}`); return true; }
  catch (error) { const category = errorCategory(error); report.checks.push({ service, name, status: 'failed', durationMs: Date.now() - at, category }); console.error(`FAIL ${service} ${name} (${category})`); return false; }
}

let discovery, unsubscribe;
try {
  const lab = JSON.parse(await readFile(resolve(options.runtime, 'lab.json'), 'utf8'));
  assert.equal(lab.schema, 'llm-discovery-demo-lab/v1', 'Unsupported lab manifest.');
  assert.equal(typeof lab.interfaceAddress, 'string', 'Explicit discovery interface required.');
  const trust = await loadTrust(resolve(options.runtime, 'client/trust.json'));
  // This standalone acceptance client is explicitly allowed to read synthetic
  // server fixture keys. The real Harness plugin never reads this file.
  const testKeys = JSON.parse(await readFile(resolve(options.runtime, 'server/tokens.json'), 'utf8'));
  // These URLs are expectations only. Only discovery.snapshot() supplies candidates.
  const expected = lab.nodes.flatMap(node => node.services.map(service => ({ id: service.id, model: service.model, auth: service.auth, baseURL: canonicalBaseURL(`https://${node.hostname}:${node.port}${service.basePath}`) })));
  assert.equal(expected.length, 3, 'The default experiment must define three services.');
  assert.equal(new Set(expected.map(service => service.baseURL)).size, 3, 'Service endpoints must be distinct.');
  assert.deepEqual(Object.fromEntries(expected.map(service => [service.id, service.auth])), { 'a-text': 'none', 'a-vision': 'required', 'b-tools': 'required' }, 'Run the explicit three-state migration before this acceptance test.');
  assert.ok(trust.services.every(service => !service.tokenFile), 'Mixed-auth trust must not prefill client token files.');
  report.runId = lab.runId;
  report.discovery.interfaceAddress = lab.interfaceAddress;
  discovery = createDiscoveryClient({ interfaceAddress: lab.interfaceAddress, networkId: `live-${lab.runId}`, queryIntervalMs: 2000 });
  unsubscribe = discovery.subscribe(event => { if (['added', 'updated', 'removed', 'invalid', 'warning', 'error'].includes(event.type)) report.discovery.events[event.type] = (report.discovery.events[event.type] ?? 0) + 1; });
  const found = new Map();
  const discoveryPassed = await check('network', 'discover-three-services', async () => {
    await discovery.start();
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = discovery.snapshot();
      found.clear();
      for (const service of expected) {
        const candidates = snapshot.filter(candidate => candidate.baseURL === service.baseURL && candidate.expiresAt > Date.now());
        if (candidates.length === 1) found.set(service.id, candidates[0]);
      }
      if (found.size === expected.length) break;
      await delay(250);
    }
    report.discovery.found = found.size;
    report.discovery.services = expected.filter(service => found.has(service.id)).map(service => {
      const candidate = found.get(service.id);
      return { id: service.id, baseURL: candidate.baseURL, addresses: candidate.addresses, apiProfile: candidate.apiProfile, protocolVersion: candidate.protocolVersion, auth: candidate.auth, valid: candidate.validation?.valid === true, recordGeneration: candidate.recordGeneration };
    });
    assert.equal(found.size, expected.length, 'Three unique live mDNS services were not discovered before the deadline.');
    return { count: found.size, source: 'discovery.snapshot' };
  });
  if (discoveryPassed) for (const expectedService of expected) {
    const candidate = found.get(expectedService.id);
    let transport, adapter, selected;
    try {
      const binding = authorizeCandidate(candidate, trust);
      await check(expectedService.id, 'advertised-auth-matches-independent-policy', async () => {
        assert.equal(candidate.auth, expectedService.auth, 'Network auth hint does not match this Demo service.');
        assert.equal(binding.auth, expectedService.auth, 'Independent local policy does not match this Demo service.');
        return { auth: expectedService.auth, source: 'network-hint-and-independent-local-policy' };
      });
      const operations = [
        ['models', undefined], ['_demo/capabilities', undefined], ['_llm/capabilities', undefined],
        ['responses', { method: 'POST', body: { model: expectedService.model, input: 'auth-acceptance-fixture', stream: false } }],
      ];
      if (expectedService.auth === 'none') {
        await check(expectedService.id, 'no-api-key-needed', async () => {
          const probe = createPinnedTransport(binding, { timeoutMs: 10000 });
          try { for (const [operation, request] of operations) await probe.json(operation, request); }
          finally { probe.close(); }
          return { operations: operations.map(([operation]) => operation), credentialsSupplied: false };
        });
      } else {
        assert.ok(typeof testKeys[expectedService.id] === 'string' && testKeys[expectedService.id].length > 0, 'Required server fixture key missing.');
        for (const kind of ['missing', 'wrong', 'cross-service']) await check(expectedService.id, `${kind}-api-key-rejected`, async () => {
          const apiKey = kind === 'missing' ? undefined : kind === 'wrong' ? 'deliberately-wrong-demo-key' : testKeys[expectedService.id === 'a-vision' ? 'b-tools' : 'a-vision'];
          // Server rejection test only: override the client's local preflight for
          // this missing-key probe. TLS, endpoint, hostname and address pins stay
          // unchanged. Normal Harness flow blocks missing keys before networking.
          const probe = createPinnedTransport(kind === 'missing' ? { ...binding, auth: 'none' } : binding, { timeoutMs: 10000, ...(apiKey ? { apiKey } : {}) });
          const expectedCode = kind === 'missing' ? 'API_KEY_REQUIRED' : 'API_KEY_REJECTED';
          try { for (const [operation, request] of operations) await assert.rejects(probe.json(operation, request), { code: expectedCode }); }
          finally { probe.close(); }
          // The transport intentionally maps HTTP 401 and 403 to these sanitized
          // codes. Raw HTTP 401 is asserted separately by the server API tests.
          return { operations: operations.map(([operation]) => operation), authErrorCode: expectedCode, evidenceType: 'auth-errorcode', scope: 'server-route-authorization' };
        });
      }
      const metadataOK = await check(expectedService.id, 'trusted-https-models-and-capabilities', async () => {
        transport = createPinnedTransport(binding, { timeoutMs: 10000, ...(expectedService.auth === 'required' ? { apiKey: testKeys[expectedService.id] } : {}) });
        const catalog = await transport.json('models');
        const capabilities = await transport.json('_demo/capabilities');
        assert.equal(capabilities.schema, 'llm-discovery-demo-capabilities/v1', 'Unknown capabilities schema.');
        assert.equal(capabilities.mock, true, 'This verification expects explicit Mock services.');
        const models = capabilities.models.filter(model => catalog.data.some(row => row.id === model.id));
        assert.equal(models.length, 1, 'Expected one independently listed model.');
        selected = models[0];
        assert.equal(selected.id, expectedService.model, 'Unexpected model advertised by API metadata.');
        adapter = new ResponsesAdapter({ binding, transport, models, readImage: async () => ({ mediaType: 'image/png', data: PNG }) });
        return { model: selected.id, auth: expectedService.auth, credentialsSupplied: expectedService.auth === 'required', inputModalities: selected.input_modalities, streaming: selected.streaming, functionCalling: selected.function_calling, leafSha256: binding.certificateSha256 };
      });
      if (!metadataOK) continue;
      const base = { provider: adapter.binding.provider, model: selected.id };
      const prompt = `live-check-${randomUUID()}`;
      const messages = [user(prompt)];
      await check(expectedService.id, 'text-stream', async () => {
        assert.equal(selected.streaming, 'supported', 'Default service must declare streaming.');
        const chunks = await collect(adapter.stream({ ...base, messages })); completed(chunks);
        assert.ok(streamText(chunks).includes(prompt), 'Text stream did not contain the transmitted text.');
        return { chunkCount: chunks.length, outputSha256: hash(streamText(chunks)) };
      });
      await check(expectedService.id, 'text-nonstream', async () => {
        const body = await buildResponsesRequest({ ...base, messages });
        const response = await transport.json('responses', { method: 'POST', body: { ...body, stream: false } }); responseOK(response);
        assert.ok(responseText(response).includes(prompt), 'Nonstream response did not contain the transmitted text.');
        return { status: response.status, outputSha256: hash(responseText(response)) };
      });
      if (expectedService.id === 'a-vision') for (const streaming of [true, false]) await check(expectedService.id, streaming ? 'image-stream' : 'image-nonstream', async () => {
        assert.ok(selected.input_modalities.includes('image'), 'Vision API metadata did not declare image support.');
        const call = { ...base, messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'live-fixture-png' } }] }] };
        let output;
        if (streaming) { const chunks = await collect(adapter.stream(call)); completed(chunks); output = streamText(chunks); }
        else { const body = await buildResponsesRequest(call, { imageSupported: true, readImage: adapter.readImage }); const response = await transport.json('responses', { method: 'POST', body: { ...body, stream: false } }); responseOK(response); output = responseText(response); }
        assert.ok(output.includes(hash(PNG)), 'Service did not confirm the exact input image bytes.');
        return { imageBytes: PNG.length, imageSha256: hash(PNG), validates: 'image-transport-only' };
      });
      if (expectedService.id === 'b-tools') for (const streaming of [true, false]) await check(expectedService.id, streaming ? 'client-tool-stream-loop' : 'client-tool-nonstream-loop', async () => {
        assert.equal(selected.function_calling, 'supported', 'Tools API metadata did not declare function calling.');
        const initial = { ...base, messages: [user('Please call demo_read_marker.')], tools: [tool] };
        let call;
        if (streaming) {
          const chunks = await collect(adapter.stream(initial)); completed(chunks, 'tool-calls');
          const calls = chunks.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call');
          assert.equal(calls.length, 1, 'Expected exactly one function call.'); call = calls[0].block;
        } else {
          const body = await buildResponsesRequest(initial, { functionCalling: true });
          const response = await transport.json('responses', { method: 'POST', body: { ...body, stream: false } }); responseOK(response);
          const calls = response.output.filter(item => item.type === 'function_call'); assert.equal(calls.length, 1, 'Expected exactly one function call.');
          call = { type: 'tool-call', id: calls[0].call_id, name: calls[0].name, arguments: calls[0].arguments };
        }
        assert.equal(call.name, 'demo_read_marker', 'Unexpected tool requested.');
        assert.deepEqual(JSON.parse(call.arguments), {}, 'Tool arguments must be empty.');
        assert.equal(typeof call.id, 'string', 'Missing function call correlation ID.');
        // Read the client-only nonce only after validating the server function call.
        const marker = await readFile(trust.markerFile, 'utf8');
        assert.ok(marker.length > 0 && Buffer.byteLength(marker) <= 4096, 'Invalid marker size.');
        const followup = { ...initial, messages: [...initial.messages, { role: 'assistant', content: [call] }, { role: 'tool', toolCallId: call.id, content: [{ type: 'text', text: marker }] }] };
        let output;
        if (streaming) { const chunks = await collect(adapter.stream(followup)); completed(chunks); output = streamText(chunks); }
        else { const body = await buildResponsesRequest(followup, { functionCalling: true }); const response = await transport.json('responses', { method: 'POST', body: { ...body, stream: false } }); responseOK(response); output = responseText(response); }
        assert.ok(output.includes(marker) && output.includes(call.id), 'Tool result did not preserve the client nonce and call correlation.');
        return { tool: call.name, clientReadAfterFunctionCall: true, correlated: true, markerSha256: hash(marker), executor: 'standalone-verifier-client' };
      });
    } finally { transport?.close(); }
  }
  if (report.checks.length && report.checks.every(item => item.status === 'passed')) report.status = 'passed';
} catch (error) {
  report.checks.push({ service: 'verifier', name: 'setup-or-runtime', status: 'failed', category: errorCategory(error) });
  console.error(`FAIL verifier setup-or-runtime (${errorCategory(error)})`);
} finally {
  // Our own socket shutdown is cleanup, not a service lifecycle observation.
  unsubscribe?.();
  await discovery?.stop();
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - started;
  await mkdir(dirname(options.output), { recursive: true });
  const temporary = `${options.output}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
  await rename(temporary, options.output);
  console.log(`${report.status.toUpperCase()}: ${report.checks.filter(item => item.status === 'passed').length}/${report.checks.length} checks; sanitized report: ${options.output}`);
  if (report.status !== 'passed') process.exitCode = 1;
}
