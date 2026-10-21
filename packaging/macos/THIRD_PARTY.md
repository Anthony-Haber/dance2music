# Dance2Music third-party notices

This distribution includes the original licenses collected from every pinned
native source dependency in the adjacent directories. `build.json` and
`native/magenta/manifest.lock.json` identify versions and integrity hashes.

* Magenta RealTime 2, Google / Magenta team: Apache-2.0 source;
  https://github.com/magenta/magenta-realtime . Dance2Music adds its IPC helper
  and embedding bridge; those modifications are in the Dance2Music source.
* MRT2 Base, Small, MusicCoCa, and SpectroStream model assets: Google,
  CC BY 4.0, https://huggingface.co/google/magenta-realtime-2 . Models are
  downloaded unchanged directly from the pinned upstream revision.
  https://creativecommons.org/licenses/by/4.0/
* MediaPipe Tasks Vision 1.0.1 and pose/gesture models: Google, Apache-2.0,
  https://github.com/google-ai-edge/mediapipe . The downloaded package README
  and package.json preserve upstream attribution. Apache license text is also
  included with the native Apache-licensed dependencies.
* Transformers.js 3.8.1: Hugging Face, Apache-2.0. ONNX Runtime: Microsoft, MIT.
  https://github.com/huggingface/transformers.js and
  https://github.com/microsoft/onnxruntime . The scene lock pins redistributed
  browser runtimes; their notices accompany the downloaded assets.
* Depth Anything V2 Small: Depth Anything authors, Apache-2.0;
  https://huggingface.co/onnx-community/depth-anything-v2-small .
* SegFormer B0 ADE: NVIDIA Source Code License for SegFormer, with use limited
  to non-commercial research or evaluation. This is not an MIT-licensed model.
  Original terms accompany the downloaded asset; conversion attribution:
  https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512 .
  https://github.com/NVlabs/SegFormer/blob/65fa8cfa9b52b6ee7e8897a98705abf8570f9e32/LICENSE
* Three.js: three.js authors, MIT. License accompanies downloaded assets.
* Salamander Grand Piano: Alexander Holm, CC BY 3.0. MP3 distribution by
  Tone.js; https://github.com/Tonejs/audio . Playback transposes nearest sample
  roots. https://creativecommons.org/licenses/by/3.0/ . Attribution and README
  accompany the downloaded samples.
* fflate 0.8.3, js-sha256 0.11.1, and KaTeX: MIT. Original notices are retained
  in `web/vendor/` alongside the bundled files.
* CPython: Python Software Foundation license; full incorporated notices in
  Python.txt. PyInstaller: GPL with its application distribution exception.
  Certifi: Mozilla Public License 2.0. Their original notices are included.

No browser, Python ML environment, source build tree, or model weights are
included in the installer. Chrome is installed separately by the user.
