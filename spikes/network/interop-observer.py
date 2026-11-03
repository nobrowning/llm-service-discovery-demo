"""Independent, browse-only Windows DNS-SD observer; never advertises a service."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata
import json
import platform
import threading
import time
from pathlib import Path

from zeroconf import IPVersion, ServiceBrowser, ServiceListener, Zeroconf

SERVICE_TYPE = "_llm-api._tcp.local."
SAFE_TXT_KEYS = {"txtvers", "api", "protovers", "scheme", "base", "auth"}


class Observer(ServiceListener):
    def __init__(self) -> None:
        self.services: dict[str, dict] = {}
        self.events: list[dict] = []
        self.lock = threading.Lock()

    def resolve(self, zc: Zeroconf, type_: str, name: str, event: str) -> None:
        info = zc.get_service_info(type_, name, timeout=4000)
        if info is None:
            with self.lock:
                self.events.append({"event": "resolution_timeout", "instance_sha256": hashlib.sha256(name.encode()).hexdigest()})
            return
        properties = {key.decode("utf-8", "replace"): value.decode("utf-8", "replace") if value else "" for key, value in info.properties.items()}
        # Retain only public protocol fields; omit real hostnames, instance suffixes,
        # interface addresses, credentials and application-local configuration.
        record = {
            "instance_sha256": hashlib.sha256(name.encode()).hexdigest(),
            "port": info.port,
            "txt": {key: value for key, value in properties.items() if key in SAFE_TXT_KEYS},
            "has_srv_target": bool(info.server),
            "ipv4_address_count": len(info.parsed_addresses(IPVersion.V4Only)),
            "unknown_txt_keys_omitted": len(set(properties) - SAFE_TXT_KEYS),
        }
        with self.lock:
            self.services[name] = record
            self.events.append({"event": event, "instance_sha256": record["instance_sha256"]})

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.resolve(zc, type_, name, "added")

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.resolve(zc, type_, name, "updated")

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        with self.lock:
            self.services.pop(name, None)
            self.events.append({"event": "removed", "instance_sha256": hashlib.sha256(name.encode()).hexdigest()})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interface", required=True)
    parser.add_argument("--seconds", type=int, default=20)
    parser.add_argument("--expected", type=int, default=4)
    parser.add_argument("--output", default="artifacts/interop.json")
    args = parser.parse_args()
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    observer = Observer()
    zc = Zeroconf(interfaces=[args.interface], ip_version=IPVersion.V4Only)
    browser = ServiceBrowser(zc, SERVICE_TYPE, observer)
    try:
        time.sleep(args.seconds)
    finally:
        browser.cancel()
        zc.close()
    with observer.lock:
        services = sorted(observer.services.values(), key=lambda item: (item["port"], item["txt"].get("base", "")))
        events = list(observer.events)
    complete = all(item["has_srv_target"] and item["ipv4_address_count"] > 0 and {"txtvers", "api", "protovers", "scheme", "base"} <= set(item["txt"]) for item in services)
    passed = len(services) == args.expected and complete
    result = {
        "schema": "llm-discovery-interop-observation/v1",
        "started_at_utc": started,
        "duration_seconds": args.seconds,
        "observer": {"implementation": "python-zeroconf", "version": importlib.metadata.version("zeroconf"), "python": platform.python_version(), "platform": platform.system(), "mode": "browse-and-resolve-only", "publisher_started": False, "inference_requests_sent": 0},
        "service_type": SERVICE_TYPE,
        "expected_services": args.expected,
        "resolved_services": len(services),
        "required_records_resolved": complete,
        "passed": passed,
        "redaction": "Real IP addresses, hostnames, instance names/suffixes and local paths omitted; instance identity represented by SHA-256; only standard public TXT fields retained.",
        "scope": "Independent implementation observed DNS-SD browse/resolve. This is not an inference, Harness, trust, TLS or lifecycle test.",
        "services": services,
        "events": events,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": passed, "resolved_services": len(services), "output": str(output)}))
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
