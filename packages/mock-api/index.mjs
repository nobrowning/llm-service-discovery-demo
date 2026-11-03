import http from 'node:http';
import https from 'node:https';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

export const CAPABILITIES_SCHEMA = 'llm-discovery-demo-capabilities/v1';
export const DEMO_TOOL_NAME = 'demo_read_marker';
const DEFAULTS = {
  A: [
    { id: 'a-text', auth: 'none', label: 'Text API', legacyLabel: 'Node A Text', base: '/text/v1', model: 'mock-text', kind: 'text', display_name: 'DeepSeek-R1-Distill-Qwen-32B', deployment: { parameters: '32B', quantization: 'Q4_K_M', version: 'R1' } },
    { id: 'a-vision', auth: 'required', label: 'Vision API', legacyLabel: 'Node A Vision', base: '/vision/v1', model: 'mock-vision', kind: 'vision', display_name: 'Qwen2.5-VL-7B-Instruct', deployment: { parameters: '7B', quantization: 'BF16', version: '2.5-VL' } },
  ],
  B: [{ id: 'b-tools', auth: 'required', label: 'Tools API', legacyLabel: 'Node B Tools', base: '/v1', model: 'mock-tools', kind: 'tools', display_name: 'GLM-4-9B-Chat', deployment: { parameters: '9B', quantization: 'INT4', version: '4' } }],
  C: [{ id: 'c-basic', auth: 'none', label: 'Basic API', legacyLabel: 'Node C Basic', base: '/api/v1', model: 'mock-basic', kind: 'text', display_name: 'Qwen3-8B', deployment: { parameters: '8B', quantization: 'Q8_0', version: '3' } }],
};

export function defaultNodeLabel(node, { address, hostname } = {}) {
  // Use deployment addresses when available; standalone API fixtures can retain
  // friendly names instead of inventing an IP or an unadvertised .local host.
  const label = { A: 'Studio Workstation', B: address ?? 'Lab Server', C: hostname ?? 'Mini PC' }[String(node).toUpperCase()];
  if (!label) throw new Error('node must be A, B, or C');
  return label;
}

export function defaultServicesForNode(node) {
  const normalized = String(node).toUpperCase();
  if (!DEFAULTS[normalized]) throw new Error('node must be A, B, or C');
  // dns-packet treats dots as DNS-label separators. Keep official model spelling
  // in display_name while using a single DNS-SD instance label for publication.
  return DEFAULTS[normalized].map((service) => ({ ...structuredClone(service), responseLabel: service.label, label: service.display_name.replaceAll('.', '-'), streaming: true, ready: true, enabled: true }));
}

class ApiError extends Error {
  constructor(status, code, message, param = null) {
    super(message);
    Object.assign(this, { status, code, param });
  }
}

function reject(code, message, param, status = 400) {
  throw new ApiError(status, code, message, param);
}

function authorized(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    reject('unsupported_media_type', 'Send application/json.', null, 415);
  }
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume();
    reject('request_too_large', 'Request body exceeds the configured limit.', null, 413);
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) reject('request_too_large', 'Request body exceeds the configured limit.', null, 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    reject('invalid_json', 'Request body must be a JSON object.');
  }
}

function imageSummary(part, maxImageBytes) {
  if (typeof part.image_url !== 'string') reject('unsupported_image', 'Only image_url data URLs are supported; file IDs are not supported.', 'input');
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.image_url);
  if (!match) reject('unsupported_image', 'Use a base64 PNG, JPEG, WebP, or GIF data URL. Remote URLs are never fetched.', 'input');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) reject('invalid_image', 'Image base64 is invalid.', 'input');
  if (bytes.length > maxImageBytes) reject('image_too_large', 'Image exceeds the configured byte limit.', 'input', 413);
  let valid = false;
  let dimensions;
  if (match[1] === 'image/png') {
    valid = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR';
    if (valid) dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (match[1] === 'image/jpeg') {
    valid = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  } else if (match[1] === 'image/gif') {
    valid = bytes.length >= 10 && /GIF8[79]a/.test(bytes.toString('ascii', 0, 6));
    if (valid) dimensions = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  } else {
    valid = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  if (!valid || (dimensions && (!dimensions.width || !dimensions.height))) reject('invalid_image', 'Image header does not match its declared media type.', 'input');
  return { media_type: match[1], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(dimensions ?? {}) };
}

function demoContextIndices(body) {
  if (!body.metadata) return new Set();
  const fields = ['demo_context_indices', 'demo_time_context_indices'].filter(field => Object.hasOwn(body.metadata, field));
  if (!fields.length) return new Set();
  if (fields.length > 1) reject('invalid_demo_context', 'Use one demo context metadata field; the legacy time-context alias cannot be combined with the current field.', 'metadata');
  const [field] = fields;
  const value = body.metadata[field];
  const invalid = () => reject('invalid_demo_context', 'Demo context must identify at most 64 unique user text items with an index array encoded in a string of at most 512 bytes.', `metadata.${field}`);
  if (typeof value !== 'string' || Buffer.byteLength(value) > 512 || !Array.isArray(body.input)) invalid();
  let indices;
  try { indices = JSON.parse(value); } catch { invalid(); }
  if (!Array.isArray(indices) || indices.length > 64 || new Set(indices).size !== indices.length) invalid();
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= body.input.length) invalid();
    const item = body.input[index];
    if (!item || item.role !== 'user' || (item.type && item.type !== 'message')) invalid();
    const content = typeof item.content === 'string' ? [{ type: 'input_text', text: item.content }] : item.content;
    if (!Array.isArray(content) || !content.length || content.some(part => !part || part.type !== 'input_text' || typeof part.text !== 'string')) invalid();
  }
  return new Set(indices);
}

