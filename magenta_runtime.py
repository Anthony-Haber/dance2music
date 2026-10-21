"""Local-only WebSocket/stdio bridge for the process-isolated native MRT2 host.

There is no download or alternate generator in the session path. A separate
helper process per session makes Cancel/Stop reclaim all native/GPU resources,
including upstream background encoding jobs.
"""
import base64
import hashlib
import hmac
import json
from pathlib import Path
import queue
import secrets
import struct
import subprocess
import threading
from urllib.parse import parse_qs, urlsplit

from magenta_assets import DEFAULT_ROOT, sha256, verify

MAX_MESSAGE = 1024 * 1024


def read_exact(stream, size):
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size - len(chunks))
        if not chunk:
            raise EOFError('Local connection closed')
        chunks.extend(chunk)
    return bytes(chunks)


def write_exact(stream, data):
    remaining = memoryview(data)
    while remaining:
        written = stream.write(remaining)
        if not written:
            raise EOFError('Helper pipe closed')
        remaining = remaining[written:]


def read_websocket(stream):
    first, second = read_exact(stream, 2)
    opcode = first & 15
    if first & 0x70 or not first & 0x80 or not second & 0x80 or opcode not in (1, 2, 8, 9, 10):
        raise ValueError('Unsupported WebSocket frame')
    length = second & 127
    if length == 126:
        length, = struct.unpack('!H', read_exact(stream, 2))
    elif length == 127:
        length, = struct.unpack('!Q', read_exact(stream, 8))
    if length > MAX_MESSAGE or (opcode >= 8 and length > 125):
        raise ValueError('WebSocket frame too large')
    mask = read_exact(stream, 4)
    payload = read_exact(stream, length)
    return opcode, bytes(v ^ mask[i % 4] for i, v in enumerate(payload))


def websocket_frame(opcode, payload):
    length = len(payload)
    header = bytes((0x80 | opcode, length)) if length < 126 else (
        bytes((0x80 | opcode, 126)) + struct.pack('!H', length) if length < 65536 else
        bytes((0x80 | opcode, 127)) + struct.pack('!Q', length))
    return header + payload


