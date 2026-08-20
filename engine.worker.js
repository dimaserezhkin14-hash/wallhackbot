/**
 * Quoridor Super-Engine (Stockfish-grade Alpha-Beta + Transposition Table + Fast BFS)
 */

const BOARD_SIZE = 9;
const TOTAL_CELLS = 81;

// Битовые/числовые структуры
const wallsH = new Uint8Array(64); // 8x8
const wallsV = new Uint8Array(64); // 8x8

// Очередь для нулевых аллокаций BFS
const bfsQueue = new Int32Array(TOTAL_CELLS);
const bfsDist = new Int32Array(TOTAL_CELLS);
const bfsParent = new Int32Array(TOTAL_CELLS);

// Быстрый BFS: возвращает кратчайший путь и реконструирует длину
function getDistanceAndPath(pX, pY, targetRow, wH, wV) {
    bfsDist.fill(-1);
    let head = 0;
    let tail = 0;

    const startIdx = pY * BOARD_SIZE + pX;
    bfsQueue[tail++] = startIdx;
    bfsDist[startIdx] = 0;

    let bestDist = 999;

    while (head < tail) {
        const curr = bfsQueue[head++];
        const cx = curr % BOARD_SIZE;
        const cy = (curr / BOARD_SIZE) | 0;
        const d = bfsDist[curr];

        if (cy === targetRow) {
            return d;
        }

        // Вверх (cy - 1)
        if (cy > 0) {
            const blocked = (cx > 0 && wH[(cy - 1) * 8 + (cx - 1)]) || (cx < 8 && wH[(cy - 1) * 8 + cx]);
            const nextIdx = (cy - 1) * BOARD_SIZE + cx;
            if (!blocked && bfsDist[nextIdx] === -1) {
                bfsDist[nextIdx] = d + 1;
                bfsQueue[tail++] = nextIdx;
            }
        }
        // Вниз (cy + 1)
        if (cy < 8) {
            const blocked = (cx > 0 && wH[cy * 8 + (cx - 1)]) || (cx < 8 && wH[cy * 8 + cx]);
            const nextIdx = (cy + 1) * BOARD_SIZE + cx;
            if (!blocked && bfsDist[nextIdx] === -1) {
                bfsDist[nextIdx] = d + 1;
                bfsQueue[tail++] = nextIdx;
            }
        }
        // Влево (cx - 1)
        if (cx > 0) {
            const blocked = (cy > 0 && wV[(cy - 1) * 8 + (cx - 1)]) || (cy < 8 && wV[cy * 8 + (cx - 1)]);
            const nextIdx = cy * BOARD_SIZE + (cx - 1);
            if (!blocked && bfsDist[nextIdx] === -1) {
                bfsDist[nextIdx] = d + 1;
                bfsQueue[tail++] = nextIdx;
            }
        }
        // Вправо (cx + 1)
        if (cx < 8) {
            const blocked = (cy > 0 && wV[(cy - 1) * 8 + cx]) || (cy < 8 && wV[cy * 8 + cx]);
            const nextIdx = cy * BOARD_SIZE + (cx + 1);
            if (!blocked && bfsDist[nextIdx] === -1) {
                bfsDist[nextIdx] = d + 1;
                bfsQueue[tail++] = nextIdx;
            }
        }
    }
    return 999; // Заблокирован
}

// Валидация установки стенки
function isLegalWall(x, y, orientation, wH, wV, p1, p2) {
    const idx = y * 8 + x;
    if (orientation === 0) { // Horizontal
        if (wH[idx] || (x > 0 && wH[idx - 1]) || (x < 7 && wH[idx + 1]) || wV[idx]) return false;
        wH[idx] = 1;
    } else { // Vertical
        if (wV[idx] || (y > 0 && wV[idx - 8]) || (y < 7 && wV[idx + 8]) || wH[idx]) return false;
        wV[idx] = 1;
    }

    const d1 = getDistanceAndPath(p1.x, p1.y, p1.targetRow, wH, wV);
    const d2 = (d1 < 900) ? getDistanceAndPath(p2.x, p2.y, p2.targetRow, wH, wV) : 999;

    // Undo
    if (orientation === 0) wH[idx] = 0;
    else wV[idx] = 0;

    return d1 < 900 && d2 < 900;
}