function inspectInput(input, service, maxImageBytes, contextIndices) {
  if (typeof input === 'string') return { text: input, images: [], items: [], inputTypes: ['text'], latestUserIndex: -1 };
  if (!Array.isArray(input) || !input.length) reject('invalid_input', 'input must be a string or a nonempty item array.', 'input');
  let text = '';
  let latestUserIndex = -1;
  const images = [];
  const inputTypes = new Set();
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object') reject('invalid_input', 'Every input item must be an object.', 'input');
    if (['function_call', 'function_call_output', 'reasoning'].includes(item.type)) {
      if (item.type.startsWith('function_')) inputTypes.add('tool');
      continue;
    }
    if (item.type && item.type !== 'message') reject('unsupported_input', `Unsupported input item type: ${String(item.type).slice(0, 60)}.`, 'input');
    if (!['system', 'developer', 'user', 'assistant'].includes(item.role)) reject('invalid_role', 'Unsupported message role.', 'input');
    const content = typeof item.content === 'string' ? [{ type: 'input_text', text: item.content }] : item.content;
    if (!Array.isArray(content)) reject('invalid_input', 'Message content must be text or an array.', 'input');
    let userText = '';
    for (const part of content) {
      if (!part || typeof part !== 'object') reject('invalid_input', 'Content part must be an object.', 'input');
      if (['input_text', 'output_text'].includes(part.type)) {
        if (typeof part.text !== 'string') reject('invalid_input', 'Text content must be a string.', 'input');
        inputTypes.add('text');
        if (item.role === 'user') userText += part.text;
      } else if (part.type === 'input_image') {
        if (service.kind !== 'vision') reject('unsupported_input_modality', 'This Mock service does not support image input.', 'input');
        images.push(imageSummary(part, maxImageBytes));
        if (images.length > 16) reject('too_many_images', 'At most 16 images are supported.', 'input');
        inputTypes.add('image');
      } else if (part.type !== 'refusal') {
        reject('unsupported_input_modality', 'This content type is not supported by the Mock service.', 'input');
      }
    }
    // The demo-only sidecar preserves Harness context messages on the wire without
    // mistaking this client-declared context for a new human turn.
    if (item.role === 'user' && !contextIndices.has(index)) { text = userText; latestUserIndex = index; }
  }
  return { text, images, items: input, inputTypes: [...inputTypes], latestUserIndex };
}

function signCall(service, token, nonce) {
  return createHmac('sha256', token).update(`${service.id}:${DEMO_TOOL_NAME}:${nonce}`).digest('hex').slice(0, 24);
}

