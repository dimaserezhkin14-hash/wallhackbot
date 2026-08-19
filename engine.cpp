#include <emscripten/emscripten.h>
#include <vector>
#include <queue>
#include <cmath>
#include <algorithm>
#include <cstring>

const int DIRS[4][2] = {{-1,0},{1,0},{0,-1},{0,1}};

struct Pos { int r, c; };
struct GameState {
    Pos me, opp;
    int meWalls, oppWalls;
    bool wallsH[13][8];
    bool wallsV[13][8];
};

bool inBoard(int r, int c, int rows) { return r >= 0 && r < rows && c >= 0 && c < 9; }

bool edgeBlocked(int r1, int c1, int r2, int c2, const GameState& s) {
    int dr = r2 - r1, dc = c2 - c1;
    if (dr == 0 && std::abs(dc) == 1) {
        int c = std::min(c1, c2);
        if (s.wallsV[r1][c] || (r1 > 0 && s.wallsV[r1 - 1][c])) return true;
    }
    if (dc == 0 && std::abs(dr) == 1) {
        int r = std::min(r1, r2);
        if (s.wallsH[r][c1] || (c1 > 0 && s.wallsH[r][c1 - 1])) return true;
    }
    return false;
}

int bfs(Pos start, int goalRow, int rows, const GameState& s) {
    if (start.r == goalRow) return 0;
    int dist[13][9];
    std::memset(dist, -1, sizeof(dist));
    std::queue<Pos> q;
    dist[start.r][start.c] = 0;
    q.push(start);

    while (!q.empty()) {
        Pos cur = q.front(); q.pop();
        int d = dist[cur.r][cur.c];
        if (cur.r == goalRow) return d;

        for (int i = 0; i < 4; ++i) {
            int nr = cur.r + DIRS[i][0], nc = cur.c + DIRS[i][1];
            if (inBoard(nr, nc, rows) && dist[nr][nc] == -1) {
                if (!edgeBlocked(cur.r, cur.c, nr, nc, s)) {
                    dist[nr][nc] = d + 1;
                    q.push({nr, nc});
                }
            }
        }
    }
    return 9999;
}

int evaluate(const GameState& s, int rows, int myGoal, int oppGoal) {
    int myDist = bfs(s.me, myGoal, rows, s);
    int oppDist = bfs(s.opp, oppGoal, rows, s);
    if (myDist == 0) return 50000;
    if (oppDist == 0) return -50000;
    if (myDist >= 9999) return -40000;
    if (oppDist >= 9999) return 40000;

    int score = (oppDist - myDist) * 160;
    score += (s.meWalls - s.oppWalls) * 20;
    score += (4 - std::abs(s.me.c - 4)) * 6;
    return score;
}

struct Move { int type, r, c, o, priority; };

