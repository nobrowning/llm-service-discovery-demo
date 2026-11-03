import dgram from 'node:dgram';
import http from 'node:http';
import { SERVICE, INSTANCE, HOST, query, decode } from './dns.mjs';
const address = process.argv[2];
const seconds = Number(process.argv[3] || 25);
if (!address) throw new Error('Usage: node receiver.mjs <Windows interface IPv4> [seconds]');
const log = (event, data = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), role: 'windows-receiver', event, ...data }));
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
let timer, matchingPackets = 0, sentQueries = 0, httpSucceeded = false, connecting = false;
const records = new Map();
socket.on('error', error => log('udp-error', { message: error.message, code: error.code }));
socket.on('message', (packet, remote) => {
  try {
    const parsed = decode(packet);
    if (!parsed.response || !parsed.records.some(r => r.name === INSTANCE || (r.name === SERVICE && r.value === INSTANCE))) return;
    matchingPackets++;
    const relevant = parsed.records.filter(r => [SERVICE, INSTANCE, HOST].includes(r.name));
    log('mdns-response', { from: remote.address, port: remote.port, records: relevant, packetHex: packet.toString('hex') });
    for (const record of relevant) records.set(record.name + ':' + record.type, record);
    const ptr = records.get(SERVICE + ':12'), srv = records.get(INSTANCE + ':33'), txt = records.get(INSTANCE + ':16'), a = records.get(HOST + ':1');
    if (!connecting && ptr?.ttl && srv?.ttl && txt?.ttl && a?.ttl) {
      connecting = true;
      // Connect to the discovered A record, retaining the DNS-SD hostname as Host.
      // This proves reachability without pretending Windows system .local resolution was tested.
      const req = http.request({ host: a.value, port: srv.value.port, path: '/v1/responses', method: 'POST', timeout: 5000, headers: { host: srv.value.target.replace(/\.$/, '') + ':' + srv.value.port, 'content-type': 'application/json' } }, res => {
        let body = ''; res.on('data', part => { body += part; }); res.on('end', () => { httpSucceeded = res.statusCode === 200; log('discovered-api-result', { status: res.statusCode, target: a.value + ':' + srv.value.port, body }); });
      });
      req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
      req.on('error', error => log('discovered-api-error', { message: error.message }));
      req.end(JSON.stringify({ model: 'network-spike-mock', input: 'Synthetic network test only.' }));
    }
  } catch (error) { log('parse-error', { message: error.message }); }
});
socket.bind(5353, '0.0.0.0', () => {
  try {
    socket.addMembership('224.0.0.251', address); socket.setMulticastInterface(address); socket.setMulticastTTL(255); socket.setMulticastLoopback(true);
    log('ready', { interfaceAddress: address, durationSeconds: seconds });
    const send = () => socket.send(query(), 5353, '224.0.0.251', error => { if (error) log('query-error', { message: error.message }); else { sentQueries++; log('query-sent'); } });
    send(); timer = setInterval(send, 3000);
  } catch (error) { log('membership-error', { message: error.message, code: error.code }); }
});
setTimeout(() => { clearInterval(timer); log('summary', { interfaceAddress: address, sentQueries, matchingPackets, httpSucceeded, recordTypes: [...new Set([...records.values()].map(x => x.type))] }); socket.close(); }, seconds * 1000);
