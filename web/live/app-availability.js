// Never probe localhost from the public website. iPad desktop mode is touch MacIntel.
export function mobileDevice(nav = navigator) {
  return !!nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') ||
    ((nav.platform === 'MacIntel' || /Macintosh/.test(nav.userAgent || '')) && nav.maxTouchPoints > 1);
}

export function localDesktop(nav = navigator, loc = location) {
  return !mobileDevice(nav) && loc.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(loc.hostname);
}

export function availableScene(mode, available) {
  return mode === 'magenta' && !available ? 'none' : mode;
}

export async function availability(nav = navigator, loc = location, request = fetch) {
  const mobile = mobileDevice(nav), local = localDesktop(nav, loc);
  if (!local) return {mobile, local, available: false};
  try {
    const response = await request('/magenta/status', {headers: {'X-D2M-Local': '1'}, signal: AbortSignal.timeout(30000)});
    const status = response.ok ? await response.json() : {};
    return {mobile, local, available: status.ready === true, message: status.message};
  } catch { return {mobile, local, available: false}; }
}

export async function downloadLink(link, message, request = fetch) {
  try {
    const response = await request(new URL('./app-release.json', import.meta.url));
    const {release} = await response.json();
    if (!release || !/^https:\/\/github\.com\/Music-Intelligence-Lab\/dance2music\/releases\/download\/[^/]+\/Dance2Music-[\d.]+-arm64\.dmg$/.test(release.url) || !/^[a-f0-9]{64}$/.test(release.sha256)) return;
    link.href = release.url; link.hidden = false;
    message.textContent = `Download Dance2Music ${release.version}, then move it to Applications and open it.`;
  } catch { /* No verified release: keep the download link hidden. */ }
}
