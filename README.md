# Wall Hack Bot — fast engine

This version uses a small UI search indicator and a compiled C++ WebAssembly engine running inside a Web Worker.

- Search target: about 0.7–1.5 seconds.
- The page UI stays responsive because the engine runs in a Worker.
- `index.html`, `engine.worker.js` and `quoridor.wasm` must stay in the same folder.

For GitHub Pages, upload all four files from this folder to the repository root.