function verifiedToolOutput(info, service, token) {
  const outputIndex = info.items.findLastIndex((item) => item.type === 'function_call_output');
  if (outputIndex < 0) return null;
  // A later user turn must not accidentally replay an earlier completed tool result.
  if (info.latestUserIndex > outputIndex) return null;
  const output = info.items[outputIndex];
  if (service.kind !== 'tools') reject('unsupported_tool', 'This service does not support function calls.', 'input');
  const call = info.items.slice(0, outputIndex).findLast((item) => item.type === 'function_call' && item.call_id === output.call_id);
  const match = /^call_demo_([a-f0-9]{12})_([a-f0-9]{24})$/.exec(output.call_id ?? '');
  if (!call || call.name !== DEMO_TOOL_NAME || !match || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(signCall(service, token, match[1])))) {
    reject('invalid_tool_call_id', 'Tool output must reference a preceding call issued by this Mock service.', 'input');
  }
  try {
    const args = JSON.parse(call.arguments);
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error();
  } catch {
    reject('invalid_tool_arguments', 'The demo tool takes an empty argument object.', 'input');
  }
  let result = output.output;
  if (Array.isArray(result)) result = result.map((part) => part.text ?? '').join('');
  if (typeof result !== 'string' || !result.trim()) reject('invalid_tool_output', 'Tool output must contain the actual client marker result.', 'input');
  if (result.length > 8192) reject('invalid_tool_output', 'Tool output exceeds the demo limit.', 'input');
  // The server does not read the client fixture or execute a tool. Only this returned value is available.
  return { call_id: output.call_id, result };
}

function capabilities(service, nodeLabel) {
  return {
    schema: CAPABILITIES_SCHEMA,
    revision: '2',
    cache_max_age_seconds: 30,
    mock: true,
    demo_node_label: nodeLabel,
    service_label: service.label,
    models: [{
      id: service.model,
      display_name: service.display_name,
      ...(service.deployment ? { deployment: service.deployment } : {}),
      input_modalities: service.kind === 'vision' ? ['text', 'image'] : ['text'],
      output_modalities: ['text'],
      streaming: service.streaming ? 'supported' : 'unsupported',
      function_calling: service.kind === 'tools' ? 'supported' : 'unsupported',
      structured_output: 'unsupported',
      server_tools: [],
    }],
  };
}

function prepareResponse(body, service, node, token, maxImageBytes) {
  if (body.model !== service.model) reject('model_not_found', 'Requested model is not available on this service.', 'model', 404);
  if (body.stream !== undefined && typeof body.stream !== 'boolean') reject('invalid_parameter', 'stream must be a boolean.', 'stream');
  if (body.stream && !service.streaming) reject('streaming_not_supported', 'This scenario supports stream=false only.', 'stream');
  for (const key of ['previous_response_id', 'conversation']) if (body[key] != null) reject('unsupported_parameter', 'The Mock API uses stateless history replay.', key);
  if (body.background === true || body.store === true) reject('unsupported_parameter', 'Background execution and server-side response storage are unsupported.', body.background ? 'background' : 'store');
  if (body.max_output_tokens !== undefined && (!Number.isSafeInteger(body.max_output_tokens) || body.max_output_tokens < 1)) reject('invalid_parameter', 'max_output_tokens must be a positive integer.', 'max_output_tokens');
  if (body.text?.format?.type && body.text.format.type !== 'text') reject('unsupported_structured_output', 'JSON mode and JSON Schema output are not implemented.', 'text.format');
  if (body.tools !== undefined && !Array.isArray(body.tools)) reject('invalid_parameter', 'tools must be an array.', 'tools');
  if (body.tools?.some((tool) => !tool || typeof tool !== 'object' || typeof tool.type !== 'string')) reject('invalid_parameter', 'Every tool definition must be an object with a type.', 'tools');
  const info = inspectInput(body.input, service, maxImageBytes, demoContextIndices(body));
  const result = verifiedToolOutput(info, service, token);
  const choice = body.tool_choice ?? 'auto';
  if (!['auto', 'none', 'required'].includes(choice) && !(choice && typeof choice === 'object' && choice.type === 'function' && typeof choice.name === 'string')) reject('invalid_parameter', 'tool_choice must be auto, none, required, or a named function.', 'tool_choice');
  const required = choice === 'required' || (choice && typeof choice === 'object');
  const namedChoice = typeof choice === 'object' ? (choice.name ?? choice.function?.name) : null;
  const hasTool = body.tools?.some((tool) => tool.type === 'function' && tool.name === DEMO_TOOL_NAME);
  if (!result && required && (service.kind !== 'tools' || !hasTool || (namedChoice && namedChoice !== DEMO_TOOL_NAME))) reject('unsupported_tool', `Only ${DEMO_TOOL_NAME} is available in the Tools Mock, with its definition supplied by the client.`, 'tool_choice');
  const prefix = `[MOCK Node ${node} / ${service.responseLabel}]`;
  const wantsTool = service.kind === 'tools' && !result && hasTool && choice !== 'none' && (required || /marker|nonce|标记|标识|工具|demo_read_marker/i.test(info.text));
  let item;
  let status = 'completed';
  if (wantsTool) {
    const nonce = randomBytes(6).toString('hex');
    item = { type: 'function_call', id: `fc_${randomUUID().replaceAll('-', '')}`, call_id: `call_demo_${nonce}_${signCall(service, token, nonce)}`, name: DEMO_TOOL_NAME, arguments: '{}', status };
  } else {
    let text = `${prefix} Deterministic API fixture; no model inference. Received text: ${info.text.slice(0, 1024) || '(no user text)'}`;
    if (info.images.length) text = `${prefix} Received ${info.images.length} image(s). This validates image transport only, not visual understanding. ${JSON.stringify(info.images)}`;
    if (result) text = `${prefix} Client tool ${DEMO_TOOL_NAME} returned for ${result.call_id}: ${result.result}. The server did not execute the tool.`;
    if (body.max_output_tokens && Array.from(text).length > body.max_output_tokens * 4) {
      text = Array.from(text).slice(0, body.max_output_tokens * 4).join('');
      status = 'incomplete';
    }
    item = { type: 'message', id: `msg_${randomUUID().replaceAll('-', '')}`, role: 'assistant', status, content: [{ type: 'output_text', text, annotations: [], logprobs: [] }] };
  }
  const outputLength = item.type === 'message' ? item.content[0].text.length : item.arguments.length;
  const inputTokens = Math.ceil(info.text.length / 4);
  const outputTokens = Math.ceil(outputLength / 4);
  return { info, response: {
    id: `resp_${randomUUID().replaceAll('-', '')}`, object: 'response', created_at: Math.floor(Date.now() / 1000),
    status, error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
    instructions: body.instructions ?? null, max_output_tokens: body.max_output_tokens ?? null,
    model: service.model, output: [item], parallel_tool_calls: false, previous_response_id: null,
    reasoning: { effort: null, summary: null }, store: false, temperature: body.temperature ?? 0,
    text: { format: { type: 'text' } }, tool_choice: choice, tools: body.tools ?? [], top_p: body.top_p ?? 1,
    truncation: 'disabled', user: null,
    usage: { input_tokens: inputTokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: outputTokens, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: inputTokens + outputTokens },
    metadata: { mock: 'true', demo_node: node, demo_service: service.id, usage_estimate: 'characters-divided-by-four' },
  } };
}

