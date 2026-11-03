import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initializeLab, migrateAuthDemo } from './initialize.mjs';
import { createDiscoveryClient } from '@llm-discovery/discovery-core';

const [command, ...args] = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1]; };
const runtimeDir = option('runtime', '.runtime/current');
if (command === 'init') {
  console.log(JSON.stringify(await initializeLab({ address: option('address'), interfaceAddress: option('interface'), runtimeDir }), null, 2));
} else if (command === 'migrate-auth-demo') {
  console.log(JSON.stringify(await migrateAuthDemo({ runtimeDir }), null, 2));
} else if (command === 'doctor') {
  console.log(JSON.stringify({ node: process.version, platform: process.platform, interfaces: Object.entries(os.networkInterfaces()).flatMap(([name, rows]) => rows.filter((r) => !r.internal && r.family === 'IPv4').map((r) => ({ name, address: r.address }))) }, null, 2));
} else if (command === 'browse') {
  let lab = {};
  try { lab = JSON.parse(await readFile(path.join(runtimeDir, 'lab.json'), 'utf8')); } catch {}
  const client = createDiscoveryClient({ interfaceAddress: option('interface', lab.interfaceAddress), networkId: 'demo-lan' });
  client.subscribe((event) => console.log(JSON.stringify(event)));
  await client.start();
  const timeout = Number(option('seconds', '30'));
  await new Promise((resolve) => setTimeout(resolve, timeout * 1000));
  const result = client.snapshot();
  console.log(JSON.stringify({ type: 'snapshot', services: result }, null, 2));
  const output = option('output');
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2)); }
  await client.stop();
  if (!result.length) process.exitCode = 2;
} else {
  console.log('Usage: npm run lab -- init --address <service-ip> --interface <windows-interface-ip> [--runtime path]\n       npm run lab -- migrate-auth-demo [--runtime path]\n       npm run lab -- doctor\n       npm run lab -- browse [--interface ip] [--seconds 30] [--output path]');
  if (command) process.exitCode = 1;
}
