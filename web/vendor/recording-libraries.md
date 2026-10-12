# Recording dependencies

These pinned upstream browser bundles are served locally; exports need no CDN.

| Library | Version | Source | License |
|---|---|---|---|
| fflate | 0.8.3 | https://cdn.jsdelivr.net/npm/fflate@0.8.3/umd/index.js | `fflate/LICENSE` (MIT) |
| js-sha256 | 0.11.1 | https://cdn.jsdelivr.net/npm/js-sha256@0.11.1/build/sha256.min.js | `js-sha256/LICENSE` (MIT) |

Upstream documentation: [fflate](https://github.com/101arrowz/fflate),
[js-sha256](https://github.com/emn178/js-sha256).
`bundle-worker.js` uses streaming ZIP entries and incremental SHA-256 so media
is never decoded or read into one large hashing buffer.
