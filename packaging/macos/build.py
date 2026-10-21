#!/usr/bin/env python3
"""Build a relocatable arm64 app; no models or developer installation copied."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from magenta_assets import sha256, valid

MACHO = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'}


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def output(*args):
    return subprocess.check_output([str(a) for a in args], text=True)


def macho_files(directory):
    for path in directory.rglob('*'):
        if path.is_file() and not path.is_symlink():
            with path.open('rb') as stream:
                if stream.read(4) in MACHO:
                    yield path


def dependencies(path):
    return [line.strip().split(' (compatibility')[0] for line in output('otool', '-L', path).splitlines()[1:]]


def rpaths(path):
    return re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset', output('otool', '-l', path))


def bundle_native(helper, destination):
    """Copy the closure of non-system dylibs and rewrite all load paths."""
    destination.mkdir(parents=True)
    pending = [helper]
    copied = {}
    while pending:
        source = pending.pop().resolve()
        if source in copied:
            continue
        target = destination / source.name
        if target.exists():
            raise RuntimeError('Native library basename collision: ' + source.name)
        shutil.copy2(source, target)
        copied[source] = target
        for dep in dependencies(source):
            if dep.startswith(('/usr/lib/', '/System/Library/')):
                continue
            if dep.startswith('@rpath/'):
                options = [Path(p.replace('@loader_path', str(source.parent)).replace('@executable_path', str(helper.parent))) / dep[7:] for p in rpaths(source)]
                resolved = next((p for p in options if p.is_file()), None)
                if resolved is None:
                    raise RuntimeError('Cannot resolve native library: ' + dep)
            else:
                resolved = Path(dep.replace('@loader_path', str(source.parent)).replace('@executable_path', str(helper.parent)))
            if resolved.resolve() == source:  # dylib install ID
                continue
            pending.append(resolved)
            run('install_name_tool', '-change', dep, '@loader_path/' + resolved.name, target)
        if target.suffix == '.dylib':
            run('install_name_tool', '-id', '@loader_path/' + target.name, target)
        for path in rpaths(target):
            run('install_name_tool', '-delete_rpath', path, target)
    return copied


def arrange_bundle(contents):
    """Keep data out of macOS nested-code locations, preserving onedir lookup."""
    internal = contents / 'Helpers/backend/_internal'
    resources = contents / 'Resources/backend'
    internal.rename(resources)
    internal.symlink_to('../../Resources/backend')
    for binary in list(macho_files(resources)):
        target = contents / 'Frameworks/backend' / binary.relative_to(resources)
        target.parent.mkdir(parents=True, exist_ok=True)
        binary.rename(target)
        binary.symlink_to(os.path.relpath(target, binary.parent))
    metal = contents / 'Helpers/mrt2/mlx.metallib'
    target = contents / 'Resources/mlx.metallib'
    metal.rename(target)
    metal.symlink_to('../../Resources/mlx.metallib')


def audit(app):
    for binary in macho_files(app):
        if output('lipo', '-archs', binary).strip() != 'arm64':
            raise RuntimeError('Non-arm64 binary: ' + str(binary))
        commands = '\n'.join(output('otool', '-l', binary).splitlines()[1:])
        # Only deployment commands, not dylib compatibility/current versions.
        minimums = re.findall(r'cmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform \d+\s+minos ([\d.]+)', commands) + re.findall(r'cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)', commands)
        if any(tuple(map(int, v.split('.')[:2])) > (14, 0) for v in minimums):
            raise RuntimeError('Binary needs newer than macOS 14: ' + str(binary))
        for dep in dependencies(binary) + rpaths(binary):
            if dep.startswith('/') and not dep.startswith(('/usr/lib/', '/System/Library/')):
                raise RuntimeError(f'Developer-machine load path in {binary}: {dep}')
        if any(p in commands for p in ('/opt/homebrew/', '/Users/', '/private/tmp/', '/tmp/')):
            raise RuntimeError('Development-machine load command: ' + str(binary))


def collect_licenses(build, destination):
    destination.mkdir(parents=True)
    shutil.copytree(ROOT / '.packaging/python-metadata/python/licenses', destination / 'Python-bundled')
    shutil.copy2(ROOT / 'packaging/macos/THIRD_PARTY.md', destination)
    lock = json.loads((ROOT / 'native/magenta/manifest.lock.json').read_text())
    names = ['mrt2'] + [d['name'] for d in lock['dependencies'] + lock['transitive_git']]
    for name in names:
        sources = [build / '_deps' / (name + '-src'), build / name]
        found = []
        for source in sources:
            if source.exists():
                # Include transitive notices, preserving names to prevent loss.
                found = [p for p in source.rglob('*') if p.is_file() and not '.git' in p.parts and p.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE'))]
                if found:
                    for path in found:
                        target = destination / name / path.relative_to(source)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(path, target)
                    break
        if not found and name == 'fft2d':
            source = build / '_deps/tensorflow-src/third_party/fft2d/LICENSE'
            if source.is_file():
                (destination / name).mkdir()
                shutil.copy2(source, destination / name / 'LICENSE')
                found = [source]
        if not found:
            raise RuntimeError('No redistribution notices found for ' + name)
    for name in ('pyinstaller', 'certifi'):
        distribution = importlib.metadata.distribution(name)
        found = [f for f in distribution.files if 'license' in f.name.lower() or 'copying' in f.name.lower()]
        if not found:
            raise RuntimeError('Missing Python package notice: ' + name)
        for file in found:
            target = destination / name / str(file)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(distribution.locate_file(file), target)
    # CPython's bundled license() includes its incorporated third-party notices.
    import builtins
    builtins.license._Printer__setup()
    (destination / 'Python.txt').write_text('\n'.join(builtins.license._Printer__lines) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, required=True, help='New directory (will not overwrite an app)')
    parser.add_argument('--native-build', type=Path, default=ROOT / '.packaging/native')
    parser.add_argument('--jobs', type=int, default=8)
    parser.add_argument('--identity', default=os.environ.get('D2M_SIGN_IDENTITY', '-'))
    parser.add_argument('--keychain', type=Path, default=os.environ.get('D2M_SIGN_KEYCHAIN'),
                        help='Optional signing keychain when the default search list is unavailable')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        parser.error('Version must be major.minor.patch')
    toolchain = json.loads((ROOT / 'packaging/macos/toolchain.json').read_text())
    if platform.machine() != 'arm64' or platform.python_version() != toolchain['python']:
        parser.error('Use arm64 Python ' + toolchain['python'])
    if Path(sys.base_prefix).resolve() != (ROOT / '.packaging/portable/python').resolve():
        parser.error('Run packaging/macos/bootstrap.py, then use .packaging/build-venv/bin/python')
    if not output('xcodebuild', '-version').startswith('Xcode ' + toolchain['xcode'] + '\n'):
        parser.error('Use Xcode ' + toolchain['xcode'])
    metal = json.loads(output('xcodebuild', '-showComponent', 'MetalToolchain', '-json'))
    if (metal.get('buildVersion') != toolchain['metal_build'] or
            metal.get('toolchainIdentifier') != 'com.apple.dt.toolchain.Metal.' + toolchain['metal_version']):
        parser.error('Install pinned Metal compiler: xcodebuild -downloadComponent MetalToolchain -buildVersion ' + toolchain['metal_build'])
    for asset in json.loads((ROOT / 'web/vendor/assets.lock.json').read_text())['files']:
        if not valid(ROOT / 'web/vendor' / asset['path'], dict(asset, bytes=asset['size'])):
            raise RuntimeError('Bundled browser library does not match its lock: ' + asset['path'])
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    build = args.native_build.resolve()
    run('cmake', '-S', ROOT / 'native/magenta', '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_ARCHITECTURES=arm64')
    run('cmake', '--build', build, '--target', 'mrt2_helper', 'mrt2_probe', '-j', args.jobs)
    app = args.output / 'Dance2Music.app'
    contents = app / 'Contents'
    resources = contents / 'Resources'
    (contents / 'MacOS').mkdir(parents=True)
    resources.mkdir()
    with tempfile.TemporaryDirectory(prefix='freeze-', dir=args.output) as scratch:
        run(sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--target-arch', 'arm64',
            '--name', 'dance2music-backend', '--distpath', scratch + '/dist', '--workpath', scratch + '/work',
            '--specpath', scratch, '--hidden-import', 'certifi', ROOT / 'packaged_backend.py', cwd=ROOT)
        shutil.copytree(Path(scratch) / 'dist/dance2music-backend', contents / 'Helpers/backend', symlinks=True)
    native = contents / 'Helpers/mrt2'
    bundle_native(build / 'mrt2_helper', native)
    shutil.copy2(build / 'mlx.metallib', native / 'mlx.metallib')
    arrange_bundle(contents)
    shutil.copytree(ROOT / 'web', resources / 'web', ignore=lambda directory, names: ['vendor'] if Path(directory) == ROOT / 'web/live' else ['.DS_Store'])
    (resources / 'native/magenta').mkdir(parents=True)
    shutil.copy2(ROOT / 'native/magenta/manifest.lock.json', resources / 'native/magenta')
    collect_licenses(build, resources / 'Licenses')
    # Browser libraries already carry notices beside the vendored JS. Preserve
    # source/build provenance without absolute checkout or asset paths.
    (resources / 'build.json').write_text(json.dumps({'version': args.version, 'toolchain': toolchain,
        'native_manifest_sha256': sha256(ROOT / 'native/magenta/manifest.lock.json'),
        'requirements_sha256': sha256(ROOT / 'packaging/macos/requirements.lock'),
        'native_sources': {name: sha256(ROOT / 'native/magenta' / name)
                           for name in ('helper.cpp', 'CMakeLists.txt', 'embedding.patch')}}, indent=2) + '\n')
    run('xcrun', 'swiftc', '-parse-as-library', '-O', '-target', 'arm64-apple-macos14.0',
        ROOT / 'packaging/macos/Dance2Music.swift', '-o', contents / 'MacOS/Dance2Music')
    with (contents / 'Info.plist').open('wb') as stream:
        plistlib.dump({'CFBundleIdentifier': 'org.musicintelligencelab.dance2music', 'CFBundleName': 'Dance2Music',
            'CFBundleDisplayName': 'Dance2Music', 'CFBundleExecutable': 'Dance2Music', 'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': args.version, 'CFBundleVersion': args.version, 'LSMinimumSystemVersion': '14.0',
            'LSMultipleInstancesProhibited': True, 'NSHighResolutionCapable': True}, stream)
    audit(app)
    timestamp = ['--timestamp'] if args.identity != '-' else []
    def sign(path):
        # Ad-hoc identities have no Team ID, so hardened library validation
        # rejects even our own dylibs. Release builds always enable runtime.
        runtime = ['--options', 'runtime'] if args.identity != '-' else []
        keychain = ['--keychain', args.keychain.expanduser().resolve()] if args.keychain else []
        # Agent/build environments may redirect HOME. Apple security tools
        # must resolve the real account's keychain context, even with --keychain.
        environment = dict(os.environ)
        environment.pop('HOME', None)
        environment.pop('TMPDIR', None)
        run('codesign', '--force', '--sign', args.identity, *keychain, *runtime, *timestamp, path, env=environment)
    for binary in sorted(macho_files(contents), key=lambda p: len(p.parts), reverse=True):
        if binary == contents / 'MacOS/Dance2Music':
            continue  # codesign treats the main executable as the outer app.
        sign(binary)
    for framework in sorted(contents.rglob('*.framework'), key=lambda p: len(p.parts), reverse=True):
        if not framework.is_symlink():
            sign(framework)
    # Generate hashes AFTER signing every nested executable/framework. The app's
    # main executable is sealed by the outer signature and not self-hashed here.
    files = [p for p in macho_files(contents) if p != contents / 'MacOS/Dance2Music'] + [native / 'mlx.metallib']
    (resources / 'binaries.json').write_text(json.dumps({'schema': 1, 'files': [
        {'path': str(p.relative_to(contents)), 'bytes': p.stat().st_size, 'sha256': sha256(p)} for p in sorted(files)]}, indent=2) + '\n')
    sign(app)
    run('codesign', '--verify', '--deep', '--strict', '--verbose=2', app)
    print(app)


if __name__ == '__main__':
    main()