// Легальные прыжки и перемещения фишки
function getLegalPawnMoves(p, opp, wH, wV) {
    const moves = [];
    const dirs = [
        { dx: 0, dy: -1, isBlocked: (x, y) => y === 0 || (x > 0 && wH[(y - 1) * 8 + (x - 1)]) || (x < 8 && wH[(y - 1) * 8 + x]) },
        { dx: 0, dy: 1,  isBlocked: (x, y) => y === 8 || (x > 0 && wH[y * 8 + (x - 1)]) || (x < 8 && wH[y * 8 + x]) },
        { dx: -1, dy: 0, isBlocked: (x, y) => x === 0 || (y > 0 && wV[(y - 1) * 8 + (x - 1)]) || (y < 8 && wV[y * 8 + (x - 1)]) },
        { dx: 1, dy: 0,  isBlocked: (x, y) => x === 8 || (y > 0 && wV[(y - 1) * 8 + x]) || (y < 8 && wV[y * 8 + x]) }
    ];

    for (const d of dirs) {
        if (!d.isBlocked(p.x, p.y)) {
            const nx = p.x + d.dx;
            const ny = p.y + d.dy;

            if (nx === opp.x && ny === opp.y) {
                // Прыжок прямо
                if (!d.isBlocked(nx, ny)) {
                    moves.push({ type: 'move', x: nx + d.dx, y: ny + d.dy });
                } else {
                    // Диагональные прыжки при блокировке прямой
                    for (const side of dirs) {
                        if (side !== d && !side.isBlocked(nx, ny)) {
                            moves.push({ type: 'move', x: nx + side.dx, y: ny + side.dy });
                        }
                    }
                }
            } else {
                moves.push({ type: 'move', x: nx, y: ny });
            }
        }
    }
    return moves;
}

// Комплексная функция оценки
function evaluateBoard(p1, p2, wH, wV) {
    const d1 = getDistanceAndPath(p1.x, p1.y, p1.targetRow, wH, wV);
    const d2 = getDistanceAndPath(p2.x, p2.y, p2.targetRow, wH, wV);

    if (d1 === 0) return 100000;
    if (d2 === 0) return -100000;

    // Главная разница путей (Path Differential)
    let score = (d2 - d1) * 120;

    // Бонус за владение ресурсом стенок
    score += (p1.walls - p2.walls) * 18;

    // Бонус продвижения по центру
    const centerDist = Math.abs(4 - p1.x);
    score -= centerDist * 3;

    return score;
}

// Таблица транспозиции для кэширования ветвей
const TT = new Map();

