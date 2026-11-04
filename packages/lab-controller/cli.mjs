import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initializeLab, migrateAuthDemo, migrateThreeStateDemo } from './initialize.mjs';
import { createDiscoveryClient } from '@llm-discovery/discovery-core';

import { localIPv4, selectNativeNetwork, startNativeLab } from './native.mjs';
import { nativeStatus, nativeStop } from './native-control.mjs';

const usage = `Usage: node packages/lab-controller/cli.mjs <command> [options]
  native run|start [--runtime DIR] [--interface IPv4] [--address IPv4] [--scene company|home]
      Run two native Node processes in the foreground. Ctrl+C stops both.
      Select a local IPv4 interface; multiple interfaces require --interface.
      --address is the local advertised HTTPS address (default: --interface).
      --scene chooses presentation and initial services for a new runtime only.
  native status|stop [--runtime DIR]
      Inspect or gracefully stop only this runtime's authenticated controller.
  init --address <service-ip> [--interface <client-interface-ip>] [--runtime DIR] [--scene company|home]
  migrate-auth-demo|migrate-three-state-demo [--runtime DIR]
  doctor
      Show this computer's usable IPv4 interfaces and Node version.
  list-interfaces
      Print the usable local IPv4 interface names and addresses as JSON.
  browse [--runtime DIR] [--interface IPv4] [--seconds 30] [--output FILE]
  --help | --version
Default runtime: .runtime/current. Native mode needs Node.js 24 or later.
Discovery uses one IPv4 interface. It does not grant TLS trust or import API keys.`;

function parseOptions(args, allowed) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!allowed.includes(key) || !args[index + 1] || args[index + 1].startsWith('--') || Object.hasOwn(result, key.slice(2))) {
      throw new Error(`Invalid or repeated option: ${key}. Run --help for usage.`);
    }
    result[key.slice(2)] = args[index + 1];
  }
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || process.argv.slice(2).some(value => ['--help', '-h'].includes(value))) { console.log(usage); return; }
  if (['--version', '-v'].includes(command)) { console.log(JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version); return; }
  const print = value => console.log(JSON.stringify(value, null, 2));
  if (command === 'native') {
    const [action, ...nativeArgs] = args;
    if (!['run', 'start', 'status', 'stop'].includes(action)) throw new Error('Use native run, native status, or native stop. Run --help for usage.');
    const options = parseOptions(nativeArgs, ['run', 'start'].includes(action) ? ['--runtime', '--interface', '--address', '--scene'] : ['--runtime']);
    const runtimeDir = options.runtime ?? '.runtime/current';
    if (action === 'status') { print(await nativeStatus(runtimeDir)); return; }
    if (action === 'stop') { print(await nativeStop(runtimeDir)); return; }
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Native Demo mode requires Node.js 24 or later.');
    const controller = await startNativeLab({ runtimeDir, interfaceAddress: options.interface, address: options.address, scene: options.scene });
    if (controller.status().state === 'running') print(controller.status());
    const result = await controller.closed;
    if (result.error) throw result.error;
  } else if (command === 'doctor') {
    parseOptions(args, []);
    print({ node: process.version, nodeRequired: '>=24', nodeSupported: Number(process.versions.node.split('.')[0]) >= 24,
      platform: process.platform, architecture: process.arch, interfaces: localIPv4() });
  } else if (command === 'list-interfaces') {
    parseOptions(args, []);
    print(localIPv4());
  } else if (command === 'init') {
    const options = parseOptions(args, ['--address', '--interface', '--runtime', '--scene']);
    print(await initializeLab({ address: options.address, interfaceAddress: options.interface, runtimeDir: options.runtime, scene: options.scene }));
  } else if (['migrate-auth-demo', 'migrate-three-state-demo'].includes(command)) {
    const options = parseOptions(args, ['--runtime']);
    print(await (command === 'migrate-auth-demo' ? migrateAuthDemo : migrateThreeStateDemo)({ runtimeDir: options.runtime }));
  } else if (command === 'browse') {
    const options = parseOptions(args, ['--runtime', '--interface', '--seconds', '--output']);
    const runtimeDir = options.runtime ?? '.runtime/current';
    const seconds = Number(options.seconds ?? 30);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new Error('--seconds must be greater than zero and no more than 300.');
    let lab = {};
    try { lab = JSON.parse(await readFile(path.join(runtimeDir, 'lab.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const { interfaceAddress } = selectNativeNetwork({ interfaceAddress: options.interface ?? lab.interfaceAddress });
    const client = createDiscoveryClient({ interfaceAddress, networkId: 'demo-lan' });
    client.subscribe(event => console.log(JSON.stringify(event)));
    try {
      await client.start();
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      const result = client.snapshot();
      print({ type: 'snapshot', services: result });
      if (options.output) { await mkdir(path.dirname(path.resolve(options.output)), { recursive: true }); await writeFile(options.output, JSON.stringify(result, null, 2)); }
      if (!result.length) process.exitCode = 2;
    } finally { await client.stop(); }
  } else throw new Error(`Unknown command: ${command}. Run --help for usage.`);
}

try { await main(); }
catch (error) { console.error(`Demo: ${error.message}`); process.exitCode = 1; }
