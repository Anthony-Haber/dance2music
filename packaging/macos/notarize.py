"""Package a Developer ID signed app; notarize by default or explicitly defer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def run(*args, **kwargs):
    if args[0] in ('codesign', 'spctl') or args[:2] == ('xcrun', 'notarytool'):
        environment = dict(os.environ)
        environment.pop('HOME', None)
        environment.pop('TMPDIR', None)
        kwargs.setdefault('env', environment)
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def notarize(path, credentials):
    result = run('xcrun', 'notarytool', 'submit', path, *credentials,
                 '--wait', '--output-format', 'json', capture_output=True, text=True)
    response = json.loads(result.stdout)
    if response.get('status') != 'Accepted':
        raise RuntimeError('Notarization rejected: ' + json.dumps(response))
    run('xcrun', 'stapler', 'staple', path)
    run('xcrun', 'stapler', 'validate', path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profile', default=os.environ.get('D2M_NOTARY_PROFILE', 'Dance2Music'))
    parser.add_argument('--keychain', type=Path, default=os.environ.get('D2M_SIGN_KEYCHAIN'),
                        help='Optional signing keychain')
    parser.add_argument('--notary-keychain', type=Path, default=os.environ.get('D2M_NOTARY_KEYCHAIN'),
                        help='Optional keychain containing the notarization profile')
    parser.add_argument('--sign-only', action='store_true',
                        help='Create a signed test DMG without notarization; release metadata remains unapproved')
    args = parser.parse_args()
    import re
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        parser.error('Version must be major.minor.patch')
    app = args.app.resolve()
    identity = os.environ['D2M_SIGN_IDENTITY']
    if not identity.startswith('Developer ID Application:'):
        raise RuntimeError('A Developer ID Application identity is required')
    credentials = ['--keychain-profile', args.profile]
    if args.notary_keychain:
        credentials += ['--keychain', args.notary_keychain.expanduser().resolve()]
    signing_keychain = ['--keychain', args.keychain.expanduser().resolve()] if args.keychain else []
    run('codesign', '--verify', '--deep', '--strict', app)
    signature = run('codesign', '-d', '--verbose=4', app, capture_output=True, text=True).stderr
    if 'Authority=Developer ID Application:' not in signature or not re.search(r'flags=0x[0-9a-f]+\([^)]*runtime', signature):
        raise RuntimeError('The input app must have a Developer ID signature and hardened runtime')
    args.output.mkdir(parents=True, exist_ok=True)
    dmg = args.output / f'Dance2Music-{args.version}-arm64.dmg'
    if dmg.exists():
        raise RuntimeError('Refusing to replace an existing installer')
    with tempfile.TemporaryDirectory(prefix='.dmg-stage-', dir=args.output.resolve()) as scratch:
        if not args.sign_only:
            archive = Path(scratch) / 'Dance2Music.zip'
            run('ditto', '-c', '-k', '--keepParent', app, archive)
            # Staple the app as well as the DMG, so copied apps work offline.
            result = run('xcrun', 'notarytool', 'submit', archive, *credentials,
                         '--wait', '--output-format', 'json', capture_output=True, text=True)
            if json.loads(result.stdout).get('status') != 'Accepted':
                raise RuntimeError('App notarization rejected: ' + result.stdout)
            run('xcrun', 'stapler', 'staple', app)
            run('xcrun', 'stapler', 'validate', app)
            run('spctl', '--assess', '--type', 'execute', '--verbose=2', app)
        stage = Path(scratch) / 'disk'
        stage.mkdir()
        run('ditto', app, stage / 'Dance2Music.app')
        (stage / 'Applications').symlink_to('/Applications')
        run('hdiutil', 'create', '-volname', 'Dance2Music', '-srcfolder', stage, '-format', 'UDZO', dmg)
    run('codesign', '--sign', identity, *signing_keychain, '--timestamp', dmg)
    if not args.sign_only:
        notarize(dmg, credentials)
    run('codesign', '--verify', '--strict', dmg)
    if not args.sign_only:
        run('spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg)
    if dmg.stat().st_size >= 2 * 1024**3:
        raise RuntimeError('Installer exceeds GitHub Releases per-file limit (2 GiB)')
    with dmg.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    (args.output / 'SHA256SUMS').write_text(f'{digest}  {dmg.name}\n')
    (args.output / 'release-manifest.json').write_text(json.dumps({'schema': 1, 'version': args.version,
        'file': dmg.name, 'bytes': dmg.stat().st_size, 'sha256': digest,
        'notarized': not args.sign_only, 'architecture': 'arm64', 'minimum_macos': '14.0'}, indent=2) + '\n')


if __name__ == '__main__':
    main()