function* responseEvents(response) {
  let sequence = 0;
  const event = (type, data) => ({ type, sequence_number: sequence++, ...data });
  const initial = { ...response, status: 'in_progress', output: [], usage: null, incomplete_details: null };
  yield event('response.created', { response: initial });
  yield event('response.in_progress', { response: initial });
  const item = response.output[0];
  yield event('response.output_item.added', { output_index: 0, item: item.type === 'message' ? { ...item, status: 'in_progress', content: [] } : { ...item, status: 'in_progress', arguments: '' } });
  if (item.type === 'message') {
    const part = item.content[0];
    const ref = { item_id: item.id, output_index: 0, content_index: 0 };
    yield event('response.content_part.added', { ...ref, part: { ...part, text: '' } });
    const chars = Array.from(part.text);
    for (let index = 0; index < chars.length; index += 32) yield event('response.output_text.delta', { ...ref, delta: chars.slice(index, index + 32).join(''), logprobs: [] });
    yield event('response.output_text.done', { ...ref, text: part.text, logprobs: [] });
    yield event('response.content_part.done', { ...ref, part });
  } else {
    const ref = { item_id: item.id, output_index: 0 };
    yield event('response.function_call_arguments.delta', { ...ref, delta: item.arguments });
    yield event('response.function_call_arguments.done', { ...ref, name: item.name, arguments: item.arguments });
  }
  yield event('response.output_item.done', { output_index: 0, item });
  yield event(`response.${response.status}`, { response });
}

