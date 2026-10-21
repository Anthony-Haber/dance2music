"""Fetch the hash-pinned portable Python and install the locked build tools."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    lock = json.loads((ROOT / 'packaging/macos/toolchain.json').read_text())
    work = ROOT / '.packaging'
    work.mkdir(exist_ok=True)
    archive = work / 'python-runtime.tar.gz'
    def digest(path):
        value = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                value.update(block)
        return value.hexdigest()
    def download(archive, url, expected):
        if archive.is_file() and digest(archive) == expected:
            return
        partial = archive.with_suffix('.part')
        try:
            with urllib.request.urlopen(url, timeout=120) as source, partial.open('wb') as target:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    target.write(block)
            if digest(partial) != expected:
                raise RuntimeError('Portable Python checksum mismatch')
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    download(archive, lock['python_archive'], lock['python_sha256'])
    full = work / 'python-full.tar.zst'
    download(full, lock['python_full_archive'], lock['python_full_sha256'])
    metadata = work / 'python-metadata'
    metadata.mkdir(exist_ok=True)
    # macOS bsdtar supports zstd. Extract only notices and distribution metadata
    # from this independently hash-verified archive, never its build objects.
    subprocess.run(['/usr/bin/tar', '-xf', str(full), '-C', str(metadata),
                    'python/PYTHON.json', 'python/licenses'], check=True)
    destination = work / 'portable'
    destination.mkdir(exist_ok=True)
    # Only the authenticated pinned archive is extracted. Its paths/symlinks
    # are further restricted by tarfile's data filter (Python 3.11.8+).
    with tarfile.open(archive) as bundle:
        bundle.extractall(destination, filter='data')
    python = destination / 'python/bin/python3'
    subprocess.run([str(python), '-m', 'venv', str(work / 'build-venv')], check=True)
    subprocess.run([str(work / 'build-venv/bin/python'), '-m', 'pip', 'install', '--require-hashes',
                    '-r', str(ROOT / 'packaging/macos/requirements.lock')], check=True)
    print('Build with .packaging/build-venv/bin/python; prepend .packaging/build-venv/bin to PATH.')


if __name__ == '__main__':
    main()
