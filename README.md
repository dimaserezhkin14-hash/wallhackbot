# WallHack Pro — native C++/WASM engine

This build uses a C++17 Quoridor search engine compiled to WebAssembly and executed inside a Web Worker.

## Files
- `index.html` — game UI + Worker bridge
- `engine.worker.js` — loads the WASM engine off the main UI thread
- `quoridor.wasm` — native C++ engine

## Search
- iterative deepening
- alpha-beta pruning
- transposition table
- shortest-path based wall ordering
- tactical wall candidates around the opponent's actual shortest path
- legal jump / side-step handling
- path-existence validation after wall placement
- 20,000-node budget with a ~1.9 s UI safety timeout

GitHub Pages can serve these three files directly from the repository root.
