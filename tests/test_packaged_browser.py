"""Packaged offline browser assets: real pose, gesture, scene, piano and recording.

Camera frames and piano contacts are fixtures; inference and audio use the
actual installed models and samples. No fixture replaces a packaged asset in
the real-model pass. This does not certify physical contact or listening.
"""
import argparse
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright
from test_browser_piano import controls
from test_browser_scene import real_models

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--methods-only', action='store_true')
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    output = ROOT / 'output/packaged-browser'
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True, args=[
            '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu',
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        try:
            def route(request):
                url = request.request.url
                if not url.startswith(origin + '/'):
                    return request.abort()
                path = urlsplit(url).path
                if path.startswith('/tests/'):
                    source = (ROOT / path.lstrip('/')).resolve()
                    if not source.is_relative_to(ROOT / 'tests'):
                        return request.abort()
                    return request.fulfill(body=source.read_text(), content_type='text/javascript')
                # Reuse checkout-browser tests against the app's actual HTTP
                # root and immutable site resources, without a checkout server.
                if path.startswith('/web/'):
                    return request.continue_(url=origin + url[len(origin + '/web'):])
                return request.continue_()

            context = browser.new_context(permissions=['camera'], accept_downloads=True)
            context.route('**/*', route)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: (errors.append(str(error)), print('BROWSER ERROR', error, flush=True)))
            page.goto(origin + '/about.html#m-live')
            page.wait_for_selector('#m-live')
            assert page.locator('.katex').count() > 0
            print('PASS packaged methods and math rendering offline', flush=True)
            if args.methods_only:
                assert not errors, errors
                return
            page.goto(origin + '/web/live/')
            page.wait_for_function("document.body.dataset.ready==='true'", timeout=45000)
            page.evaluate("""async()=>{
              const {Hands}=await import('/web/live/hands.js'),load=Hands.prototype.load;
              Hands.prototype.load=async function(...args){window.testHands=this;return load.apply(this,args);};
            }""")
            page.locator('#handMode').select_option('near')
            page.locator('#go').click()
            page.wait_for_function("document.querySelector('#go').textContent==='Stop'", timeout=120000)
            configuration = page.evaluate('testHands.configuration()')
            assert configuration['mode'] == 'near' and configuration['models']['F']['asset_sha256']
            assert '/vendor/mediapipe/' in configuration['models']['F']['asset']
            # Real inference over the test camera frame, even without a person.
            page.evaluate("testHands.rec.F.recognizeForVideo(document.querySelector('#v'),performance.now()+1000)")
            page.locator('#go').click()
            page.wait_for_function("document.querySelector('#go').textContent==='Start'")
            page.locator('#handMode').select_option('off')
            print('PASS packaged pose and gesture model loading/inference offline', flush=True)
            real_models(page, origin, False, output, '640x480')
            assert not errors, errors
            context.close()

            # The contact/pose fixture drives the existing full piano recording
            # test; samples, worklets, renderer and recorder remain real.
            context = browser.new_context(permissions=['camera'], accept_downloads=True)
            context.route('**/*', route)
            controls(context, origin)
            context.close()
            print('PASS packaged scene, piano and recording offline', flush=True)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
