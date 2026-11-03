// Small, dependency-free DNS codec for the bounded network spike only.
export const SERVICE = '_llm-api._tcp.local.';
export const INSTANCE = 'llm-discovery-spike-node.' + SERVICE;
export const HOST = 'llm-discovery-spike.local.';
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const name = s => Buffer.concat([...s.replace(/\.$/, '').split('.').map(x => { const b = Buffer.from(x); return Buffer.concat([Buffer.from([b.length]), b]); }), Buffer.from([0])]);
export const query = () => Buffer.concat([Buffer.from([0,0,0,0,0,1,0,0,0,0,0,0]), name(SERVICE), u16(12), u16(1)]);
export function announcement(address, port, ttl = 30) {
  const rr = (owner, type, value, unique = true) => Buffer.concat([name(owner), u16(type), u16(unique ? 0x8001 : 1), u32(ttl), u16(value.length), value]);
  const txt = ['txtvers=1', 'api=openresponses', 'protovers=2026-04-24', 'scheme=http', 'base=/v1', 'auth=none'];
  return Buffer.concat([Buffer.from([0,0,0x84,0,0,0,0,4,0,0,0,0]),
    rr(SERVICE, 12, name(INSTANCE), false),
    rr(INSTANCE, 33, Buffer.concat([u16(0), u16(0), u16(port), name(HOST)])),
    rr(INSTANCE, 16, Buffer.concat(txt.map(s => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)])))),
    rr(HOST, 1, Buffer.from(address.split('.').map(Number)))]);
}
export function decode(packet) {
  if (packet.length < 12) throw new Error('short DNS packet');
  function readName(start, visited = new Set()) {
    let cursor = start, end, labels = [];
    for (let count = 0; count < 128; count++) {
      if (cursor >= packet.length) throw new Error('name out of bounds');
      const size = packet[cursor++];
      if (size === 0) return { value: labels.join('.') + '.', end: end ?? cursor };
      if ((size & 0xc0) === 0xc0) {
        if (cursor >= packet.length) throw new Error('short pointer');
        const offset = ((size & 0x3f) << 8) | packet[cursor++];
        if (visited.has(offset)) throw new Error('pointer cycle');
        visited.add(offset);
        return { value: [...labels, readName(offset, visited).value.replace(/\.$/, '')].join('.') + '.', end: end ?? cursor };
      }
      if (size > 63 || cursor + size > packet.length) throw new Error('invalid label');
      labels.push(packet.toString('utf8', cursor, cursor + size)); cursor += size;
    }
    throw new Error('too many labels');
  }
  const questions = [], records = [];
  let cursor = 12;
  for (let i = 0; i < packet.readUInt16BE(4); i++) {
    const n = readName(cursor); cursor = n.end;
    if (cursor + 4 > packet.length) throw new Error('short question');
    questions.push({ name: n.value, type: packet.readUInt16BE(cursor) }); cursor += 4;
  }
  const total = packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10);
  for (let i = 0; i < total; i++) {
    const n = readName(cursor); cursor = n.end;
    if (cursor + 10 > packet.length) throw new Error('short resource record');
    const type = packet.readUInt16BE(cursor), ttl = packet.readUInt32BE(cursor + 4), length = packet.readUInt16BE(cursor + 8);
    cursor += 10; const end = cursor + length;
    if (end > packet.length) throw new Error('short resource data');
    let value;
    if (type === 12) value = readName(cursor).value;
    else if (type === 33 && length >= 7) value = { port: packet.readUInt16BE(cursor + 4), target: readName(cursor + 6).value };
    else if (type === 1 && length === 4) value = [...packet.subarray(cursor, end)].join('.');
    else if (type === 16) { value = []; for (let p = cursor; p < end;) { const size = packet[p++]; if (p + size > end) throw new Error('short TXT'); value.push(packet.toString('utf8', p, p + size)); p += size; } }
    records.push({ name: n.value, type, ttl, value }); cursor = end;
  }
  return { response: Boolean(packet.readUInt16BE(2) & 0x8000), questions, records };
}
