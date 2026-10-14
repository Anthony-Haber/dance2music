"""Integrity gates must fail closed without requiring models or networking."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('magenta_assets', Path(__file__).resolve().parents[1] / 'magenta_assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class AssetTests(unittest.TestCase):
    def test_matched_model_bundle_includes_all_conditioning_paths(self):
        lock = assets.manifest()
        self.assertEqual(len(lock['models']['revision']), 40)
        paths = {a['path'] for a in assets.assets()}
        for model in ('base', 'small'):
            self.assertIn(f'models/mrt2_{model}/mrt2_{model}.mlxfn', paths)
            self.assertIn(f'models/mrt2_{model}/mrt2_{model}_state.safetensors', paths)
        for file in ('mapper.tflite', 'audio_preprocessor.tflite', 'music_encoder.tflite',
                     'text_encoder.tflite', 'pretrained_vector_quantizer.tflite', 'spm.model'):
            self.assertIn('resources/musiccoca/' + file, paths)
        self.assertIn('resources/spectrostream/spectrostream_encoder.mlxfn', paths)
        self.assertTrue(all(len(a['sha256']) == 64 and a['bytes'] > 0 for a in assets.assets()))

    def test_same_size_corruption_is_rejected_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            descriptor = {'path': 'model', 'bytes': 4, 'sha256': hashlib.sha256(b'good').hexdigest()}
            with patch.object(assets, 'assets', return_value=[descriptor]), patch.object(assets.urllib.request, 'urlopen', side_effect=AssertionError('Network forbidden')):
                self.assertEqual(assets.verify(root), ['model'])
                (root / 'model').write_bytes(b'good')
                self.assertEqual(assets.verify(root), [])
                (root / 'model').write_bytes(b'evil')
                self.assertEqual(assets.verify(root), ['model'])

    def test_failed_download_preserves_prior_file_and_removes_partial(self):
        import io
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'model').write_bytes(b'old')
            descriptor = {'path': 'model', 'bytes': 4, 'sha256': hashlib.sha256(b'good').hexdigest()}
            with patch.object(assets.urllib.request, 'urlopen', return_value=io.BytesIO(b'evil')):
                with self.assertRaisesRegex(ValueError, 'Hash/size mismatch'):
                    assets.download_asset(descriptor, root, 'a' * 40)
            self.assertEqual((root / 'model').read_bytes(), b'old')
            self.assertFalse(list(root.glob('*.part')))


if __name__ == '__main__':
    unittest.main()
