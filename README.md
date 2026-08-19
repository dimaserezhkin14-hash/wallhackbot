Wallhack Pro — Hybrid Final

GitHub Pages files:
- index.html
- engine.worker.js
- quoridor.wasm

The engine suggestion is NOT applied automatically. The player must press “Применить совет”.

Search architecture:
- C++ -> WebAssembly
- Web Worker isolation
- iterative deepening alpha-beta
- transposition table
- tactical wall candidate generation and ordering
- wider root wall consideration
- legality verification before showing the suggestion

The browser uses a 25,000-node budget and a hard 1.85s UI timeout.
