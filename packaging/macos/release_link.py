"""Pages build: expose a download only for a completed, published Mac release."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

REPOSITORY = 'Music-Intelligence-Lab/dance2music'


def read(url):
    headers = {'Accept': 'application/vnd.github+json'} if url.startswith('https://api.github.com/') else {}
    if headers and os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        return response.read()


def release_info(release, manifest, checksums):
    if release.get('draft') or release.get('prerelease') or not release.get('published_at'):
        return None
    version = manifest.get('version', '')
    filename = f'Dance2Music-{version}-arm64.dmg'
    if (not re.fullmatch(r'\d+\.\d+\.\d+', version) or release['tag_name'] != 'mac-v' + version
            or manifest.get('notarized') is not True or manifest.get('file') != filename
            or manifest.get('architecture') != 'arm64' or manifest.get('minimum_macos') != '14.0'):
        return None
    asset = next((a for a in release['assets'] if a['name'] == filename and a['state'] == 'uploaded'), None)
    digest = manifest.get('sha256', '')
    if (not asset or not re.fullmatch(r'[a-f0-9]{64}', digest) or asset['size'] != manifest['bytes']
            or asset.get('digest') != 'sha256:' + digest
            or not 0 < asset['size'] < 2 * 1024**3 or f'{digest}  {filename}' not in checksums.splitlines()):
        return None
    url = f'https://github.com/{REPOSITORY}/releases/download/{release["tag_name"]}/{filename}'
    if asset['browser_download_url'] != url:
        return None
    return {'version': version, 'url': url, 'sha256': digest, 'bytes': asset['size']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    result = None
    try:
        releases = json.loads(read(f'https://api.github.com/repos/{REPOSITORY}/releases?per_page=100'))
        for release in releases:
            if not release['tag_name'].startswith('mac-v') or release.get('draft') or release.get('prerelease'):
                continue
            assets = {a['name']: a for a in release['assets']}
            if not {'release-manifest.json', 'SHA256SUMS'}.issubset(assets):
                continue
            manifest = json.loads(read(assets['release-manifest.json']['browser_download_url']))
            checksums = read(assets['SHA256SUMS']['browser_download_url']).decode()
            result = release_info(release, manifest, checksums)
            if result:
                break
    except (urllib.error.URLError, ValueError, KeyError, TimeoutError) as error:
        print('No verified Mac release link:', error)
    args.destination.write_text(json.dumps({'schema': 1, 'release': result}, indent=2) + '\n')


if __name__ == '__main__':
    main()
