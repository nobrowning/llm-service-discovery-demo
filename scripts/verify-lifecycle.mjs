/** Real mDNS lifecycle acceptance: 3 -> 2 -> 3.
 * WSL signals its verified container; native mode uses authenticated local IPC.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createDiscoveryClient } from '@llm-discovery/discovery-core';
import { loadTrust, authorizeCandidate, createPinnedTransport, canonicalBaseURL } from 'dsh-lan-discovery/trust';
import { requestNative } from '../packages/lab-controller/native-control.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = { runtime: resolve(root, '.runtime/current'), output: resolve(root, 'artifacts/lifecycle-verification.json'), distro: 'Ubuntu', backend: 'wsl', timeoutMs: 30000 };
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/verify-lifecycle.mjs [--backend wsl|native] [--runtime DIR] [--output FILE] [--distro Ubuntu] [--timeout-ms N]');
  process.exit(0);
}
for (let index = 0; index < args.length; index++) {
  const flag = args[index], value = args[++index];
  if (!value) throw new Error('An option value is required.');
  if (flag === '--runtime') options.runtime = resolve(value);
  else if (flag === '--output') options.output = resolve(value);
  else if (flag === '--distro') options.distro = value;
  else if (flag === '--backend') options.backend = value;
  else if (flag === '--timeout-ms') options.timeoutMs = Number(value);
  else throw new Error('Usage: node scripts/verify-lifecycle.mjs [--backend wsl|native] [--runtime DIR] [--output FILE] [--distro Ubuntu] [--timeout-ms N]');
}
if (!['wsl', 'native'].includes(options.backend)) throw new Error('--backend must be wsl or native.');
if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) throw new Error('Timeout must be 1000..120000 ms.');
const started = Date.now();
const report = { schema: 'llm-discovery-demo-lifecycle-verification/v1', startedAt: new Date(started).toISOString(), status: 'failed', execution: { backend: options.backend, discovery: 'real-mdns-udp', mutation: options.backend === 'native' ? 'authenticated-native-node-a-IPC-only' : 'container-node-a-SIGUSR2-only', hostAdvertiser: options.backend === 'native', desktopSessionExecuted: false }, sequence: [], snapshots: [], events: [], checks: [] };
const execFileAsync = promisify(execFile);
let helper, containerId, nativeInstanceId, expected = [], discovery, unsubscribe, textTransport, visionTransport, signalMayHaveBeenSent = false;
const category = error => error?.code === 'ERR_ASSERTION' ? 'assertion-failed' : /HTTP (\d{3})/.exec(error?.message ?? '')?.[1] ? `http-${/HTTP (\d{3})/.exec(error.message)[1]}` : 'runtime-or-network-error';
const wsl = async (...args) => (await execFileAsync('wsl.exe', ['-d', options.distro, '-u', 'root', '--exec', ...args], { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 })).stdout.trim();
const docker = (...args) => wsl('sh', helper, 'docker', ...args);
async function toggleText() {
  if (options.backend === 'native') { await requestNative(options.runtime, 'toggle-text', { expectedInstanceId: nativeInstanceId }); return; }
  // No shell string interpolation, no default daemon, and no process-wide signal.
  await docker('kill', '--signal', 'SIGUSR2', containerId);
}
async function check(name, fn) {
  const at = Date.now();
  try { const evidence = await fn(); report.checks.push({ name, status: 'passed', durationMs: Date.now() - at, ...(evidence ? { evidence } : {}) }); console.log(`PASS ${name}`); return evidence; }
  catch (error) { report.checks.push({ name, status: 'failed', durationMs: Date.now() - at, category: category(error) }); console.error(`FAIL ${name} (${category(error)})`); throw error; }
}
function live() {
  const snapshot = discovery.snapshot();
  return expected.map(service => ({ service, matches: snapshot.filter(candidate => candidate.baseURL === service.baseURL && candidate.validation?.valid && candidate.expiresAt > Date.now()) })).filter(row => row.matches.length === 1).map(row => ({ ...row.service, candidate: row.matches[0] }));
}
async function waitForSet(ids, phase, record = true) {
  const wanted = [...ids].sort().join('|');
  const deadline = Date.now() + options.timeoutMs;
  let stableAt = 0;
  while (Date.now() < deadline) {
    const rows = live();
    if (rows.map(row => row.id).sort().join('|') === wanted) {
      stableAt ||= Date.now();
      if (Date.now() - stableAt >= 600) {
        if (record) {
          report.sequence.push(rows.length);
          report.snapshots.push({ phase, elapsedMs: Date.now() - started, ids: rows.map(row => row.id).sort() });
        }
        return rows;
      }
    } else stableAt = 0;
    await delay(100);
  }
  throw new Error('mDNS lifecycle observation timed out.');
}
async function textIsReady() {
  try { await textTransport.json('models'); return true; }
  catch (error) { if (/Service returned HTTP 503/.test(error.message)) return false; throw error; }
}

try {
  if (options.backend === 'wsl') assert.equal(process.platform, 'win32', 'Use --backend native for the native Node deployment; the wsl backend requires Windows.');
  const lab = JSON.parse(await readFile(resolve(options.runtime, 'lab.json'), 'utf8'));
  assert.equal(lab.schema, 'llm-discovery-demo-lab/v1', 'Unsupported lab schema.');
  report.runId = lab.runId;
  report.interfaceAddress = lab.interfaceAddress;
  expected = lab.nodes.flatMap(node => node.services.map(service => ({ id: service.id, baseURL: canonicalBaseURL(`https://${node.hostname}:${node.port}${service.basePath}`) })));
  assert.deepEqual(expected.map(service => service.id).sort(), ['a-text', 'a-vision', 'b-tools'], 'Unexpected experiment service set.');
  const trust = await loadTrust(resolve(options.runtime, 'client/trust.json'));
  const serverKeys = JSON.parse(await readFile(resolve(options.runtime, 'server/tokens.json'), 'utf8'));
  if (options.backend === 'native') await check('verify-native-node-a-target', async () => {
    const status = await requestNative(options.runtime, 'status');
    assert.equal(status.backend, 'native');
    assert.equal(status.state, 'running');
    assert.equal(status.runId, lab.runId);
    assert.equal(status.address, lab.address);
    assert.equal(status.interfaceAddress, lab.interfaceAddress);
    assert.equal(typeof status.instanceId, 'string');
    nativeInstanceId = status.instanceId;
    assert.deepEqual(status.nodes.map(node => [node.id, node.ready]), [['A', true], ['B', true]]);
    assert.deepEqual([...status.services].sort(), expected.map(service => service.id).sort());
    return { backend: 'native', runtimeIdentityVerified: true, privateParentIpc: true };
  });
  else await check('verify-isolated-node-a-target', async () => {
    const wslRoot = await wsl('wslpath', '-a', '-u', root);
    const wslRuntime = await wsl('wslpath', '-a', '-u', options.runtime);
    assert.ok(wslRoot.startsWith('/') && wslRuntime.startsWith('/'), 'Could not map workspace paths into WSL.');
    helper = `${wslRoot}/spikes/network/wsl-engine.sh`;
    const ids = (await docker('ps', '--filter', 'label=com.docker.compose.project=llm-discovery-demo', '--filter', 'label=com.docker.compose.service=node-a', '--format', '{{.ID}}')).split(/\r?\n/).filter(Boolean);
    assert.equal(ids.length, 1, 'Exactly one running experiment node-a is required.');
    assert.match(ids[0], /^[a-f0-9]{12,64}$/, 'Invalid container identity.');
    const mounts = JSON.parse(await docker('inspect', '--format', '{{json .Mounts}}', ids[0]));
    assert.ok(mounts.some(mount => mount.Destination === '/lab' && mount.Source === `${wslRuntime}/server` && mount.RW === false), 'The container must mount this runtime server directory read-only.');
    containerId = ids[0];
    return { project: 'llm-discovery-demo', service: 'node-a', runtimeMountVerified: true };
  });
  discovery = createDiscoveryClient({ interfaceAddress: lab.interfaceAddress, networkId: `lifecycle-${lab.runId}`, queryIntervalMs: 2000 });
  unsubscribe = discovery.subscribe(event => {
    const service = expected.find(item => item.baseURL === event.candidate?.baseURL);
    if (service && ['added', 'removed', 'invalid'].includes(event.type)) report.events.push({ elapsedMs: Date.now() - started, type: event.type, service: service.id, ...(event.reason ? { reason: event.reason } : {}) });
  });
  await discovery.start();
  let initial;
  await check('initial-three-services', async () => { initial = await waitForSet(expected.map(service => service.id), 'initial'); return { count: initial.length }; });
  textTransport = createPinnedTransport(authorizeCandidate(initial.find(row => row.id === 'a-text').candidate, trust), { timeoutMs: 10000 });
  visionTransport = createPinnedTransport(authorizeCandidate(initial.find(row => row.id === 'a-vision').candidate, trust), { timeoutMs: 10000, apiKey: serverKeys['a-vision'] });
  await check('text-initially-ready', async () => { assert.equal(await textIsReady(), true); });
  const eventStart = report.events.length;
  await check('withdraw-text-only', async () => {
    signalMayHaveBeenSent = true;
    await toggleText();
    await waitForSet(['a-vision', 'b-tools'], 'text-withdrawn');
    assert.equal(await textIsReady(), false, 'Text HTTP readiness must match withdrawal.');
    assert.ok(report.events.slice(eventStart).some(event => event.service === 'a-text' && event.type === 'removed'), 'Missing actual mDNS removal event.');
    assert.ok(!report.events.slice(eventStart).some(event => event.service !== 'a-text' && event.type === 'removed'), 'Another service disappeared during Text withdrawal.');
    return { count: 2, textHttpStatus: 503, sharedHostnameStillUsable: true };
  });
  await check('vision-https-while-text-offline', async () => {
    const catalog = await visionTransport.json('models');
    const capabilities = await visionTransport.json('_demo/capabilities');
    assert.equal(capabilities.schema, 'llm-discovery-demo-capabilities/v1');
    const models = capabilities.models.filter(model => catalog.data.some(row => row.id === model.id) && model.input_modalities.includes('image'));
    assert.equal(models.length, 1, 'Expected one API-listed image model.');
    const prompt = `vision-remains-online-${randomUUID()}`;
    const response = await visionTransport.json('responses', { method: 'POST', body: { model: models[0].id, stream: false, store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] } });
    assert.equal(response.status, 'completed');
    const output = response.output.flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text).join('');
    assert.ok(output.includes(prompt), 'Vision service did not return the transmitted request text.');
    assert.equal(await textIsReady(), false, 'Text must remain offline during the Vision request.');
    return { model: models[0].id, outputSha256: createHash('sha256').update(output).digest('hex'), textRemainedOffline: true };
  });
  await check('restore-three-services', async () => {
    await toggleText();
    await waitForSet(expected.map(service => service.id), 'text-restored');
    assert.equal(await textIsReady(), true, 'Text did not become ready after restoration.');
    return { count: 3, textReady: true };
  });
} catch (error) {
  if (!report.checks.some(item => item.status === 'failed')) report.checks.push({ name: 'setup-or-runtime', status: 'failed', category: category(error) });
} finally {
  // Inspect actual HTTP state before a compensating toggle, including uncertain command completion.
  if (signalMayHaveBeenSent && textTransport) {
    try {
      await check('finally-confirm-text-restored', async () => {
        if (!await textIsReady()) { await toggleText(); await waitForSet(expected.map(service => service.id), 'finally-restored'); }
        assert.equal(await textIsReady(), true);
        await waitForSet(expected.map(service => service.id), 'finally-confirmed', false);
        return { ready: true, discovered: 3 };
      });
    } catch { /* Preserve failed restoration explicitly in the report and exit nonzero. */ }
  }
  unsubscribe?.();
  await discovery?.stop();
  textTransport?.close(); visionTransport?.close();
  report.status = report.checks.length && report.checks.every(item => item.status === 'passed') ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString(); report.durationMs = Date.now() - started;
  await mkdir(dirname(options.output), { recursive: true });
  const temporary = `${options.output}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n'); await rename(temporary, options.output);
  console.log(`${report.status.toUpperCase()}: mDNS ${report.sequence.join(' -> ')}; sanitized report: ${options.output}`);
  if (report.status !== 'passed') process.exitCode = 1;
}
