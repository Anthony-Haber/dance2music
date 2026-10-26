"""Chrome launch-context and fallback regression checks (no browser starts)."""
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from live import CHROME_WATCH_ARGS, open_browser


class BrowserLaunchTests(unittest.TestCase):
    url = 'http://127.0.0.1:5092/live/'

    def test_mac_starts_installed_chrome_directly_without_changing_profile(self):
        chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        with patch('live.sys.platform', 'darwin'), \
             patch('live.Path.is_file', lambda path: str(path) == chrome), \
             patch('live.subprocess.Popen') as launch, patch('live.subprocess.run') as services, \
             patch('live.webbrowser.open') as default:
            self.assertTrue(open_browser(self.url))
            launch.assert_called_once_with([chrome, *CHROME_WATCH_ARGS, self.url], stdin=subprocess.DEVNULL,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                          start_new_session=True)
            services.assert_not_called()
            default.assert_not_called()

    def test_mac_user_installation_and_launch_failure_fallback(self):
        chrome = str(Path.home() / 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        with patch('live.sys.platform', 'darwin'), \
             patch('live.Path.is_file', lambda path: str(path) == chrome), \
             patch('live.subprocess.Popen', side_effect=OSError('launch failed')) as launch, \
             patch('live.subprocess.run') as services:
            services.return_value.returncode = 0
            self.assertTrue(open_browser(self.url))
            self.assertEqual(launch.call_args.args[0], [chrome, *CHROME_WATCH_ARGS, self.url])
            services.assert_called_once_with(['open', '-a', 'Google Chrome', self.url, '--args', *CHROME_WATCH_ARGS],
                                             stderr=subprocess.DEVNULL)

    def test_mac_missing_chrome_uses_default_browser(self):
        with patch('live.sys.platform', 'darwin'), patch('live.Path.is_file', return_value=False), \
             patch('live.subprocess.Popen') as launch, \
             patch('live.subprocess.run', side_effect=OSError('not installed')), \
             patch('live.webbrowser.open', return_value=True) as default:
            self.assertTrue(open_browser(self.url))
            launch.assert_not_called()
            default.assert_called_once_with(self.url)

    def test_linux_launches_chrome_with_bluetooth_permissions_feature(self):
        with patch('live.sys.platform', 'linux'), patch('live.shutil.which', return_value='/usr/bin/google-chrome'), \
             patch('live.webbrowser.BackgroundBrowser') as browser:
            browser.return_value.open.return_value = True
            self.assertTrue(open_browser(self.url))
            browser.assert_called_once_with(['/usr/bin/google-chrome', *CHROME_WATCH_ARGS, '%s'])
            browser.return_value.open.assert_called_once_with(self.url)


if __name__ == '__main__':
    unittest.main()
