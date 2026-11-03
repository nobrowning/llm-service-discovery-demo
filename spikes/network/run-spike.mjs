// Bounded Windows receiver + Docker host-network publisher experiment.
// This script never changes Docker/Windows/WSL settings.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
const address = process.argv[2];
if (!address || !/^\d+\.\d+\.\d+\.\d+$/.test(address) || address.startsWith('127.')) throw new Error('Usage: node spikes/network/run-spike.mjs <Windows non-loopback IPv4>');
const directory = fileURLToPath(new URL('.', import.meta.url));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const container = 'llm-discovery-spike-' + Date.now();
const image = process.env.SPIKE_NODE_IMAGE || 'node:24-alpine';
const backend = process.env.SPIKE_DOCKER_BACKEND || 'desktop';
const advertisedAddress = process.env.SPIKE_ADVERTISE_IPV4 || address;
const wslDistribution = process.env.SPIKE_WSL_DISTRO || 'Ubuntu';
const wslDirectory = directory.replace(/^([A-Za-z]):[\\/]/, (_, drive) => '/mnt/' + drive.toLowerCase() + '/').replaceAll('\\', '/').replace(/\/$/, '');
const events = [];
function log(event, data = {}) { const record = { time: new Date().toISOString(), event, ...data }; events.push(record); console.log(JSON.stringify(record)); }
function command(args, timeout = 10000) {
  return new Promise(resolve => {
    const child = backend === 'wsl'
      ? spawn('wsl', ['-d', wslDistribution, '-u', 'root', '--exec', 'sh', wslDirectory + '/wsl-engine.sh', 'docker', ...args], { windowsHide: true })
      : spawn('docker', args, { windowsHide: true });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.on('error', error => { clearTimeout(timer); resolve({ exitCode: null, error: error.message, stdout, stderr }); });
    child.on('close', exitCode => { clearTimeout(timer); resolve({ exitCode, timedOut, stdout: stdout.trim(), stderr: stderr.trim() }); });
  });
}
log('experiment-start', { container, image, backend, interfaceAddress: address, advertisedAddress, mode: 'container-publishes/windows-receives', systemSettingsChanged: false });
const inspected = await command(['image', 'inspect', image, '--format', '{{.Id}}']);
if (inspected.exitCode !== 0) { log('blocked-image-or-engine', inspected); process.exitCode = 2; }
else {
  const receiver = spawn(process.execPath, [path.join(directory, 'receiver.mjs'), address, '35'], { windowsHide: true });
  let started = false;
  let launch;
  let partial = '';
  receiver.stdout.on('data', chunk => {
    partial += chunk;
    const lines = partial.split(/\r?\n/); partial = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line); events.push(event); console.log(line);
        if (event.event === 'ready' && !started) {
          started = true;
          const source = backend === 'wsl' ? wslDirectory : directory;
          launch = command(['run', '-d', '--name', container, '--network', 'host', '--mount', `type=bind,source=${source},target=/spike,readonly`, '-e', `ADVERTISE_IPV4=${advertisedAddress}`, '-e', 'SERVICE_PORT=18081', image, 'node', '/spike/publisher.mjs'], 15000).then(result => log('docker-start', result));
        }
      } catch { log('receiver-output', { line }); }
    }
  });
  receiver.stderr.on('data', data => log('receiver-stderr', { message: data.toString() }));
  const diagnosis = setTimeout(() => {
    // Fixed-endpoint health is diagnostic only, never counted as discovered API success.
    for (const target of [advertisedAddress, '127.0.0.1']) {
      const req = http.get({ host: target, port: 18081, path: '/healthz', timeout: 3000 }, res => { res.resume(); log('fixed-endpoint-health-diagnostic', { target, status: res.statusCode }); });
      req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
      req.on('error', error => log('fixed-endpoint-health-diagnostic', { target, error: error.message }));
    }
  }, 10000);
  await new Promise(resolve => receiver.once('close', resolve));
  clearTimeout(diagnosis);
  if (launch) await launch;
  if (started) {
    log('container-logs', await command(['logs', container]));
    log('container-stop', await command(['stop', '-t', '2', container], 5000));
    log('container-remove', await command(['rm', '-f', container], 5000));
  }
  const summary = events.find(event => event.event === 'summary');
  process.exitCode = summary?.httpSucceeded ? 0 : 2;
}
const evidenceDirectory = path.join(directory, 'evidence');
await mkdir(evidenceDirectory, { recursive: true });
const evidencePath = path.join(evidenceDirectory, runId + '.jsonl');
await writeFile(evidencePath, events.map(x => JSON.stringify(x)).join('\n') + '\n');
console.log(JSON.stringify({ event: 'evidence-saved', path: evidencePath, exitCode: process.exitCode || 0 }));
