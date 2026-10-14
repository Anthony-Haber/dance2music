"""Repeated preparation must verify locally without rebuilding or downloading."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import magenta_assets
import magenta_install
from magenta_runtime import MagentaRuntime


class InstallerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.assets = self.root / 'models'
        self.assets.mkdir()
        (self.assets / 'model').write_bytes(b'good')
        self.helper = self.root / 'build-native/mrt2_helper'
        self.helper.parent.mkdir()
        self.helper.write_bytes(b'helper')
        descriptor = {'path': 'model', 'bytes': 4,
                      'sha256': magenta_assets.sha256(self.assets / 'model')}
        self.installed = {
            'asset_root': str(self.assets),
            'manifest_sha256': magenta_assets.sha256(magenta_assets.LOCK),
            'helper_sha256': magenta_assets.sha256(self.helper),
            'native_sources': {name: magenta_assets.sha256(magenta_assets.ROOT / 'native/magenta' / name)
                               for name in ('helper.cpp', 'CMakeLists.txt', 'embedding.patch')},
        }
        self.receipt = self.root / 'installation.json'
        self.write_receipt()
        for target, kwargs in (
            ('magenta_assets.assets', {'return_value': [descriptor]}),
            ('magenta_assets.urllib.request.urlopen', {'side_effect': AssertionError('Network forbidden')}),
            ('magenta_install.platform.system', {'return_value': 'Darwin'}),
            ('magenta_install.platform.machine', {'return_value': 'arm64'}),
        ):
            patcher = patch(target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_receipt(self):
        self.receipt.write_text(json.dumps(self.installed))

    def test_verified_installation_reused_without_tools_or_downloads(self):
        before = self.receipt.stat().st_mtime_ns
        with patch.object(magenta_install.subprocess, 'run', side_effect=AssertionError('No build tools needed')), \
                patch.object(magenta_install, 'prepare_assets', side_effect=AssertionError('No downloads needed')):
            self.assertEqual(magenta_install.prepare(self.root), self.installed)
            self.assertEqual(magenta_install.prepare(self.root, self.assets), self.installed)
        self.assertEqual(self.receipt.stat().st_mtime_ns, before)

    def test_invalid_installations_are_not_reused(self):
        for damaged in ('manifest', 'source', 'helper', 'asset', 'missing receipt', 'invalid json'):
            with self.subTest(damaged=damaged):
                self.helper.write_bytes(b'helper')
                (self.assets / 'model').write_bytes(b'good')
                self.write_receipt()
                broken = json.loads(self.receipt.read_text())
                if damaged == 'manifest':
                    broken['manifest_sha256'] = 'stale'
                elif damaged == 'source':
                    broken['native_sources']['helper.cpp'] = 'stale'
                self.receipt.write_text(json.dumps(broken))
                if damaged == 'helper':
                    self.helper.write_bytes(b'corrupt')
                elif damaged == 'asset':
                    (self.assets / 'model').write_bytes(b'evil')
                elif damaged == 'missing receipt':
                    self.receipt.unlink()
                elif damaged == 'invalid json':
                    self.receipt.write_text('{')
                with patch.object(magenta_install.subprocess, 'run', side_effect=RuntimeError('Build reached')), \
                        patch.object(magenta_install, 'prepare_assets') as download:
                    with self.assertRaisesRegex(RuntimeError, 'Build reached'):
                        magenta_install.prepare(self.root, self.assets, cmake='/test/cmake')
                    self.assertEqual(download.call_count, int(damaged == 'asset'))

    def test_rebuild_reuses_local_tools_without_pip(self):
        executable = self.root / 'tools/bin/cmake'
        executable.parent.mkdir(parents=True)
        executable.write_text('#!/bin/sh\n')
        executable.chmod(0o755)
        with patch.object(magenta_install.subprocess, 'run') as run:
            magenta_install.prepare(self.root, self.assets, rebuild=True)
        self.assertEqual(run.call_count, 2)
        self.assertTrue(all(call.args[0][0] == str(executable) for call in run.call_args_list))
        MagentaRuntime(self.root).installation()

    def test_explicit_new_asset_location_is_honored(self):
        other = self.root / 'other-models'
        other.mkdir()
        (other / 'model').write_bytes(b'good')
        with patch.object(magenta_install.subprocess, 'run') as run:
            installed = magenta_install.prepare(self.root, other, cmake='/test/cmake')
        self.assertEqual(run.call_count, 2)
        self.assertEqual(installed['asset_root'], str(other))
        self.assertEqual(MagentaRuntime(self.root).installation()[1], other)


if __name__ == '__main__':
    unittest.main()
