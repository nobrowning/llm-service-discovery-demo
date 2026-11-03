# Container-owned mDNS network spike

This bounded experiment keeps the publisher in a Linux container and the receiver
in Windows. It never starts a Windows publisher, edits system settings, restarts
Docker, or creates a VM. It uses a small dependency-free DNS codec solely for
network feasibility, not as a production mDNS implementation.

Prerequisites: Node on Windows, healthy Docker Desktop, and the `node:24-alpine`
image already present. Docker Desktop host networking may require enabling its
official setting and restarting Desktop; this script never performs that change.
`--network host` being accepted is not proof that Windows multicast is bridged.

```powershell
docker pull node:24-alpine
node spikes/network/run-spike.mjs <Windows-non-loopback-interface-IPv4>
```

The receiver joins `224.0.0.251:5353` on exactly the selected Windows interface.
The container announces PTR, SRV, TXT and A records, and serves a synthetic HTTP
`POST /v1/responses` endpoint. Only after receiving those records does the receiver
request that discovered endpoint. The HTTP client connects to the discovered A
record while retaining the advertised hostname in Host: this experiment does not
claim to verify Windows system `.local` resolution or HTTPS.

The script starts only its uniquely named `llm-discovery-spike-*` container, runs
the receiver for 35 seconds, collects its logs, and stops/removes that container.
JSONL evidence distinguishes raw mDNS datagrams from fixed-address `/healthz`
diagnostics. Health success alone is not a discovery pass. Raw packet payloads
are retained as hexadecimal; these application-level observations are not pcap.

A pass requires all four record types received by Windows and a successful API
response to the discovered address. If the engine, image, host-network setting,
firewall or multicast path blocks the experiment, retain the evidence and report
the boundary. Do not substitute static lists, a Windows advertiser, or a
container-only receiver.

The advertised address must be a real selected host/virtual-interface address,
never `127.0.0.1`. Multiple host-mode containers would share that address and use
different ports; this topology does not simulate independent LAN IP addresses.

## Verified existing-WSL route

Docker Desktop host networking did not deliver mDNS in the tested installation.
The successful route uses a separate temporary Docker 27.5.1 daemon inside the
already installed Ubuntu WSL distribution, sharing Ubuntu's network namespace.
It preserves WSL NAT mode and changes no firewall or forwarding settings. It does
not use a Windows publisher or a new VM.

Prepare the official static binary archive and export the Node image from the
working Desktop engine. The local download directory is gitignored:

```powershell
New-Item -ItemType Directory -Force spikes/network/.runtime | Out-Null
Invoke-WebRequest https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz -OutFile spikes/network/.runtime/docker-27.5.1.tgz
docker pull node:24-alpine
docker image save -o spikes/network/.runtime/node-24-alpine.tar node:24-alpine
wsl -d Ubuntu -u root --exec sh /mnt/c/path/to/llm-service-discovery-demo/spikes/network/wsl-engine.sh start
wsl -d Ubuntu -u root --exec sh /mnt/c/path/to/llm-service-discovery-demo/spikes/network/wsl-engine.sh load
$env:SPIKE_DOCKER_BACKEND = 'wsl'
$env:SPIKE_ADVERTISE_IPV4 = '<Ubuntu-eth0-IPv4>'
node spikes/network/run-spike.mjs <Windows-WSL-interface-IPv4>
```

Replace the repository path and both addresses for the actual machine. For the
sanitized documentation example, Ubuntu is `192.0.2.51/20` and Windows' WSL interface is
`192.0.2.1/20`; WSL addresses can change after a restart. The runner derives
the WSL `/mnt/<drive>/...` bind-mount path from its own Windows location.

`wsl-engine.sh` verifies the downloaded archive against the recorded SHA-256 and
starts only the explicitly owned runtime `/var/tmp/llm-discovery-docker-0`.
Its API socket, data, execution state, pid and logs are separate from Desktop
and the default Docker socket. Bridge networking, iptables/ip6tables changes,
IP forwarding and masquerading are disabled. No systemd service is installed.

The helper accepts `status`, `docker <args>`, `stop`, and `cleanup`. For example:

```powershell
wsl -d Ubuntu -u root --exec sh /mnt/c/path/to/llm-service-discovery-demo/spikes/network/wsl-engine.sh status
wsl -d Ubuntu -u root --exec sh /mnt/c/path/to/llm-service-discovery-demo/spikes/network/wsl-engine.sh stop
```

`stop` keeps images and data for a subsequent `start`. `cleanup` first stops the
owned daemon, verifies the exact absolute runtime path and its marker, then
removes that runtime. It keeps workspace downloads/evidence. Both refuse to stop
a daemon with running containers outside the `llm-discovery-spike-*` prefix;
bring any full demo stack down explicitly before using them. Do not run cleanup
while another part of the demo is using this daemon.
