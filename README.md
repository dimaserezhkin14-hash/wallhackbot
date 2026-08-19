# Wallhack Pro — smooth engine search

This version moves the Quoridor minimax calculation into a Web Worker so the UI thread stays responsive.

## Run locally

```bash
python3 -m http.server 8080
```

Open http://localhost:8080

Do not open `index.html` directly with `file://`; Web Workers are more reliable over HTTP.

## GitHub Pages

1. Push the three files to a GitHub repository.
2. Open Settings → Pages.
3. Select **Deploy from a branch**.
4. Select `main` and `/ (root)`.
5. Save.

The search HUD is already wired into `computeEngine()` and updates depth, nodes, elapsed time and the current best move while the engine is calculating.
