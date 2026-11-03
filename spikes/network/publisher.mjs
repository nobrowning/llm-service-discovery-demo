import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';
import { SERVICE, announcement, decode } from './dns.mjs';
const address = process.env.ADVERTISE_IPV4;
const port = Number(process.env.SERVICE_PORT || 18081);
if (!address || address.startsWith('127.') || address === '0.0.0.0') throw new Error('Set ADVERTISE_IPV4 to a reachable non-loopback IPv4 address');
const log = (event, data = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), role: 'container-publisher', event, ...data }));
log('interfaces', { interfaces: Object.entries(os.networkInterfaces()).flatMap(([name, values]) => values.filter(x => x.family === 'IPv4' && !x.internal).map(x => ({ name, address: x.address }))) });
const api = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, node: 'llm-discovery-spike-node' })); return; }
  if (req.method === 'POST' && req.url === '/v1/responses') {
    let body = ''; req.on('data', part => { body += part; }); req.on('end', () => {
      log('api-request', { path: req.url, remote: req.socket.remoteAddress, bytes: body.length });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_network_spike', object: 'response', status: 'completed', model: 'network-spike-mock', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Container publisher network spike reached the mock API.' }] }] }));
    }); return;
  }
  res.writeHead(404); res.end();
});
api.listen(port, '0.0.0.0', () => log('api-listening', { port, advertisedAddress: address }));
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
socket.on('error', error => log('udp-error', { message: error.message, code: error.code }));
function send(ttl = 30) { socket.send(announcement(address, port, ttl), 5353, '224.0.0.251', error => log(error ? 'announcement-error' : 'announcement-sent', error ? { message: error.message } : { ttl })); }
socket.on('message', (packet, remote) => {
  try { const parsed = decode(packet); if (!parsed.response && parsed.questions.some(q => q.name === SERVICE)) { log('query-received', { from: remote.address, port: remote.port }); send(); } } catch {}
});
let announceTimer;
socket.bind(5353, '0.0.0.0', () => {
  try { socket.addMembership('224.0.0.251'); socket.setMulticastTTL(255); socket.setMulticastLoopback(true); log('multicast-joined'); send(); announceTimer = setInterval(send, 3000); }
  catch (error) { log('membership-error', { message: error.message, code: error.code }); }
});
function stop() { clearInterval(announceTimer); send(0); setTimeout(() => { socket.close(); api.close(); process.exit(0); }, 250); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