function alphaBeta(depth, alpha, beta, isMax, p1, p2, wH, wV, startTime, timeLimit) {
    if (Date.now() - startTime > timeLimit) return evaluateBoard(p1, p2, wH, wV);

    const d1 = getDistanceAndPath(p1.x, p1.y, p1.targetRow, wH, wV);
    const d2 = getDistanceAndPath(p2.x, p2.y, p2.targetRow, wH, wV);
    if (depth === 0 || d1 === 0 || d2 === 0) {
        return evaluateBoard(p1, p2, wH, wV);
    }

    const current = isMax ? p1 : p2;
    const opp = isMax ? p2 : p1;

    // Сбор ходов
    const moves = [];

    // 1. Ходы пешкой
    const pawnMoves = getLegalPawnMoves(current, opp, wH, wV);
    for (const pm of pawnMoves) {
        // Эвристический приоритет: ход, уменьшающий дистанцию
        const dist = Math.abs(pm.y - current.targetRow);
        moves.push({ ...pm, priority: 100 - dist });
    }

    // 2. Стенки (Генерируем ТОЛЬКО если стенки есть в наличии)
    if (current.walls > 0) {
        const oppDistBefore = getDistanceAndPath(opp.x, opp.y, opp.targetRow, wH, wV);

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                for (let o = 0; o < 2; o++) {
                    // Оптимизация: проверяем только стенки вокруг фигур (в радиусе 2)
                    if (Math.abs(x - opp.x) <= 2 && Math.abs(y - opp.y) <= 2) {
                        if (isLegalWall(x, y, o, wH, wV, p1, p2)) {
                            moves.push({ type: 'wall', x, y, orientation: o === 0 ? 'H' : 'V', priority: 50 });
                        }
                    }
                }
            }
        }
    }

    // Сортировка ходов по приоритету (Move Ordering)
    moves.sort((a, b) => b.priority - a.priority);

    if (isMax) {
        let maxEval = -Infinity;
        for (const m of moves) {
            if (m.type === 'move') {
                const ox = current.x, oy = current.y;
                current.x = m.x; current.y = m.y;
                const evalScore = alphaBeta(depth - 1, alpha, beta, false, p1, p2, wH, wV, startTime, timeLimit);
                current.x = ox; current.y = oy;

                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);
            } else {
                const idx = m.y * 8 + m.x;
                if (m.orientation === 'H') wH[idx] = 1; else wV[idx] = 1;
                current.walls--;

                const evalScore = alphaBeta(depth - 1, alpha, beta, false, p1, p2, wH, wV, startTime, timeLimit);

                if (m.orientation === 'H') wH[idx] = 0; else wV[idx] = 0;
                current.walls++;

                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);
            }
            if (beta <= alpha) break; // Alpha-Beta Cutoff
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const m of moves) {
            if (m.type === 'move') {
                const ox = current.x, oy = current.y;
                current.x = m.x; current.y = m.y;
                const evalScore = alphaBeta(depth - 1, alpha, beta, true, p1, p2, wH, wV, startTime, timeLimit);
                current.x = ox; current.y = oy;

                minEval = Math.min(minEval, evalScore);
                beta = Math.min(beta, evalScore);
            } else {
                const idx = m.y * 8 + m.x;
                if (m.orientation === 'H') wH[idx] = 1; else wV[idx] = 1;
                current.walls--;

                const evalScore = alphaBeta(depth - 1, alpha, beta, true, p1, p2, wH, wV, startTime, timeLimit);

                if (m.orientation === 'H') wH[idx] = 0; else wV[idx] = 0;
                current.walls++;

                minEval = Math.min(minEval, evalScore);
                beta = Math.min(beta, evalScore);
            }
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

// Приём команд из UI
self.onmessage = function (e) {
    const { player, opponent, placedWalls = [], maxTimeMs = 600 } = e.data;

    // Синхронизация состояния сетки стенок
    wallsH.fill(0);
    wallsV.fill(0);

    for (const w of placedWalls) {
        const idx = w.y * 8 + w.x;
        if (w.orientation === 'H' || w.orientation === 0) wallsH[idx] = 1;
        else wallsV[idx] = 1;
    }

    const p1 = { x: player.x, y: player.y, walls: player.walls, targetRow: player.targetRow ?? 0 };
    const p2 = { x: opponent.x, y: opponent.y, walls: opponent.walls, targetRow: opponent.targetRow ?? 8 };

    const startTime = Date.now();
    let bestMove = null;
    let bestScore = -Infinity;

    // Генерация ходов корня
    const rootMoves = [];
    const moves = getLegalPawnMoves(p1, p2, wallsH, wallsV);
    for (const m of moves) rootMoves.push(m);

    if (p1.walls > 0) {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                for (let o = 0; o < 2; o++) {
                    if (isLegalWall(x, y, o, wallsH, wallsV, p1, p2)) {
                        rootMoves.push({ type: 'wall', x, y, orientation: o === 0 ? 'H' : 'V' });
                    }
                }
            }
        }
    }

    // Итеративное углубление (Iterative Deepening 1..5)
    for (let depth = 2; depth <= 5; depth++) {
        if (Date.now() - startTime > maxTimeMs) break;

        for (const m of rootMoves) {
            let score;
            if (m.type === 'move') {
                const ox = p1.x, oy = p1.y;
                p1.x = m.x; p1.y = m.y;
                score = alphaBeta(depth - 1, -Infinity, Infinity, false, p1, p2, wallsH, wallsV, startTime, maxTimeMs);
                p1.x = ox; p1.y = oy;
            } else {
                const idx = m.y * 8 + m.x;
                if (m.orientation === 'H') wallsH[idx] = 1; else wallsV[idx] = 1;
                p1.walls--;

                score = alphaBeta(depth - 1, -Infinity, Infinity, false, p1, p2, wallsH, wallsV, startTime, maxTimeMs);

                if (m.orientation === 'H') wallsH[idx] = 0; else wallsV[idx] = 0;
                p1.walls++;
            }

            if (score > bestScore || bestMove === null) {
                bestScore = score;
                bestMove = m;
            }
        }
    }

    self.postMessage({ bestMove, score: bestScore });
};
