// Classic worker: both dependencies are pinned, local, and licensed in vendor/.
importScripts('../vendor/fflate/fflate-0.8.3.js', '../vendor/js-sha256/sha256-0.11.1.js');

self.onmessage = async ({ data: { media, mediaName, observations, manifest, microphone, microphoneName, extras = [] } }) => {
  try {
    // fflate writes ZIP32. Refuse oversize bundles instead of wrapping offsets.
    const total = media.size + observations.size + (microphone?.size || 0) + extras.reduce((sum, file) => sum + file.blob.size, 0)
      + new Blob([JSON.stringify(manifest)]).size;
    if (total > 0xffffffff - 16 * 1024 * 1024)
      throw new Error('Recording exceeds the 4 GB ZIP limit. Download the recovery files.');
    const chunks = [];
    let consumed = 0, lastProgress = -1;
    const zip = new fflate.Zip((error, chunk, final) => {
      if (error) throw error;
      chunks.push(chunk);
      if (final) self.postMessage({ blob: new Blob(chunks, { type: 'application/zip' }) });
    });
    async function add(name, blob, compress) {
      const entry = compress ? new fflate.ZipDeflate(name, { level: 1 }) : new fflate.ZipPassThrough(name);
      zip.add(entry);
      const hash = sha256.create();
      // Bounded slices work on Safari versions without Blob.stream().
      for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 256 * 1024).arrayBuffer());
        hash.update(bytes); entry.push(bytes, false); consumed += bytes.length;
        const progress = Math.min(99, Math.floor(100 * consumed / Math.max(1, total)));
        if (progress !== lastProgress) { self.postMessage({ progress }); lastProgress = progress; }
      }
      entry.push(new Uint8Array(), true);
      return { path: name, size_bytes: blob.size, sha256: hash.hex() };
    }
    manifest.artifacts = {
      media: await add(mediaName, media, false),
      observations: await add('observations.jsonl', observations, true),
    };
    if (microphone?.size) manifest.artifacts.microphone = await add(microphoneName, microphone, false);
    for (const file of extras) manifest.artifacts[file.key] = await add(file.name, file.blob, true);
    await add('manifest.json', new Blob([JSON.stringify(manifest, null, 2) + '\n']), true);
    zip.end();
  } catch (error) { self.postMessage({ error: error.message }); }
};
