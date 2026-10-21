"""Transactional setup for the installed app. No session code downloads files."""
import hashlib
import http.client
import json
from pathlib import Path
import shutil
import urllib.error
import urllib.request

from magenta_assets import sha256, valid


class SetupError(RuntimeError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def read_catalog(resources):
    resources = Path(resources)
    native = json.loads((resources / 'native/magenta/manifest.lock.json').read_text())
    files = [dict(a, path='magenta/' + a['path'], url=(
        'https://huggingface.co/google/magenta-realtime-2/resolve/'
        + native['models']['revision'] + '/' + a['path'])) for a in native['models']['assets']]
    markers = {}
    for name in ('mediapipe', 'scene', 'piano'):
        lock = resources / f'web/live/{name}-assets.lock.json'
        prefix = f'browser/{name}/'
        for asset in json.loads(lock.read_text())['files']:
            files.append(dict(asset, path=prefix + asset['path'], bytes=asset['size']))
        markers[prefix + 'ready.json'] = {'lock_sha256': sha256(lock)}
    for asset in files:
        path = Path(asset['path'])
        if path.is_absolute() or '..' in path.parts or not asset['url'].startswith('https://'):
            raise ValueError('Invalid packaged asset path or URL')
    if len({a['path'] for a in files}) != len(files):
        raise ValueError('Duplicate packaged asset path')
    return files, markers


def catalog_hash(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.part')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def prepare(state, files, markers, emit, repair=False, opener=urllib.request.urlopen):
    """Verify before reusing; interrupted files restart, completed files survive."""
    state = Path(state)
    state.mkdir(parents=True, exist_ok=True)
    receipt = state / 'installation.json'
    try:
        previous = json.loads(receipt.read_text()).get('catalog_sha256') == catalog_hash(files)
    except (OSError, ValueError, AttributeError):
        previous = False
    # Readiness is a commit record, never a claim made during an update/repair.
    receipt.unlink(missing_ok=True)
    for relative in markers:
        (state / relative).unlink(missing_ok=True)
    total = sum(a['bytes'] for a in files)
    complete = 0
    missing = []
    for asset in files:
        # A hard-killed download can leave a partial file. Individual files
        # restart, so release that space before calculating required free disk.
        target = state / asset['path']
        target.with_name(target.name + '.part').unlink(missing_ok=True)
        emit('verifying', path=asset['path'], completed_bytes=complete, total_bytes=total)
        if valid(target, asset):
            complete += asset['bytes']
        else:
            missing.append(asset)
    remaining = total - complete
    if missing and previous and not repair:
        raise SetupError('repair_required', 'Assets are missing or corrupt. Connect to the internet and choose Retry to repair them. Verified files will be reused.')
    # Include headroom for receipts and atomic replacement of a corrupt file.
    if missing and shutil.disk_usage(state).free < remaining + 256 * 1024 * 1024:
        raise SetupError('disk_space', f'Free at least {(remaining + 256 * 1024**2) / 1e9:.2f} GB on this disk, then choose Retry.')
    emit('setup', total_bytes=total, completed_bytes=complete, download_bytes=remaining)
    for asset in missing:
        target = state / asset['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.part')
        received = 0
        try:
            with opener(asset['url'], timeout=30) as response, temporary.open('wb') as out:
                for block in iter(lambda: response.read(1024 * 1024), b''):
                    received += len(block)
                    if received > asset['bytes']:
                        raise SetupError('checksum', 'Unexpected download size: ' + asset['path'] + '. Choose Retry to repair.')
                    out.write(block)
                    emit('downloading', path=asset['path'], completed_bytes=complete + received, total_bytes=total)
            emit('verifying', path=asset['path'], completed_bytes=complete, total_bytes=total)
            if not valid(temporary, asset):
                raise SetupError('checksum', 'Download verification failed: ' + asset['path'] + '. Choose Retry to repair.')
            temporary.replace(target)
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as error:
            raise SetupError('internet_required', 'Setup needs internet to download missing assets. Reconnect and choose Retry; verified files will be reused.') from error
        finally:
            temporary.unlink(missing_ok=True)
        complete += asset['bytes']
    for relative, marker in markers.items():
        atomic_json(state / relative, marker)
    result = {'schema': 2, 'catalog_sha256': catalog_hash(files), 'asset_root': 'magenta'}
    atomic_json(receipt, result)
    emit('verified', completed_bytes=total, total_bytes=total)
    return result


class Installation:
    """Explicit, relocatable packaged resources with content verification."""
    def __init__(self, resources, state):
        self.resources, self.state = Path(resources), Path(state)
        self.contents = self.resources.parent
        self.files, self.markers = read_catalog(self.resources)
        self.fingerprint = catalog_hash(self.files)

    def check_file(self, path, asset):
        # Network and removable filesystems can have coarse timestamps. A
        # same-size corruption must not be accepted just because stat is equal.
        if not valid(path, asset):
            raise SetupError('repair_required', 'File is missing or corrupt: ' + path.name + '. Quit the session and choose Retry in Dance2Music to repair assets, or reinstall the app for damaged bundled files.')

    def verify_binaries(self):
        try:
            record = json.loads((self.resources / 'binaries.json').read_text())
        except (OSError, ValueError) as error:
            raise SetupError('bundle_corrupt', 'The app integrity record is missing or damaged. Reinstall Dance2Music.') from error
        if record.get('schema') != 1 or not record.get('files'):
            raise SetupError('bundle_corrupt', 'Invalid app integrity record. Reinstall Dance2Music.')
        required = {'Helpers/mrt2/mrt2_helper', 'Helpers/mrt2/mlx.metallib', 'Helpers/backend/dance2music-backend'}
        if not required.issubset(a['path'] for a in record['files']):
            raise SetupError('bundle_corrupt', 'Incomplete app integrity record. Reinstall Dance2Music.')
        for asset in record['files']:
            path = (self.contents / asset['path']).resolve()
            if not path.is_relative_to(self.contents.resolve()):
                raise SetupError('bundle_corrupt', 'Invalid app integrity path. Reinstall Dance2Music.')
            self.check_file(path, asset)

    def installation(self):
        self.verify_binaries()
        installed = json.loads((self.state / 'installation.json').read_text())
        if installed.get('schema') != 2 or installed.get('catalog_sha256') != self.fingerprint:
            raise SetupError('repair_required', 'Setup is incomplete. Quit the session and choose Retry in Dance2Music.')
        for asset in self.files:
            self.check_file(self.state / asset['path'], asset)
        native = json.loads((self.resources / 'native/magenta/manifest.lock.json').read_text())
        provenance = {**installed, 'upstream': native.get('upstream'),
                      'models': {k: v for k, v in native['models'].items() if k != 'assets'}}
        return self.contents / 'Helpers/mrt2/mrt2_helper', self.state / 'magenta', provenance
