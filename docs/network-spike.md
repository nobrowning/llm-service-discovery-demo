# Lightweight container-owned mDNS network spike

Status: **container-owned mDNS discovery and discovered-address HTTP passed**
using an isolated Docker daemon in the already installed Ubuntu WSL distribution.
Docker Desktop host networking failed the same discovery test on two Windows
interfaces. No Windows publisher, new VM, WSL networking-mode change or firewall
change was used for the successful route.

Addresses below are sanitized documentation examples, not deployment defaults.
The measured topology, timings, and results are retained; use the actual local
interface addresses when reproducing the experiment.

## Scope and constraints

- Windows runs only the receiver/discovery client.
- The Linux container owns both the mock API and the mDNS publisher.
- No Windows advertiser, cross-link reflector, container-only client substitution,
  new VM, or WSL networking change is part of this experiment.
- Only uniquely named `llm-discovery-spike-*` test containers may be created or
  removed. Existing containers are left untouched.
- The network helper does not carry inference traffic.

## Observations on 2026-11-02

- Docker Engine and CLI report 27.5.1; the lead agent identified Docker Desktop
  4.38.0 and Compose 2.32.4.
- The selected Windows LAN interface has example address
  `203.0.113.10/24`. WSL, Default Switch and VPN interfaces are not selected for the
  first test. The address shown here is sanitized, not a portable default.
- `.wslconfig` contains `networkingMode=nat` and remains unchanged.
- `settings-store.json` had no host-networking override key. An absent setting is
  not sufficient evidence of the effective UI setting.
- The lead agent subsequently checked the official Docker Desktop UI, confirmed
  **Enable host networking** was unchecked, enabled it, and used Apply & restart.
  No other Docker, WSL or security settings were changed for this experiment.
- Before that restart, `docker pull node:24-alpine` and `docker ps` returned an
  Internal Server Error from `dockerDesktopLinuxEngine` API v1.47. No spike
  container had been created.
- The first runner invocation reached the daemon but found no `node:24-alpine`
  image. It saved its failure evidence at
  `spikes/network/evidence/2026-11-02T07-04-01-801Z.jsonl` and did not start a
  container. This is an image prerequisite failure, not a multicast result.
- After restart, the engine recovered and `node:24-alpine` pulled successfully,
  with image digest
  `sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85`.
- After completing the experiments, the lead agent used the official Docker
  Desktop UI to uncheck **Enable host networking** and Apply & restart, restoring
  the original disabled setting. At `2026-11-02T08:54:29.279Z`, a read-only
  post-restoration check found all three dedicated-daemon containers still
  running and Windows resolved four valid services during an 8-second browse.
  That check used the isolated daemon's own CLI and did not start, stop or rebuild
  containers. The successful WSL route therefore remains operational with the
  Docker Desktop host-networking option disabled.

## Actual host-network results

| Windows multicast interface | Duration | Queries sent | Matching mDNS responses | Fixed-address HTTP health |
| --- | --- | --- | --- | --- |
| LAN interface `203.0.113.10` | 35 seconds | 12 | 0 | HTTP 200 at LAN IP and localhost |
| WSL virtual interface `192.0.2.1` | 35 seconds | 12 | 0 | HTTP 200 at WSL interface IP and localhost |

Evidence:

- `spikes/network/evidence/2026-11-02T07-05-45-104Z.jsonl`
- `spikes/network/evidence/2026-11-02T07-07-19-995Z.jsonl`

In each run the container successfully joined its multicast group and reported
12 successful send callbacks. Its visible non-loopback interfaces were
`services1=198.51.100.6` and `eth0=198.51.100.3`, not the Windows LAN or WSL
addresses. It did not log a Windows discovery query. A send callback is evidence
of local socket submission, not evidence of packet delivery to Windows.

Both test containers were stopped and removed by the runner. No other container
was touched. The receiver correctly binds UDP 5353 on `0.0.0.0` and selects the
specific interface through multicast membership and multicast-interface options.

These observations show that enabling Docker Desktop host networking alone did
not produce the required multicast path in this installation. They do not
establish that every Docker Desktop version or every alternative networking
configuration has the same behavior. The discovered-address HTTP stage never ran,
because no valid discovered candidate arrived.

