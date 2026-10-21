"""Local bridge boundaries, without loading a model or accessing the network."""
import base64
import io
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from magenta_runtime import MagentaRuntime, MAX_MESSAGE, read_exact, read_websocket, websocket_frame, write_exact


class Partial(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 3))

    def write(self, value):
        return super().write(value[:3])


def masked(payload, opcode=1):
    frame = bytearray(websocket_frame(opcode, payload))
    header = 2 if len(payload) < 126 else 4 if len(payload) < 65536 else 10
    frame[1] |= 128
    key = b'1234'
    return bytes(frame[:header]) + key + bytes(v ^ key[i % 4] for i, v in enumerate(payload))


class Handler:
    def __init__(self, path, **headers):
        self.path = path
        self.headers = {'Host': '127.0.0.1:5092', **headers}
        self.server = SimpleNamespace(server_port=5092)
        self.wfile = io.BytesIO()
        self.status = None

    def send_error(self, status, message):
        self.status = status

    def send_response(self, status):
        self.status = status

    def send_header(self, *_):
        pass

    def end_headers(self):
        pass


class RuntimeTests(unittest.TestCase):
    def test_partial_ipc_and_websocket(self):
        payload = bytes(range(256)) * 500
        self.assertEqual(read_exact(Partial(payload), len(payload)), payload)
        out = Partial()
        write_exact(out, payload)
        self.assertEqual(out.getvalue(), payload)
        for size in (0, 125, 126, 65535, 65536):
            self.assertEqual(read_websocket(Partial(masked(payload[:size], 2))), (2, payload[:size]))
        with self.assertRaises(EOFError):
            read_websocket(Partial(masked(b'hello')[:-1]))

    def test_invalid_frames_rejected_before_allocation(self):
        for frame in (websocket_frame(1, b'unmasked'), b'\x01\x80', b'\xc1\x80',
                      b'\x81\xff' + struct.pack('!Q', MAX_MESSAGE + 1),
                      b'\x89\xfe' + struct.pack('!H', 126)):
            with self.assertRaises(ValueError):
                read_websocket(io.BytesIO(frame))

    def test_origin_host_and_token_required(self):
        runtime = MagentaRuntime()
        runtime.installation = lambda: (None, None, {'verified': True})
        for headers in ({}, {'X-D2M-Local': '1', 'Origin': 'https://example.com'},
                        {'X-D2M-Local': '1', 'Host': 'example.com:5092'}):
            handler = Handler('/magenta/status', **headers)
            self.assertTrue(runtime.handle(handler))
            self.assertEqual(handler.status, 403)
        handler = Handler('/magenta/status', **{'X-D2M-Local': '1'})
        runtime.handle(handler)
        self.assertEqual(json.loads(handler.wfile.getvalue())['token'], runtime.token)
        for origin, token in ((None, runtime.token), ('http://127.0.0.1:5092', 'bad'),
                              ('https://example.com', runtime.token)):
            handler = Handler('/magenta/ws?token=' + token, Origin=origin)
            runtime.handle(handler)
            self.assertEqual(handler.status, 403)

    def test_invalid_handshake_ids_and_model(self):
        runtime = MagentaRuntime()
        headers = {'Origin': 'http://127.0.0.1:5092', 'Upgrade': 'websocket',
                   'Connection': 'keep-alive,Upgrade', 'Sec-WebSocket-Version': '13',
                   'Sec-WebSocket-Key': base64.b64encode(b'0123456789abcdef').decode()}
        for parameters in ('session=0&generation=1&model=base',
                           'session=1&generation=4294967296&model=base',
                           'session=1&generation=1&model=../model'):
            handler = Handler('/magenta/ws?token=' + runtime.token + '&' + parameters, **headers)
            runtime.handle(handler)
            self.assertEqual(handler.status, 400)

    def test_incomplete_installation_is_not_offline_ready(self):
        runtime = MagentaRuntime()
        def unavailable():
            raise RuntimeError('Missing or corrupt model')
        runtime.installation = unavailable
        handler = Handler('/magenta/status', **{'X-D2M-Local': '1'})
        runtime.handle(handler)
        result = json.loads(handler.wfile.getvalue())
        self.assertFalse(result['ready'])
        self.assertNotIn('token', result)
        self.assertIn('corrupt', result['message'])


if __name__ == '__main__':
    unittest.main()
