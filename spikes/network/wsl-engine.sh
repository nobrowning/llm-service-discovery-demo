#!/bin/sh
# Dedicated experimental daemon inside the existing Ubuntu WSL namespace.
# No default Docker socket, package installation, systemd or firewall changes.
set -eu
TASK_UID="$(id -u)"
[ "$TASK_UID" = 0 ] || { echo 'Run this helper as root in the existing WSL distro.' >&2; exit 1; }
RUNTIME="/var/tmp/llm-discovery-docker-$TASK_UID"
BIN="$RUNTIME/bin/docker"
SOCKET="$RUNTIME/docker.sock"
MARKER="$RUNTIME/.llm-discovery-isolated-runtime"
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
ARCHIVE="$SCRIPT_DIR/.runtime/docker-27.5.1.tgz"
IMAGE_TAR="$SCRIPT_DIR/.runtime/node-24-alpine.tar"

cli() {
  env -u DOCKER_CONTEXT -u DOCKER_HOST -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    DOCKER_CONFIG="$SCRIPT_DIR/.runtime/docker-cli" \
    "$BIN/docker" --host "unix://$SOCKET" "$@"
}
owned_runtime() {
  [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = 'llm-service-discovery-network-spike-v1' ] || {
    echo "Refusing unmarked runtime directory: $RUNTIME" >&2; exit 1;
  }
}
case "${1:-status}" in
  start)
    if [ -d "$RUNTIME" ]; then owned_runtime; else
      umask 077
      mkdir -p "$RUNTIME"
      printf '%s\n' 'llm-service-discovery-network-spike-v1' > "$MARKER"
    fi
    mkdir -p "$RUNTIME/bin" "$RUNTIME/data" "$RUNTIME/exec"
    if [ ! -x "$BIN/dockerd" ]; then
      [ -f "$ARCHIVE" ] || { echo "Missing official static archive: $ARCHIVE" >&2; exit 1; }
      printf '%s  %s\n' '4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640' "$ARCHIVE" | sha256sum -c -
      tar -xzf "$ARCHIVE" -C "$RUNTIME/bin"
    fi
    if [ -S "$SOCKET" ] && [ "$(cli info --format '{{.DockerRootDir}}' 2>/dev/null)" = "$RUNTIME/data" ]; then
      printf 'Already running: %s\n' "$SOCKET"; exit 0
    fi
    printf '{}\n' > "$RUNTIME/daemon.json"
    PATH="$BIN:$PATH" nohup "$BIN/dockerd" \
      --config-file="$RUNTIME/daemon.json" \
      --host="unix://$SOCKET" --group=root \
      --data-root="$RUNTIME/data" --exec-root="$RUNTIME/exec" \
      --pidfile="$RUNTIME/dockerd.pid" \
      --bridge=none --iptables=false --ip6tables=false \
      --ip-forward=false --ip-masq=false --userland-proxy=false \
      --exec-opt=native.cgroupdriver=cgroupfs \
      > "$RUNTIME/dockerd.log" 2>&1 < /dev/null &
    attempts=0
    until [ -S "$SOCKET" ] && [ "$(cli info --format '{{.DockerRootDir}}' 2>/dev/null)" = "$RUNTIME/data" ]; do
      attempts=$((attempts + 1))
      if [ "$attempts" -ge 30 ]; then tail -n 35 "$RUNTIME/dockerd.log"; exit 1; fi
      sleep 1
    done
    cli info --format '{{.ServerVersion}}'
    printf 'Ready: %s\n' "$SOCKET"
    ;;
  load)
    owned_runtime
    cli image load -i "$IMAGE_TAR"
    ;;
  docker)
    owned_runtime
    shift
    cli "$@"
    ;;
  status)
    owned_runtime
    cli info --format 'Version={{.ServerVersion}} Root={{.DockerRootDir}}'
    cli ps --format '{{.Names}} {{.Status}}'
    ;;
  stop)
    owned_runtime
    if cli info >/dev/null 2>&1; then
      names="$(cli ps --format '{{.Names}}')"
      if printf '%s\n' "$names" | grep -v '^$' | grep -v '^llm-discovery-spike-' >/dev/null; then
        echo 'Refusing to stop: isolated daemon has a running container outside the spike prefix.' >&2; exit 1
      fi
      ids="$(cli ps -q --filter name=llm-discovery-spike-)"
      if [ -n "$ids" ]; then cli stop -t 2 $ids; fi
    fi
    if [ -f "$RUNTIME/dockerd.pid" ]; then
      pid="$(cat "$RUNTIME/dockerd.pid")"
      case "$pid" in ''|*[!0-9]*) echo 'Invalid owned pid file' >&2; exit 1;; esac
      if [ -r "/proc/$pid/cmdline" ]; then
        tr '\000' ' ' < "/proc/$pid/cmdline" | grep -F -- "--data-root=$RUNTIME/data" >/dev/null || {
          echo 'Refusing to stop an unverified process' >&2; exit 1;
        }
        kill -TERM "$pid"
        attempts=0
        while kill -0 "$pid" 2>/dev/null; do
          attempts=$((attempts + 1)); [ "$attempts" -le 30 ] || { echo 'Daemon has not stopped; runtime retained.' >&2; exit 1; }
          sleep 1
        done
      fi
    fi
    printf 'Stopped; files retained at %s\n' "$RUNTIME"
    ;;
  cleanup)
    owned_runtime
    # Verify the exact absolute target before recursively deleting our own runtime.
    [ "$(readlink -f "$RUNTIME")" = '/var/tmp/llm-discovery-docker-0' ] || {
      echo 'Refusing unexpected cleanup target' >&2; exit 1;
    }
    sh "$0" stop
    [ ! -S "$SOCKET" ] || { echo 'Socket still exists; runtime retained.' >&2; exit 1; }
    rm -rf -- /var/tmp/llm-discovery-docker-0
    echo 'Removed only /var/tmp/llm-discovery-docker-0; workspace downloads retained.'
    ;;
  *) echo 'Usage: wsl-engine.sh start|load|status|docker <args>|stop|cleanup' >&2; exit 1;;
esac
