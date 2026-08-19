# Wall Hack Bot — strong native WASM engine

This build keeps the original UI and rules, but the actual hint search runs in a Web Worker using a compiled WebAssembly engine.

## Engine
- alpha-beta / negamax search
- iterative deepening
- transposition table
- move ordering
- shortest-path BFS evaluation
- legal pawn jumps and diagonal jumps
- legal wall placement with path-preservation checks
- root search is wider than deep search
- 1.8 second time budget, with the last fully completed depth returned

The standard 9x9 Quoridor game has a very large state space and is not fully solved, so no honest engine can guarantee that it will "almost never lose" in every position. This build is designed to spend the full short time budget searching as deeply as the device allows.

## GitHub Pages
Upload these files to the repository root:

- `index.html`
- `engine.worker.js`
- `quoridor.wasm`
- `README.md`

Keep all four files together.
