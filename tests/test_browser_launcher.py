"""Mobile/iPad/public/local availability and session guards in real Chrome."""
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        cases = [
            ('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile', 'iPhone', 5, False, False),
            ('Android phone', 'Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile', 'Linux armv8l', 5, False, False),
            ('Android tablet', 'Mozilla/5.0 (Linux; Android 15; Tablet) Chrome/130', 'Linux armv8l', 5, False, False),
            ('iPad desktop mode', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1', 'MacIntel', 5, False, False),
            ('Public Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/147', 'MacIntel', 0, False, False),
            ('Local incomplete', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/147', 'MacIntel', 0, True, False),
            ('Local ready', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/147', 'MacIntel', 0, True, True),
        ]
        for name, ua, platform, touch, local, ready in cases:
            context = browser.new_context(user_agent=ua, permissions=['camera'])
            context.add_init_script(f"Object.defineProperty(navigator,'platform',{{value:{platform!r}}});Object.defineProperty(navigator,'maxTouchPoints',{{value:{touch}}});localStorage.setItem('d2m:sceneMode','\"magenta\"');")
            page = context.new_page()
            origin = 'http://127.0.0.1:5092' if local else 'https://public-dance.test'
            requests, errors = [], []
            page.on('pageerror', lambda e: (errors.append(str(e)), print('PAGE ERROR', name, e, flush=True)))
            def route(r):
                url = r.request.url
                requests.append(url)
                if not url.startswith(origin + '/'):
                    return r.abort()
                path = unquote(urlsplit(url).path)
                if path == '/magenta/status':
                    return r.fulfill(json={'ready': ready, 'token': 'test', 'message': 'Complete setup in Dance2Music.'})
                target = ROOT / 'web' / path.lstrip('/')
                if path.endswith('/'):
                    target /= 'index.html'
                if target.is_file():
                    content_type = 'text/javascript' if target.suffix in ('.mjs', '.js') else mimetypes.guess_type(target)[0] or 'application/octet-stream'
                    return r.fulfill(body=target.read_bytes(), content_type=content_type)
                return r.fulfill(status=404, body='missing')
            page.route('**/*', route)
            page.goto(origin + '/live/')
            page.wait_for_function("document.querySelector('#sceneMode').onchange !== null")
            mobile = touch > 0
            option = page.locator('#sceneMode option[value="magenta"]')
            assert option.count() == (0 if mobile else 1), name
            assert page.locator('#magentaControls').is_visible() == ready, name
            assert page.locator('#magentaInstall').is_visible() == (not mobile and not ready), name
            assert page.locator('#sceneMode').input_value() == ('magenta' if ready else 'none'), name
            assert page.evaluate("JSON.parse(localStorage.getItem('d2m:sceneMode'))") == ('magenta' if ready else 'none'), name
            assert not page.locator('#magentaDownload').is_visible(), name
            if not mobile and not ready:
                assert option.evaluate('el => el.disabled'), (name, option.evaluate('el => el.outerHTML'))
                assert 'Apple Silicon Mac, macOS 14+, Chrome required' in page.locator('#magentaInstall').inner_text(), name
            if not local:
                assert not any('/magenta/status' in url or '127.0.0.1' in url for url in requests), name
            # Force an unavailable value past the UI and verify the session guard.
            if not ready:
                page.evaluate("""()=>{const s=document.querySelector('#sceneMode');if(!s.querySelector('[value=magenta]'))s.add(new Option('forced','magenta'));s.querySelector('[value=magenta]').disabled=false;s.value='magenta';document.querySelector('#go').click();}""")
                assert page.locator('#sceneMode').input_value() == 'none', name
            assert not errors, (name, errors)
            context.close()
            print('PASS', name, flush=True)
        browser.close()


if __name__ == '__main__':
    main()
