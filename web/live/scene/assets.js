const LOCK = new URL('../scene-assets.lock.json', import.meta.url);
const ROOT = new URL('../vendor/scene/', import.meta.url);
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function prepareAssets(progress=()=>{}) {
  const response=await fetch(LOCK);if(!response.ok)throw new Error('Scene asset manifest unavailable');
  const bytes=await response.arrayBuffer(), hash=await sha256(bytes), lock=JSON.parse(new TextDecoder().decode(bytes));
  let local=false;
  try { const ready=await fetch(new URL('ready.json',ROOT));local=ready.ok&&(await ready.json()).lock_sha256===hash; } catch {}
  const cache=globalThis.caches?await caches.open('d2m-scene-'+hash):null;
  const urls=new Map(), nativeFetch=globalThis.fetch.bind(globalThis);
  for(let i=0;i<lock.files.length;i++) {
    const asset=lock.files[i], url=local?new URL(asset.path,ROOT).href:asset.url;
    progress({phase:'loading',message:`Loading 3D assets ${i+1}/${lock.files.length}`,progress:i/lock.files.length});
    let cached=await cache?.match(url), res=cached || await nativeFetch(url);
    if(!res?.ok)throw new Error('Missing scene asset: '+asset.path);
    const data=await res.arrayBuffer();
    if(data.byteLength!==asset.size||await sha256(data)!==asset.sha256)throw new Error('Scene checksum mismatch: '+asset.path);
    if(cache&&!cached)await cache.put(url,new Response(data,{headers:{'Content-Type':asset.path.endsWith('.wasm')?'application/wasm':asset.path.endsWith('.json')?'application/json':'text/javascript'}}));
    urls.set(asset.path,url);
  }
  // The model loader requests only these local canonical paths. Redirect to
  // verified pinned assets in online mode too; never fall through to HF main.
  const get=async (path)=> {
    const url=urls.get(path);if(!url)throw new Error('Unpinned scene asset: '+path);
    const cached=await cache?.match(url);
    return cached || nativeFetch(url);
  };
  return {lock,hash,local,url:path=>urls.get(path),get,modelRoot:new URL('models/',ROOT).href};
}