function normalizedServices(node, overrides, nonstreamOnly) {
  const defaults = defaultServicesForNode(node);
  const provided = overrides ?? [];
  if (!Array.isArray(provided)) throw new Error('services must be an array of default service ID overrides');
  for (const override of provided) if (!defaults.some((item) => item.id === override.id)) throw new Error('Unknown service override ID');
  const services = defaults.map((item) => {
    const override = provided.find((candidate) => candidate.id === item.id) ?? {};
    const safeOverrides = Object.fromEntries(['base', 'model', 'label', 'display_name', 'deployment', 'auth', 'streaming', 'ready', 'enabled'].filter((key) => Object.hasOwn(override, key)).map((key) => [key, override[key]]));
    const service = { ...item, ...safeOverrides, ...(node === 'C' && nonstreamOnly ? { streaming: false } : {}) };
    if (!['none', 'required'].includes(service.auth)) throw new Error('Service auth must be none or required');
    const originalModel = service.model === item.model;
    if (!originalModel) {
      if (!Object.hasOwn(override, 'display_name')) service.display_name = service.model;
      if (!Object.hasOwn(override, 'deployment')) delete service.deployment;
    }
    if (typeof service.display_name !== 'string' || !service.display_name.trim() || service.display_name.length > 256) throw new Error('Model display_name must contain 1 to 256 characters');
    // Refresh only known defaults in memory. Custom model/label/metadata values
    // remain authoritative; no runtime file or trust identity is rewritten.
    const legacyLabel = [item.responseLabel, item.legacyLabel].includes(override.label);
    if (!Object.hasOwn(override, 'label') || (originalModel && legacyLabel)) service.label = service.display_name.replaceAll('.', '-');
    else if (override.label !== item.label) service.responseLabel = override.label;
    if (typeof service.base !== 'string' || !(service.base === '/' || /^\/(?!\/)[^?#\\\s]*[^/]$/.test(service.base)) || service.base.split('/').some((part) => part === '.' || part === '..' || /%2e|%2f|%5c/i.test(part))) throw new Error('Invalid service base path');
    if (typeof service.model !== 'string' || !service.model.length || service.model.length > 256) throw new Error('Service model must contain 1 to 256 characters');
    if (typeof service.label !== 'string' || !service.label.length || service.label.length > 128) throw new Error('Service label must contain 1 to 128 characters');
    if (service.deployment !== undefined) {
      if (!service.deployment || typeof service.deployment !== 'object' || Array.isArray(service.deployment) || Object.keys(service.deployment).some(key => !['parameters', 'quantization', 'version'].includes(key))) throw new Error('Invalid model deployment metadata');
      for (const key of ['parameters', 'quantization', 'version']) if (typeof service.deployment[key] !== 'string' || !service.deployment[key].trim() || service.deployment[key].length > 64) throw new Error(`Deployment ${key} must contain 1 to 64 characters`);
      service.deployment = { ...service.deployment };
    }
    for (const key of ['streaming', 'ready', 'enabled']) if (typeof service[key] !== 'boolean') throw new Error(`${key} must be boolean`);
    return service;
  });
  if (new Set(services.map((item) => item.base)).size !== services.length) throw new Error('Services must have distinct base paths');
  return services;
}

/** No management HTTP endpoint is exposed. Readiness changes are trusted in-process operations. */
export function createMockServer(options = {}) {
  const node = String(options.node ?? 'A').toUpperCase();
  const services = normalizedServices(node, options.services, options.nonstreamOnly);
  const nodeLabel = options.nodeLabel ?? defaultNodeLabel(node);
  if (typeof nodeLabel !== 'string' || !nodeLabel.trim() || nodeLabel.length > 128) throw new Error('Node label must contain 1 to 128 characters');
  const tokens = Object.fromEntries(services.map((service) => [service.id, options.tokens?.[service.id] ?? options.token]));
  if (services.some(service => service.auth === 'required' && (typeof tokens[service.id] !== 'string' || !/^[\x21-\x7e]+$/.test(tokens[service.id])))) throw new Error('An explicit Bearer token is required for every auth:required service');
  // Correlation signatures are internal integrity checks, independent of whether
  // clients authenticate. Never publish these keys or use the client API key.
  const toolSigningKeys = Object.fromEntries(services.map(service => [service.id, randomBytes(32)]));
  if ((!options.tls?.key || !options.tls?.cert) && !options.allowHttp) throw new Error('TLS key and certificate are required. allowHttp is for isolated protocol tests only.');
  const events = new EventEmitter();
  const logger = options.logger ?? (() => {});
  const maxBodyBytes = options.maxBodyBytes ?? 8 * 1024 * 1024;
  const maxImageBytes = options.maxImageBytes ?? 5 * 1024 * 1024;
  const streamDelayMs = options.streamDelayMs ?? 4;
  const snapshot = (service) => structuredClone(service);
  const getService = (id) => {
    const service = services.find((item) => item.id === id);
    if (!service) throw new Error(`Unknown service ID: ${id}`);
    return service;
  };
  const handler = async (req, res) => {
    const requestId = `req_${randomUUID()}`;
    const start = Date.now();
    const log = { event: 'request', request_id: requestId, node, method: req.method };
    let logged = false;
    const finish = (cancelled = false) => {
      if (logged) return;
      logged = true;
      try { logger({ ...log, status: res.statusCode, duration_ms: Date.now() - start, cancelled }); } catch { /* Logging must not break requests. */ }
    };
    res.on('finish', () => finish());
    res.on('close', () => finish(!res.writableFinished));
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-llm-demo-mock', 'true');
    try {
      // Exact paths: no normalization, redirect, external fetch, or inferred /v1 prefix.
      const path = (req.url ?? '').split('?')[0];
      const service = services.find((item) => ['responses', 'models', '_demo/capabilities', '_llm/capabilities'].some((suffix) => path === `${item.base === '/' ? '' : item.base}/${suffix}`));
      if (!service) reject('not_found', 'Unknown Mock API route.', null, 404);
      Object.assign(log, { service_id: service.id });
      if (service.auth === 'required' && !authorized(req.headers.authorization, tokens[service.id])) {
        res.setHeader('www-authenticate', 'Bearer');
        reject('invalid_api_key', 'A valid service-specific experimental Bearer token is required.', null, 401);
      }
      if (!service.enabled || !service.ready) reject('service_unavailable', 'This Mock service is disabled or not ready.', null, 503);
      const suffix = path.slice(service.base === '/' ? 0 : service.base.length);
      log.operation = suffix;
      if (suffix === '/models' && req.method === 'GET') return sendJson(res, 200, { object: 'list', data: [{ id: service.model, name: service.display_name, object: 'model', created: 0, owned_by: 'llm-discovery-demo-mock' }] });
      if (['/_demo/capabilities', '/_llm/capabilities'].includes(suffix) && req.method === 'GET') {
        const document = capabilities(service, nodeLabel);
        if (suffix === '/_llm/capabilities') { document.schema = 'llm-api-discovery-capabilities/v1'; document.node_label = nodeLabel; delete document.demo_node_label; }
        return sendJson(res, 200, document);
      }
      if (suffix !== '/responses' || req.method !== 'POST') reject('method_not_allowed', 'Method not allowed for this API route.', null, 405);
      const body = await readJson(req, maxBodyBytes);
      const { response, info } = prepareResponse(body, service, node, toolSigningKeys[service.id], maxImageBytes);
      Object.assign(log, { model: service.model, input_types: info.inputTypes, response_id: response.id, stream: !!body.stream, response_status: response.status });
      if (!body.stream) return sendJson(res, 200, response);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
      res.flushHeaders();
      for (const event of responseEvents(response)) {
        if (res.destroyed) break;
        if (!res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) {
          await Promise.race([once(res, 'drain'), once(res, 'close')]);
        }
        if (streamDelayMs > 0) await delay(streamDelayMs);
      }
      if (!res.destroyed) res.end();
    } catch (error) {
      log.error_code = error instanceof ApiError ? error.code : 'internal_error';
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      const known = error instanceof ApiError;
      sendJson(res, known ? error.status : 500, { error: { message: known ? error.message : 'Internal Mock API error.', type: known && error.status < 500 ? 'invalid_request_error' : 'server_error', param: known ? error.param : null, code: log.error_code } });
    }
  };
  const server = options.tls?.key && options.tls?.cert ? https.createServer(options.tls, handler) : http.createServer(handler);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  const controller = {
    server, events,
    get services() { return services.map(snapshot); },
    getReadiness(id) { const service = getService(id); return service.enabled && service.ready; },
    setReady(id, ready) {
      if (typeof ready !== 'boolean') throw new Error('ready must be boolean');
      const service = getService(id); service.ready = ready;
      events.emit('readiness', { serviceId: id, ready: service.enabled && ready, service: snapshot(service) });
    },
    setEnabled(id, enabled) {
      if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
      const service = getService(id); service.enabled = enabled;
      events.emit(enabled ? 'enabled' : 'disabled', { serviceId: id, service: snapshot(service) });
      events.emit('readiness', { serviceId: id, ready: enabled && service.ready, service: snapshot(service) });
    },
    async listen(port = options.port ?? 0, host = options.host ?? '127.0.0.1') {
      server.listen(port, host);
      await once(server, 'listening');
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      for (const service of services) controller.setEnabled(service.id, false);
      const closed = new Promise((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
      server.closeIdleConnections();
      await closed;
    },
  };
  return controller;
}
