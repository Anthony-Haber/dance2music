"""Offline installer verification, including external ONNX weight files."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scene_assets import prepare, digest

class SceneAssetsTest(unittest.TestCase):
    def test_hashes_repair_external_weights_and_atomic_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); source=root/'source'; source.mkdir(); destination=root/'vendor'
            files=[]
            for name in ['config.json','onnx/model.onnx','onnx/model.onnx_data','runtime/module.mjs','runtime/module.wasm']:
                data=('fixture '+name).encode(); path=source/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
                files.append({'path':name,'url':path.as_uri(),'size':len(data),'sha256':hashlib.sha256(data).hexdigest()})
            lock=root/'lock.json';lock.write_text(json.dumps({'files':files}))
            prepare(destination,lock)
            self.assertEqual(json.loads((destination/'ready.json').read_text())['lock_sha256'],digest(lock))
            (destination/'onnx/model.onnx_data').write_bytes(b'corrupt')
            prepare(destination,lock)
            self.assertEqual(digest(destination/'onnx/model.onnx_data'),files[2]['sha256'])
            (source/'runtime/module.wasm').write_bytes(b'bad download')
            (destination/'runtime/module.wasm').unlink()
            with self.assertRaisesRegex(ValueError,'checksum mismatch'): prepare(destination,lock)
            self.assertFalse((destination/'runtime/module.wasm').exists())
            self.assertFalse(list(destination.rglob('*.partial')))
            self.assertFalse((destination/'ready.json').exists())

if __name__=='__main__':unittest.main()
