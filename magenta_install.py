"""Explicit native MRT2 preparation; never called by a live session."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

from magenta_assets import DEFAULT_ROOT, LOCK, ROOT, manifest, prepare as prepare_assets, sha256, verify
from magenta_runtime import MagentaRuntime


def prepare(root=DEFAULT_ROOT, asset_root=None, cmake=None, jobs=8, rebuild=False):
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise RuntimeError('Native MRT2 currently requires Apple Silicon macOS 14 or later.')
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    receipt = root / 'installation.json'
    if not rebuild:
        try:
            _, installed_assets, installed = MagentaRuntime(root).installation()
        except (OSError, ValueError, RuntimeError, KeyError):
            pass  # An absent, outdated, or corrupt installation needs preparation.
        else:
            if asset_root is None or Path(asset_root).resolve() == installed_assets.resolve():
                print('MRT2 helper and Base/Small assets verified; reusing existing installation.')
                return installed
    if asset_root is None:
        existing = Path.home() / 'Documents/Magenta/magenta-rt-v2'
        asset_root = existing if existing.is_dir() and not verify(existing) else root
    asset_root = Path(asset_root).resolve()
    if verify(asset_root):
        prepare_assets(asset_root)
    lock = manifest()
    environment = root / 'tools'
    local_cmake = environment / 'bin/cmake'
    cmake = cmake or (str(local_cmake) if os.access(local_cmake, os.X_OK) else shutil.which('cmake'))
    if not cmake:
        if not (environment / 'bin/python').exists():
            subprocess.run([sys.executable, '-m', 'venv', str(environment)], check=True)
        subprocess.run([str(environment / 'bin/python'), '-m', 'pip', 'install',
                       'cmake==' + lock['build_tools']['cmake'], 'ninja==' + lock['build_tools']['ninja']], check=True)
        cmake = str(environment / 'bin/cmake')
    build = root / 'build-native'
    receipt.unlink(missing_ok=True)
    print('Building the native MRT2 helper for offline use...', flush=True)
    subprocess.run([cmake, '-S', str(ROOT / 'native/magenta'), '-B', str(build), '-DCMAKE_BUILD_TYPE=Release'], check=True)
    subprocess.run([cmake, '--build', str(build), '--target', 'mrt2_helper', 'mrt2_probe', '-j', str(jobs)], check=True)
    helper = build / 'mrt2_helper'
    # The build stores source dependencies and their licenses. Keep them local
    # for audit/rebuild; the helper and models have no runtime network path.
    installed = {'schema': 1, 'asset_root': str(asset_root), 'manifest_sha256': sha256(LOCK),
                 'helper_sha256': sha256(helper), 'upstream': lock['upstream'],
                 'metallib_sha256': sha256(build / 'mlx.metallib'),
                 'models': {k: v for k, v in lock['models'].items() if k != 'assets'},
                 'bridge_sha256': sha256(ROOT / 'native/magenta/embedding.patch'),
                 'native_sources': {name: sha256(ROOT / 'native/magenta' / name)
                                    for name in ('helper.cpp', 'CMakeLists.txt', 'embedding.patch')},
                 'native_acceptance': 'Requires tests/test_magenta_native.py and live camera acceptance'}
    partial = receipt.with_suffix('.part')
    partial.write_text(json.dumps(installed, indent=2) + '\n')
    partial.replace(receipt)
    print('MRT2 helper and Base/Small assets installed and verified. Live acceptance is separate.')
    return installed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--cmake')
    parser.add_argument('--jobs', type=int, default=8)
    parser.add_argument('--rebuild', action='store_true', help='Rebuild even when the installed helper and assets verify successfully')
    args = parser.parse_args()
    prepare(args.root, args.assets, args.cmake, args.jobs, rebuild=args.rebuild)
