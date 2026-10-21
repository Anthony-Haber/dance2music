"""Real native helper smoke/latency gate with concurrent PCM and control traffic."""
import argparse
import json
from pathlib import Path
import queue
import statistics
import struct
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from magenta_runtime import read_exact, write_exact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--helper', type=Path, default=ROOT / '.magenta/build-native/mrt2_helper')
    parser.add_argument('--model', choices=('small', 'base'), default='small')
    parser.add_argument('--seconds', type=float, default=48)
    parser.add_argument('--input', type=Path, default=ROOT / 'output/magenta-native-gate/input-0.f32')
    args = parser.parse_args()
    pcm = args.input.read_bytes()
    output = ROOT / 'output/magenta-native-gate'
    output.mkdir(parents=True, exist_ok=True)
    messages = queue.Queue()
    with (output / f'helper-{args.model}.log').open('wb') as log:
        process = subprocess.Popen([str(args.helper.resolve()), str(args.assets), args.model, '1', '1'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, bufsize=0)
    def read():
        try:
            while True:
                size, = struct.unpack('<I', read_exact(process.stdout, 4))
                data = read_exact(process.stdout, size)
                messages.put((time.monotonic(), json.loads(data[1:]) if data[:1] == b'J' else data))
        except EOFError:
            messages.put((time.monotonic(), {'type': 'exit'}))
    threading.Thread(target=read, daemon=True).start()
    def command(**value):
        data = b'J' + json.dumps({'session': 1, 'generation': 1, **value}).encode()
        write_exact(process.stdin, struct.pack('<I', len(data)) + data)
    try:
        for i, text in enumerate(('warm electric piano', 'rounded funk bass', 'brushed percussion')):
            command(type='prompt', index=i, text=text, revision=1)
        until = time.monotonic() + 120
        while time.monotonic() < until:
            _, value = messages.get(timeout=120)
            if isinstance(value, dict):
                print(value, flush=True)
                assert value.get('type') not in ('error', 'exit'), value
                if value.get('state') == 'ready' and value.get('type') == 'status':
                    break
        else:
            raise AssertionError('Native helper startup timeout')
        started = time.monotonic()
        seq = blocks = underruns = references = 0
        acknowledgements = []
        encode_active = False
        during_encode = []
        events = []
        while time.monotonic() - started < args.seconds:
            timestamp = time.monotonic()
            seq += 1
            offset = ((seq-1)*960*8) % len(pcm)
            samples = pcm[offset:offset+960*8]
            data = b'P' + struct.pack('<4sIIIdII', b'D2M2', 1, 1, seq, timestamp*1000, 48000, 960) + samples
            write_exact(process.stdin, struct.pack('<I', len(data)) + data)
            if seq % 3 == 0:
                command(type='weights', weights=[.8,.1,.1] if seq % 6 else [.1,.8,.1], timestamp=timestamp*1000)
            if seq % 25 == 0:
                command(type='note', note=60, on=seq % 50 == 0)
            while not messages.empty():
                received, value = messages.get_nowait()
                if isinstance(value, bytes):
                    blocks += 1
                    assert value[1:5] == b'D2M2'
                    continue
                if value['type'] in ('error', 'exit'):
                    raise AssertionError(value)
                if value['type'] == 'underrun':
                    underruns += 1
                if value['type'] == 'weights-applied':
                    latency = received*1000 - value['timestamp']
                    acknowledgements.append(latency)
                    if encode_active:
                        during_encode.append(latency)
                elif value['type'] == 'audio-reference':
                    events.append(value)
                    encode_active = value['state'] == 'encoding'
                    if value['state'] == 'ready':
                        references += 1
                elif value['type'] == 'metrics':
                    events.append(value)
            time.sleep(max(0, started + seq*.02 - time.monotonic()))
        result = {'model': args.model, 'duration_s': args.seconds, 'pcm_blocks': blocks, 'underruns': underruns,
                  'audio_references_completed': references, 'weight_ack_p95_ms': statistics.quantiles(acknowledgements, n=20)[18],
                  'weight_ack_max_during_audio_encode_ms': max(during_encode, default=None), 'events': events}
        (output / f'helper-{args.model}.json').write_text(json.dumps(result, indent=2))
        print(json.dumps({k:v for k,v in result.items() if k!='events'}, indent=2), flush=True)
        assert references > 0, 'Real rolling audio reference did not complete'
        assert during_encode and max(during_encode) < 500, 'Audio encoding blocked weight controls'
        assert blocks > args.seconds * 45, 'PCM output fell below real time'
        assert underruns <= 2, 'Sustained native audio underruns'
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


if __name__ == '__main__':
    main()
