"""Kill a native worker's parent during real generation and require cleanup."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    args = parser.parse_args()
    worker = r'''
import json,struct,subprocess,sys
child=subprocess.Popen([sys.argv[1],sys.argv[2],'small','1','1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=sys.stderr)
for i,text in enumerate(('warm piano','gentle bass','soft percussion')):
    data=b'J'+json.dumps(dict(type='prompt',index=i,text=text,revision=1,session=1,generation=1)).encode()
    child.stdin.write(struct.pack('<I',len(data))+data)
child.stdin.flush()
def exact(n):
    data=b''
    while len(data)<n:
        block=child.stdout.read(n-len(data))
        if not block: raise RuntimeError('Helper exited before generation')
        data+=block
    return data
reported=False
while True:
    data=exact(struct.unpack('<I',exact(4))[0])
    if data[:1]==b'P' and not reported:
        print(child.pid,flush=True);reported=True
'''
    with tempfile.TemporaryFile() as log:
        parent = subprocess.Popen([sys.executable, '-c', worker, str(args.helper.resolve()), str(args.assets.resolve())], stdout=subprocess.PIPE, stderr=log)
        try:
            import selectors
            selector = selectors.DefaultSelector()
            selector.register(parent.stdout, selectors.EVENT_READ)
            try:
                if not selector.select(timeout=120):
                    raise RuntimeError('Native generation timeout')
                line = parent.stdout.readline()
            finally:
                selector.close()
            if not line:
                log.seek(0)
                raise RuntimeError(log.read().decode())
            pid = int(line)
            parent.kill(); parent.wait(timeout=5)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                state = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
                if state.returncode or state.stdout.strip().startswith('Z'):
                    print('PASS native worker exits after parent is killed during generation')
                    break
                time.sleep(.1)
            else:
                os.kill(pid, 15)
                raise AssertionError('Native worker survived parent death')
        finally:
            if parent.poll() is None:
                parent.terminate(); parent.wait(timeout=5)
            parent.stdout.close()


if __name__ == '__main__':
    main()
