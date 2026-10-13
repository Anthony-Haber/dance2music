// Fetch once and give Tasks the exact bytes whose digest we record.
const assets = new Map();
export async function modelAsset(url) {
  if (!assets.has(url)) {
    assets.set(url, (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`model download failed (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      return { bytes, sha256 };
    })().catch(error => { assets.delete(url); throw error; }));
  }
  return assets.get(url);
}

export function runtimeIdentity(vision) {
  return { package: '@mediapipe/tasks-vision', version: vision.local ? null : '1.0.1',
    module: vision.local ? 'vendor/mediapipe/vision_bundle.mjs' : vision.base + 'vision_bundle.mjs',
    origin: vision.local ? 'local_unverified_version' : 'pinned_cdn' };
}