int minimax(GameState s, int depth, int alpha, int beta, bool isMax, int rows, int myGoal, int oppGoal) {
    if (s.me.r == myGoal) return 50000 + depth;
    if (s.opp.r == oppGoal) return -50000 - depth;
    if (depth == 0) return evaluate(s, rows, myGoal, oppGoal);

    Pos curP = isMax ? s.me : s.opp;
    int goal = isMax ? myGoal : oppGoal;
    int curWalls = isMax ? s.meWalls : s.oppWalls;

    std::vector<Move> moves;
    int curDist = bfs(curP, goal, rows, s);

    for (int i = 0; i < 4; ++i) {
        int nr = curP.r + DIRS[i][0], nc = curP.c + DIRS[i][1];
        if (inBoard(nr, nc, rows) && !edgeBlocked(curP.r, curP.c, nr, nc, s)) {
            GameState ns = s;
            if (isMax) ns.me = {nr, nc}; else ns.opp = {nr, nc};
            int d = bfs({nr, nc}, goal, rows, ns);
            moves.push_back({0, nr, nc, 0, (curDist - d) * 60});
        }
    }

    if (curWalls > 0) {
        for (int r = 0; r < rows - 1; ++r) {
            for (int c = 0; c < 8; ++c) {
                for (int o = 0; o < 2; ++o) {
                    if (o == 0 && s.wallsH[r][c]) continue;
                    if (o == 1 && s.wallsV[r][c]) continue;

                    GameState ns = s;
                    if (o == 0) ns.wallsH[r][c] = true; else ns.wallsV[r][c] = true;
                    if (isMax) ns.meWalls--; else ns.oppWalls--;

                    int myD = bfs(ns.me, myGoal, rows, ns);
                    int oppD = bfs(ns.opp, oppGoal, rows, ns);
                    if (myD >= 9999 || oppD >= 9999) continue;

                    int delay = (isMax ? oppD : myD) - (isMax ? bfs(s.opp, oppGoal, rows, s) : bfs(s.me, myGoal, rows, s));
                    if (delay > 0) moves.push_back({o + 1, r, c, o, delay * 50});
                }
            }
        }
    }

    std::sort(moves.begin(), moves.end(), [](const Move& a, const Move& b){ return a.priority > b.priority; });
    if (moves.size() > 12) moves.resize(12);

    if (isMax) {
        int maxEval = -999999;
        for (const auto& m : moves) {
            GameState ns = s;
            if (m.type == 0) ns.me = {m.r, m.c};
            else { if (m.o == 0) ns.wallsH[m.r][m.c] = true; else ns.wallsV[m.r][m.c] = true; ns.meWalls--; }
            int ev = minimax(ns, depth - 1, alpha, beta, false, rows, myGoal, oppGoal);
            maxEval = std::max(maxEval, ev);
            alpha = std::max(alpha, ev);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        int minEval = 999999;
        for (const auto& m : moves) {
            GameState ns = s;
            if (m.type == 0) ns.opp = {m.r, m.c};
            else { if (m.o == 0) ns.wallsH[m.r][m.c] = true; else ns.wallsV[m.r][m.c] = true; ns.oppWalls--; }
            int ev = minimax(ns, depth - 1, alpha, beta, true, rows, myGoal, oppGoal);
            minEval = std::min(minEval, ev);
            beta = std::min(beta, ev);
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

extern "C" {
    EMSCRIPTEN_KEEPALIVE
    int solve_quoridor(int myR, int myC, int myW, int oppR, int oppC, int oppW, int rows, int myGoal, int oppGoal, int numWalls, int* wallData) {
        GameState s;
        s.me = {myR, myC}; s.meWalls = myW;
        s.opp = {oppR, oppC}; s.oppWalls = oppW;
        std::memset(s.wallsH, 0, sizeof(s.wallsH));
        std::memset(s.wallsV, 0, sizeof(s.wallsV));

        for (int i = 0; i < numWalls * 3; i += 3) {
            int r = wallData[i], c = wallData[i+1], o = wallData[i+2];
            if (o == 0) s.wallsH[r][c] = true;
            else s.wallsV[r][c] = true;
        }

        int bestScore = -999999;
        int bestMoveEncoded = 0;

        for (int i = 0; i < 4; ++i) {
            int nr = s.me.r + DIRS[i][0], nc = s.me.c + DIRS[i][1];
            if (inBoard(nr, nc, rows) && !edgeBlocked(s.me.r, s.me.c, nr, nc, s)) {
                GameState ns = s;
                ns.me = {nr, nc};
                int sc = minimax(ns, 3, -999999, 999999, false, rows, myGoal, oppGoal);
                if (sc > bestScore) {
                    bestScore = sc;
                    bestMoveEncoded = (0 << 16) | (nr << 8) | nc;
                }
            }
        }

        if (s.meWalls > 0) {
            for (int r = 0; r < rows - 1; ++r) {
                for (int c = 0; c < 8; ++c) {
                    for (int o = 0; o < 2; ++o) {
                        if (o == 0 && s.wallsH[r][c]) continue;
                        if (o == 1 && s.wallsV[r][c]) continue;

                        GameState ns = s;
                        if (o == 0) ns.wallsH[r][c] = true; else ns.wallsV[r][c] = true;
                        ns.meWalls--;

                        int myD = bfs(ns.me, myGoal, rows, ns);
                        int oppD = bfs(ns.opp, oppGoal, rows, ns);
                        if (myD >= 9999 || oppD >= 9999) continue;

                        int sc = minimax(ns, 3, -999999, 999999, false, rows, myGoal, oppGoal);
                        if (sc > bestScore) {
                            bestScore = sc;
                            bestMoveEncoded = ((o + 1) << 16) | (r << 8) | c;
                        }
                    }
                }
            }
        }
        return bestMoveEncoded;
    }

    int main() {
        return 0;
    }
}
