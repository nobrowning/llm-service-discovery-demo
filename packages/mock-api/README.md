# Mock API contract

This package uses Node.js built-ins and has no build step. It is a deterministic API fixture, not a language or vision model. It implements the Responses subset exercised by this demo, not a claim of full Open Responses conformance.

| Node | Service ID | Base | Model ID | Display name | Parameters | Quantization / precision | Authentication |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | `a-text` | `/text/v1` | `mock-text` | DeepSeek-R1-Distill-Qwen-32B | 32B | Q4_K_M | `none` |
| A | `a-vision` | `/vision/v1` | `mock-vision` | Qwen2.5-VL-7B-Instruct | 7B | BF16 | `required` |
| B | `b-tools` | `/v1` | `mock-tools` | GLM-4-9B-Chat | 9B | INT4 | `required` |
| C (optional fixture) | `c-basic` | `/api/v1` | `mock-basic` | Qwen3-8B | 8B | Q8_0 | `none` |

These are simulated deployment profiles, not running model weights or claims about official quantized packages. BF16 is a precision designation. The default lab starts only A and B: two containers with three services. Both Node A services display Studio Workstation; Node B displays the actual deployment IP (for example, `192.0.2.51`). Their protocol details show the generated `.local` hostnames, such as `llm-<runId>-a.local`. The documentation IP is a sanitized example. The actual IP and hostname come from the runtime configuration rather than fixed example values. Both containers share one WSL IP in lightweight mode, with ports and paths distinguishing the services. Showing an IP as a location does not change the hostname used for HTTPS connections or TLS identity validation. The module retains C for standalone and nonstream-only fixtures, but the default Compose deployment does not start it.

The request model IDs above remain unchanged. `/models` adds `name`; capabilities add `models[].display_name` and `deployment` with `parameters`, `quantization`, and `version`. Models remain explicitly marked as Mock, and response prefixes retain their Text/Vision/Tools/Basic API identity. Default DNS instance labels use the model name with dots changed to hyphens; the displayed model name retains its original spelling.

Every service independently exposes `GET {base}/models`, `GET {base}/_demo/capabilities` (also `/_llm/capabilities`), and `POST {base}/responses`. An `auth: 'none'` service accepts requests without a Key and does not inspect an accidentally supplied Authorization header; clients should omit that header. An `auth: 'required'` service checks its own Bearer token before returning models, capabilities, or inference. Missing, wrong, and another service's Key return HTTP 401 with `invalid_api_key`; sharing a host or certificate does not share authorization. Authentication is policy, not a model capability. There is no HTTP management endpoint, CORS bypass, server-side tool execution, or remote URL fetch.

## Module interface

```js
import { createMockServer } from './index.mjs';

const mock = createMockServer({
  node: 'A',
  host: '0.0.0.0',
  port: 18443,
  tls: { key: keyPem, cert: certPem },
  tokens: { 'a-vision': visionDemoKey }, // a-text is keyless; no token needed
  logger: entry => console.log(JSON.stringify(entry)),
});
await mock.listen();
mock.events.on('readiness', ({ serviceId, ready }) => { /* advertise/withdraw */ });
mock.setReady('a-text', false);
mock.setEnabled('a-text', false);
await mock.close();
```

`createMockServer()` does not listen automatically. Its return value exposes the native `server`, `events`, a copied `services` array, `listen(port?, host?)`, `close()`, `getReadiness(serviceId)`, `setReady(serviceId, boolean)`, and `setEnabled(serviceId, boolean)`. `getReadiness()` is true only when both ready and enabled. `readiness` events carry `{serviceId, ready, service}`; `enabled` and `disabled` events carry `{serviceId, service}`. The close operation disables all services before closing the listener.

Optional `services` is an array of overrides by default service ID. Supported fields are `base`, `model`, `label`, `display_name`, `deployment`, `auth`, `streaming`, `ready`, and `enabled`; a service's kind is fixed. `auth` accepts only `none` or `required`; unknown values, including explicit null/undefined, fail at startup. Omitting the override retains the table's mixed default. The lab runner supplies each manifest service's policy explicitly and treats a legacy manifest's missing `auth` as `required` until explicit migration. `display_name` is a nonempty string of at most 256 characters; the three deployment values are nonempty strings of at most 64 characters each. A custom model ID without explicit presentation data uses that ID as its display name and inherits no default deployment metadata. The optional `nodeLabel` overrides the machine display name. Known legacy service labels are refreshed only when the original Mock model ID still matches; custom labels and explicit metadata take priority. The runner does this in memory and never rewrites existing runtime or trust files.

Every required service needs a nonempty, printable ASCII token at startup; keyless services need none. The `token` option is an explicit fallback when no service-specific token is supplied, so do not use a common fallback when demonstrating distinct service keys. TLS is required for keyless and protected services alike. The default `maxBodyBytes` is 8 MiB, `maxImageBytes` 5 MiB, and `streamDelayMs` 4 ms. `allowHttp: true` is only for isolated protocol tests, not normal deployment.