## Successful existing-WSL route

The already installed Ubuntu distribution has `eth0=192.0.2.51/20`, on the
same subnet as Windows `vEthernet (WSL)=192.0.2.1/20`. It has no independently
installed `dockerd` binary or running daemon. Its `/usr/bin/docker` resolves to
Docker Desktop's injected CLI; running that CLI still uses the Desktop engine
and does not change the container's network namespace.

After implementation approval, the official Docker 27.5.1 static binaries were
downloaded from `https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz`.
Their archive SHA-256 is
`4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640`.
The Node image was exported from Desktop and loaded into the isolated engine,
avoiding a second image download.

The daemon runs only in `/var/tmp/llm-discovery-docker-0`, with its own Unix
socket, data directory, execution directory, pid and logs. It uses
`--bridge=none --iptables=false --ip6tables=false --ip-forward=false --ip-masq=false`.
There is no systemd installation, default-socket replacement, WSL shutdown,
mirrored-mode change or firewall change.

Evidence: `spikes/network/evidence/2026-11-02T07-13-37-024Z.jsonl`.

| Observation | Actual result |
| --- | --- |
| Container's visible interface | Ubuntu `eth0=192.0.2.51` |
| Windows receiver interface | WSL virtual interface `192.0.2.1` |
| Test duration | 35 seconds |
| Windows multicast queries sent | 12 |
| Container queries received from Windows | 11; the first query preceded container readiness |
| Windows matching responses received | 23 |
| Received record types | PTR, SRV, TXT, A |
| Discovered API call | HTTP 200 from `192.0.2.51:18081/v1/responses` |
| Container API request log | One matching synthetic request |

The first raw advertisement reached Windows at `2026-11-02T07:13:37.967Z` and
the discovered-address API response completed at `07:13:37.977Z`. This is one
observed run, not a latency guarantee. Subsequent request/response pairs confirm
the reverse multicast-query path as well as unsolicited announcement delivery.

The spike container was stopped and removed. The isolated daemon and its image
store remain available to the main implementation. `spikes/network/wsl-engine.sh`
provides start/status/load/stop/cleanup and a `docker` wrapper that always uses
the dedicated socket. Cleanup refuses unexpected running containers and checks
the exact runtime directory before removal. Full reproduction and cleanup
instructions are in `spikes/network/README.md`.

## Reproduction

```powershell
docker pull node:24-alpine
node spikes/network/run-spike.mjs <selected-Windows-non-loopback-IPv4>
```

The runner requires the image to be present, starts a Windows receiver bound to
the specified multicast interface, and creates one container using `--network
host`. It runs for 35 seconds, collects logs, stops/removes only its own uniquely
named container, and saves JSONL evidence under `spikes/network/evidence/`.

The exact implementation is in `spikes/network/README.md`. The DNS codec is a
limited feasibility probe, not a replacement for a production DNS-SD library.

## Pass criteria and evidence boundaries

1. Windows receives the container's raw mDNS response containing PTR, SRV, TXT and
   A records for the spike service.
2. The receiver derives the API destination from those received records and
   receives HTTP 200 plus the synthetic response from `POST /v1/responses`.
3. Container logs corroborate multicast publication and the API request. A
   received query is useful evidence of the reverse discovery path.
4. No host publisher or static service list supplies the discovered candidate.

Fixed-address `/healthz` requests are explicitly logged as diagnostics and do
not count as discovered API success. The receiver connects to the discovered A
record while retaining the advertised hostname in HTTP Host. This does not yet
test Windows system `.local` resolution, TLS, trust, Harness integration, or
full mDNS conflict/lifecycle behavior.

The JSONL contains application-observed datagram bytes, not an OS-level pcap.
Docker Desktop accepting host mode or forwarding ordinary TCP/UDP does not by
itself establish that mDNS multicast crosses the Windows boundary.

The successful host-network nodes share Ubuntu's address and use distinct
listeners/base paths. Independent virtual LAN IPs remain a separate milestone.
