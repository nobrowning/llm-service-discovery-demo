import { readFile } from 'node:fs/promises';
import { createMockServer } from './index.mjs';

const env = process.env;
const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error('A JSON configuration or credential file could not be read. Check its path and JSON syntax.'); }
};
try {
  const cert = env.MOCK_TLS_CERT ? await readFile(env.MOCK_TLS_CERT) : null;
  const key = env.MOCK_TLS_KEY ? await readFile(env.MOCK_TLS_KEY) : null;
  const token = env.MOCK_TOKEN_FILE ? (await readFile(env.MOCK_TOKEN_FILE, 'utf8')).trim() : env.MOCK_TOKEN;
  const port = Number(env.MOCK_PORT ?? 18443);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MOCK_PORT must be an integer from 0 to 65535');
  // Authentication validation belongs to the resolved per-service policy:
  // A/B need their protected service's key; default C needs no token at all.
  // Do not add a process-wide "token required" check before these overrides.
  const mock = createMockServer({
    node: env.MOCK_NODE ?? 'A', nodeLabel: env.MOCK_NODE_LABEL, host: env.MOCK_HOST ?? '0.0.0.0', port,
    tls: key && cert ? { key, cert } : undefined,
    token, tokens: env.MOCK_TOKENS_FILE ? await readJson(env.MOCK_TOKENS_FILE) : undefined,
    services: env.MOCK_SERVICE_CONFIG_FILE ? await readJson(env.MOCK_SERVICE_CONFIG_FILE) : undefined,
    nonstreamOnly: env.MOCK_NONSTREAM_ONLY === 'true', allowHttp: env.MOCK_ALLOW_HTTP === 'true',
    logger: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
  });
  const address = await mock.listen();
  process.stdout.write(`${JSON.stringify({ event: 'listening', node: env.MOCK_NODE ?? 'A', address, tls: !!(key && cert), mock: true, services: mock.services })}\n`);
  const stop = async () => { await mock.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  // Never print environment values or parsed credential documents.
  process.stderr.write(`Mock API startup failed: ${error.message}\n`);
  process.exitCode = 1;
}