## CLI

Run `node packages/mock-api/server.mjs` from the repository root. Configure:

- `MOCK_NODE`: `A`, `B`, or `C`; default `A`.
- `MOCK_NODE_LABEL`: optional machine display name.
- `MOCK_HOST`: listen interface; default `0.0.0.0`.
- `MOCK_PORT`: listen port; default `18443`.
- `MOCK_TLS_CERT`, `MOCK_TLS_KEY`: PEM file paths. TLS is required by default.
- `MOCK_TOKENS_FILE`: JSON object mapping required service IDs to tokens. Defaults need only `a-vision` on A, only `b-tools` on B, and no token file on C. Do not commit it.
- `MOCK_TOKEN_FILE` or `MOCK_TOKEN`: optional common token fallback. Prefer files.
- `MOCK_SERVICE_CONFIG_FILE`: optional JSON array of service overrides, including explicit `auth: "none"` or `auth: "required"`.
- `MOCK_NONSTREAM_ONLY=true`: switches C to the nonstream-only scenario.
- `MOCK_ALLOW_HTTP=true`: explicit isolated-test escape hatch, not normal deployment.

Use the lab controller for advertisement and per-service lifecycle coordination. Starting this CLI by itself does not publish DNS-SD records.

The CLI applies the same mixed defaults as the module: A/B fail before listening when their protected service lacks a Key; optional C can start with only TLS material. Switching C to `required` through a service override makes a Key mandatory. Startup and request logs do not include token values. To prepare the default three-state demo, the presenter copies GLM's synthetic Key from the ignored runtime's `presenter/demo-api-keys.txt` into Harness and saves it once, leaving Qwen-VL unconfigured. After restarting Harness, DeepSeek needs no key, GLM uses its saved key, and Qwen-VL waits for input. The client trust document does not prefill either key. See [the demonstration script](../../docs/demo-script.md) for migration, preparation and manual input.

## Supported response behavior

The server accepts `input` text or stateless message/item history. Both complete JSON and SSE responses have identifiable Mock node/service metadata. SSE includes monotonically numbered semantic events, completed message/tool items, argument completion, and a terminal `response.completed` or `response.incomplete`. Token usage is an explicitly marked character-count estimate, not actual model usage. A small `max_output_tokens` causes an incomplete text response instead of falsely reporting success.

For this demo only, `metadata.demo_context_indices` may contain a JSON-encoded array identifying client-declared Host context messages in the final `input` array. The value is limited to 512 bytes and 64 unique, in-range integer indices targeting text-only user messages. Those messages remain in the request and pass normal validation; they are excluded only when selecting deterministic echo text, deciding whether to request the marker tool, and identifying a new user turn. Tool call identity checks remain mandatory. Malformed annotations return `invalid_demo_context`. The older `demo_time_context_indices` alias is accepted alone; supplying both fields is rejected. This application convention is not an Open Responses or DNS-SD standard. The Harness adapter's exact producer allowlist is documented in [protocol-mapping.md](../../docs/protocol-mapping.md).

Vision accepts inline PNG, JPEG, GIF, and WebP data URLs, checks their container signature, and reports byte length and SHA-256; PNG/GIF dimensions are also reported. This is header/transport validation, not a complete image decoder or semantic visual analysis. A remote image URL or unsupported input modality is rejected.

The Tools service emits the fixed function `demo_read_marker` with `{}` only when the client supplies that function definition and requests the marker, or explicitly requires that function. It never reads the client fixture. The client sends the preceding `function_call` item and a matching `function_call_output` in its next input; the call ID is signed with a random, service-specific internal HMAC key generated for that server instance. This key is independent of the client API Key and remains required if the Tools service is configured as keyless. A wrong ID, missing originating call, nonempty arguments, or empty result is rejected. The actual client nonce appears only after it is received in a tool result. There is no hidden server conversation store; restarting the Mock server replaces its internal signing key and invalidates outstanding call IDs.

Unsupported features include `previous_response_id`, conversations, stored responses, background execution, arbitrary server-hosted tools, JSON mode/schema output constraints, audio/video, and remote image fetching. A service may ignore auto tool suggestions; it explicitly rejects a required unsupported tool. The C nonstream-only scenario rejects `stream:true` with `streaming_not_supported`; it does not imitate incremental inference using a single final response.

## Tests

Run `node --test tests/api/*.test.mjs`. The tests exercise mixed authentication (no Key, missing/wrong/cross-service/correct Key), protected metadata, standalone CLI startup, idempotent runtime migration, TLS identity, semantic SSE events, truncation, image bytes, tool roundtrip and independent HMAC checks, cancellation, lifecycle, custom bases, unsupported requests, and size limits. The TLS test uses the repository's `node-forge` fixture generator; the API runtime itself uses only built-in modules.
