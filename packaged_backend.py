"""Frozen Mac backend. Stdout is JSON lines; diagnostics go to stderr."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import platform
import signal
import sys
import threading

from launcher_assets import Installation, SetupError, prepare
from live import create_server
from magenta_runtime import MagentaRuntime


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}), flush=True)


def main():
    if getattr(sys, 'frozen', False):
        import certifi
        os.environ['SSL_CERT_FILE'] = certifi.where()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True)
    parser.add_argument('--state', type=Path, default=Path.home() / 'Library/Application Support/Dance2Music')
    parser.add_argument('--logs', type=Path, default=Path.home() / 'Library/Logs/Dance2Music')
    parser.add_argument('--parent-pid', type=int)
    parser.add_argument('--repair', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    server = runtime = lock = None
    stopped = threading.Event()

    def terminate(*_):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    # The launcher owns this process group; every native worker inherits it.
    if os.getpgrp() != os.getpid():
        os.setsid()
    if args.parent_pid:
        def watch_parent():
            while not stopped.wait(.5):
                if os.getppid() != args.parent_pid:
                    os.killpg(os.getpgrp(), signal.SIGTERM)
                    return
        threading.Thread(target=watch_parent, daemon=True).start()
    try:
        if platform.system() != 'Darwin' or platform.machine() != 'arm64' or int(platform.mac_ver()[0].split('.')[0]) < 14:
            raise SetupError('unsupported_mac', 'Dance2Music requires Apple Silicon and macOS 14 or later.')
        args.state.mkdir(parents=True, exist_ok=True)
        args.logs.mkdir(parents=True, exist_ok=True)
        lock = (args.state / 'launcher.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError('already_running', 'Dance2Music is already running. Open its existing window or Quit it before retrying.')
        installation = Installation(args.resources, args.state)
        installation.verify_binaries()
        runtime = MagentaRuntime(args.state, installation_check=installation.installation, log_root=args.logs)
        if not args.verify_only:
            try:
                server = create_server(args.resources / 'web', runtime, browser_root=args.state / 'browser', packaged=True)
            except OSError as error:
                raise SetupError('port_in_use', 'Cannot use 127.0.0.1:5092. Close the app using that port, then choose Retry. No other process was stopped.') from error
        if not args.verify_only:
            prepare(args.state, installation.files, installation.markers, emit, repair=args.repair)
        installation.installation()
        emit('ready', url='http://127.0.0.1:5092/live/')
        if server:
            server.serve_forever(poll_interval=.2)
        return 0
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        emit('error', code=getattr(error, 'code', 'setup_failed'), message=str(error))
        print(f'{type(error).__name__}: {error}', file=sys.stderr, flush=True)
        return 1
    finally:
        stopped.set()
        if runtime:
            runtime.stop(shutdown=True)
        if server:
            server.server_close()
        if lock:
            lock.close()


if __name__ == '__main__':
    raise SystemExit(main())
