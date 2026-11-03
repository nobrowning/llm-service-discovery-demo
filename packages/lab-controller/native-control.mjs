/** Authenticated loopback control for one native runtime. Never uses stored PIDs. */
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, lstat, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const SCHEMA = 'llm-discovery-native-control/v1';
const REPLY = 'llm-discovery-native-reply/v1';
const controlPath = runtimeDir => path.resolve(runtimeDir, 'native-control.json');
const isUUID = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const methods = { status: 'GET', stop: 'POST', 'toggle-text': 'POST' };

async function readRecord(runtimeDir) {
  const file = controlPath(runtimeDir);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Invalid native control file. No process was contacted.');
  let record;
  try { record = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error('Invalid native control file. No process was contacted.'); }
  let lab;
  try { lab = JSON.parse(await readFile(path.resolve(runtimeDir, 'lab.json'), 'utf8')); }
  catch { throw new Error('The native runtime lab manifest is missing or invalid. No process was contacted.'); }
  if (!record || record.schema !== SCHEMA || record.host !== '127.0.0.1' || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535 ||
      !isUUID(record.instanceId) || typeof record.token !== 'string' || !/^[a-f0-9]{64}$/.test(record.token) ||
      typeof record.runId !== 'string' || record.runId !== lab.runId || record.runtimeDir !== await realpath(path.resolve(runtimeDir))) {
    throw new Error('Native control identity does not match this runtime. No process was contacted.');
  }
  return record;
}

export async function requestNative(runtimeDir, action = 'status', { timeoutMs = 15000, expectedInstanceId } = {}) {
  if (!Object.hasOwn(methods, action)) throw new Error('Unsupported native control action.');
  const record = await readRecord(runtimeDir);
  if (expectedInstanceId && record.instanceId !== expectedInstanceId) throw new Error('The native controller instance changed. No process was contacted.');
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: record.port, path: `/native/${record.instanceId}/${action}`, method: methods[action],
      headers: { authorization: `Bearer ${record.token}`, connection: 'close' }, timeout: timeoutMs,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 32768) request.destroy(new Error('Native control response is too large.')); });
      response.on('end', () => {
        try {
          const value = JSON.parse(body);
          if (response.statusCode !== 200 || value.schema !== REPLY || value.instanceId !== record.instanceId || value.runId !== record.runId || value.action !== action) {
            throw new Error('Native controller did not confirm this runtime identity.');
          }
          resolve(value.result);
        } catch { reject(new Error('Native controller rejected the request or returned an invalid identity.')); }
      });
      response.on('error', () => reject(new Error('Native controller response failed.')));
    });
    request.on('timeout', () => request.destroy(new Error('Native controller timed out.')));
    request.on('error', error => reject(Object.assign(new Error('Native controller is unavailable. No PID was signalled. If its foreground process has exited, preserve the runtime and remove only native-control.json before restarting.'), { code: error.code })));
    request.end();
  });
}

export async function nativeStatus(runtimeDir) {
  try { return await requestNative(runtimeDir, 'status'); }
  catch (error) { if (error.code === 'ENOENT') return { backend: 'native', state: 'stopped', runtimeDir: path.resolve(runtimeDir) }; throw error; }
}

export async function nativeStop(runtimeDir) {
  let before;
  try { before = await readRecord(runtimeDir); }
  catch (error) { if (error.code === 'ENOENT') return { backend: 'native', state: 'stopped', runtimeDir: path.resolve(runtimeDir) }; throw error; }
  await requestNative(runtimeDir, 'stop', { expectedInstanceId: before.instanceId });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const current = await readRecord(runtimeDir);
      if (current.instanceId !== before.instanceId) throw new Error('Another native controller replaced this instance while stopping.');
    } catch (error) {
      if (error.code === 'ENOENT') return { backend: 'native', state: 'stopped', runtimeDir: path.resolve(runtimeDir) };
      throw error;
    }
    await delay(100);
  }
  throw new Error('Native shutdown has not completed. Inspect its foreground terminal; no unrelated process was signalled.');
}

export async function createNativeControl({ runtimeDir, runId, instanceId = randomUUID(), status, stop, toggleText, onError = () => {} }) {
  const file = controlPath(runtimeDir);
  const token = randomBytes(32).toString('hex');
  const secret = Buffer.from(`Bearer ${token}`);
  let published = false, closing;
  const server = http.createServer(async (request, response) => {
    const supplied = Buffer.from(typeof request.headers.authorization === 'string' ? request.headers.authorization : '');
    const action = request.url?.split('/')[3];
    const valid = request.socket.remoteAddress === '127.0.0.1' && !request.headers.origin &&
      request.headers.host === `127.0.0.1:${server.address()?.port}` && supplied.length === secret.length && timingSafeEqual(supplied, secret) &&
      Object.hasOwn(methods, action) && request.url === `/native/${instanceId}/${action}` && request.method === methods[action] &&
      !request.headers['transfer-encoding'] && (!request.headers['content-length'] || request.headers['content-length'] === '0');
    const send = (code, value) => { response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' }); response.end(JSON.stringify(value)); };
    if (!valid) { send(403, { error: 'Native control request rejected.' }); request.resume(); return; }
    try {
      if (action === 'stop') {
        send(200, { schema: REPLY, instanceId, runId, action, result: { backend: 'native', state: 'stopping' } });
        setImmediate(() => { Promise.resolve().then(stop).catch(onError); });
      } else {
        const result = action === 'status' ? status() : await toggleText();
        send(200, { schema: REPLY, instanceId, runId, action, result });
      }
    } catch { send(409, { error: 'Native controller cannot complete this action in its current state.' }); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    server.on('error', onError);
    const record = { schema: SCHEMA, host: '127.0.0.1', port: server.address().port, token, instanceId, runId, runtimeDir: path.resolve(runtimeDir) };
    await writeFile(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    published = true;
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    if (error.code === 'EEXIST') throw new Error('A native control file already exists. Run native status or native stop for this runtime. If the old foreground process has exited, remove only native-control.json; do not delete certificates or keys.');
    throw error;
  }
  return {
    instanceId,
    close() {
      closing ??= (async () => {
        await new Promise(resolve => server.close(resolve));
        if (published) {
          const current = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
          if (current?.instanceId === instanceId && current?.token === token) await unlink(file);
        }
      })();
      return closing;
    },
  };
}