class MagentaRuntime:
    def __init__(self, root=DEFAULT_ROOT, *, installation_check=None, log_root=None):
        self.root = Path(root)
        self.installation_check = installation_check
        self.log_root = Path(log_root) if log_root is not None else self.root / 'logs'
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.process_lock = threading.Lock()
        self.closing = False
        self.process = None

    def installation(self):
        if self.installation_check is not None:
            return self.installation_check()
        receipt = self.root / 'installation.json'
        if not receipt.is_file():
            raise RuntimeError('MRT2 is not installed. Run python live.py --offline with internet before the session.')
        installed = json.loads(receipt.read_text())
        if installed.get('manifest_sha256') != sha256(Path(__file__).parent / 'native/magenta/manifest.lock.json'):
            raise RuntimeError('MRT2 installation does not match this version; prepare offline assets again.')
        for name in ('helper.cpp', 'CMakeLists.txt', 'embedding.patch'):
            if installed.get('native_sources', {}).get(name) != sha256(Path(__file__).parent / 'native/magenta' / name):
                raise RuntimeError('MRT2 helper source changed; prepare offline assets again to rebuild it.')
        binary = self.root / 'build-native/mrt2_helper'
        if not binary.is_file() or sha256(binary) != installed.get('helper_sha256'):
            raise RuntimeError('MRT2 helper is missing or corrupt; prepare offline assets again.')
        metallib = binary.with_name('mlx.metallib')
        if not metallib.is_file() or sha256(metallib) != installed.get('metallib_sha256'):
            raise RuntimeError('MRT2 Metal shader library is missing or corrupt; prepare offline assets again.')
        assets = Path(installed['asset_root'])
        missing = verify(assets)
        if missing:
            raise RuntimeError('MRT2 assets missing or corrupt: ' + ', '.join(missing))
        return binary, assets, installed

    def stop(self, shutdown=False):
        with self.process_lock:
            self.closing |= shutdown
            process = self.process
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

    def handle(self, handler):
        path = urlsplit(handler.path)
        if path.path not in ('/magenta/status', '/magenta/ws'):
            return False
        authority = handler.headers.get('Host', '')
        allowed = {f'127.0.0.1:{handler.server.server_port}', f'localhost:{handler.server.server_port}'}
        origin = handler.headers.get('Origin')
        if authority not in allowed or (origin and origin != 'http://' + authority):
            handler.send_error(403, 'Application origin required')
            return True
        if path.path == '/magenta/status':
            if handler.headers.get('X-D2M-Local') != '1':
                handler.send_error(403, 'Same-origin application request required')
                return True
            try:
                _, _, installed = self.installation()
                result = {'ready': True, 'token': self.token, 'provenance': installed}
            except (OSError, ValueError, RuntimeError, KeyError) as error:
                result = {'ready': False, 'message': str(error)}
            payload = json.dumps(result).encode()
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/json')
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('Content-Length', str(len(payload)))
            handler.end_headers()
            handler.wfile.write(payload)
            return True
        query = parse_qs(path.query)
        token = query.get('token', [''])[0]
        if origin != 'http://' + authority or not token.isascii() or not hmac.compare_digest(token, self.token):
            handler.send_error(403, 'Application session token required')
            return True
        try:
            key = handler.headers['Sec-WebSocket-Key']
            if (handler.headers.get('Upgrade', '').lower() != 'websocket'
                    or 'upgrade' not in [v.strip() for v in handler.headers.get('Connection', '').lower().split(',')]
                    or handler.headers.get('Sec-WebSocket-Version') != '13'
                    or len(base64.b64decode(key, validate=True)) != 16):
                raise ValueError('Invalid WebSocket handshake')
            session = int(query['session'][0])
            generation = int(query['generation'][0])
            model = query['model'][0]
            if not (0 < session < 2**32 and 0 < generation < 2**32) or model not in ('base', 'small'):
                raise ValueError('Invalid model/session')
            binary, assets, _ = self.installation()
        except (ValueError, KeyError, TypeError, RuntimeError, OSError) as error:
            handler.send_error(400, str(error))
            return True
        if not self.lock.acquire(blocking=False):
            handler.send_error(409, 'Another MRT2 session is running')
            return True
        process = None
        threads = []
        closed = threading.Event()
        output_done = threading.Event()
        outgoing = queue.Queue(maxsize=25)  # no more than 500 ms of PCM
        # Credit spans TCP, the browser's event queue, and its Worklet port.
        # A stalled browser can retain at most five unacknowledged PCM blocks.
        in_flight = set()
        credit_lock = threading.Lock()
        try:
            accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            handler.send_response(101)
            handler.send_header('Upgrade', 'websocket')
            handler.send_header('Connection', 'Upgrade')
            handler.send_header('Sec-WebSocket-Accept', accept)
            handler.end_headers()
            handler.close_connection = True
            handler.connection.settimeout(5)
            logdir = self.log_root
            logdir.mkdir(parents=True, exist_ok=True)
            with self.process_lock, (logdir / 'latest.log').open('wb') as log:
                if self.closing:
                    raise RuntimeError('Local service is shutting down')
                process = subprocess.Popen([str(binary), str(assets), model, str(session), str(generation)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, bufsize=0)
                self.process = process

            def output():
                try:
                    while not closed.is_set():
                        size, = struct.unpack('<I', read_exact(process.stdout, 4))
                        if not 1 < size <= MAX_MESSAGE:
                            raise ValueError('Invalid helper packet')
                        payload = read_exact(process.stdout, size)
                        if payload[:1] not in (b'J', b'P'):
                            raise ValueError('Invalid helper packet type')
                        if payload[:1] == b'P':
                            sequence, = struct.unpack_from('<I', payload, 13)
                            with credit_lock:
                                if len(in_flight) >= 5:
                                    continue  # consume/drop old native output, preserving live time
                                in_flight.add(sequence)
                        try:
                            outgoing.put_nowait((1 if payload[:1] == b'J' else 2, payload[1:]))
                        except queue.Full:
                            # Close a blocked peer; never accumulate output latency.
                            raise RuntimeError('Playback transport stalled')
                except EOFError:
                    pass  # Drain the final native status/error before closing.
                except (OSError, RuntimeError, ValueError):
                    closed.set()
                finally:
                    output_done.set()

            def sender():
                try:
                    while not closed.is_set():
                        try:
                            opcode, payload = outgoing.get(timeout=.1)
                        except queue.Empty:
                            if output_done.is_set():
                                break
                            continue
                        handler.connection.sendall(websocket_frame(opcode, payload))
                except OSError:
                    closed.set()
                finally:
                    closed.set()
                    try:
                        handler.connection.shutdown(2)
                    except OSError:
                        pass

            threads = [threading.Thread(target=fn, daemon=True) for fn in (output, sender)]
            for thread in threads:
                thread.start()
            while not closed.is_set():
                opcode, payload = read_websocket(handler.rfile)
                if opcode == 8:
                    break
                if opcode == 9:
                    outgoing.put_nowait((10, payload))
                    continue
                if opcode == 10:
                    continue
                if opcode == 1:
                    value = json.loads(payload)
                    if not isinstance(value, dict) or value.get('session') != session or value.get('generation') != generation:
                        continue
                    if value.get('type') == 'output-ack':
                        sequence = value.get('sequence')
                        if isinstance(sequence, int):
                            with credit_lock:
                                in_flight.discard(sequence)
                        continue
                    message = b'J' + payload
                else:
                    if len(payload) < 32 or payload[:4] != b'D2M2' or struct.unpack_from('<II', payload, 4) != (session, generation):
                        continue
                    rate, frames = struct.unpack_from('<II', payload, 24)
                    if rate != 48000 or frames > 4800 or len(payload) != 32 + frames * 8:
                        raise ValueError('Invalid PCM dimensions')
                    message = b'P' + payload
                write_exact(process.stdin, struct.pack('<I', len(message)) + message)
        except (OSError, EOFError, ValueError, RuntimeError, queue.Full):
            pass
        finally:
            closed.set()
            if process is not None:
                self.stop()
                for thread in threads:
                    thread.join(timeout=1)
                process.stdin.close()
                process.stdout.close()
            self.process = None
            self.lock.release()
        return True
