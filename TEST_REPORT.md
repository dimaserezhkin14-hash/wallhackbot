# Engine verification

Verified before packaging:

- WebAssembly module compiles successfully with LLVM/wasm-ld.
- Module imports only `env.memory` and `env.now_ms`.
- Immediate-win position returns the winning pawn move.
- Empty standard starting position returns the opening pawn move without spending a wall.
- Three 9x9 self-play games completed without illegal/null moves; winners reached the goal in 39-41 plies with the engine search enabled on both sides.
- Search is time-bounded; the last fully completed iterative-deepening depth is returned.
- UI search is routed through `engine.worker.js`, so the heavy calculation is not run on the page's main thread.
