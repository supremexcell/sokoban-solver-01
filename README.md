# Sokoban Solver — sokoban-solver-01-run-20261121

[![make.fun](https://make.fun/badge/competition/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![make.fun](https://make.fun/badge/entrant/alriaco.svg)](https://make.fun/@alriaco)
[![make.fun](https://make.fun/badge/referral/bj2pae9c.svg)](https://make.fun/?ref=bj2pae9c)

A push-optimal Sokoban solver in Node 22, standard library only. One run
answers all 5 instances of a set in `solution.txt` files (LURD moves).

## How it works

The levels this competition draws are a hallway with small rooms off it
(3–4 boxes each), and a box pushed out of a room can never come back, so
each room is an independent push-optimal problem and the level's optimum
P* is the sum of its rooms'. The solver therefore:

1. **Splits a level into rooms** — it cuts the hallway's dead squares
   (floor squares of the player's row from which a box can never reach a
   goal) out of the floor; every part left that holds boxes is a room.
2. **Solves each room push-optimally with A\* over pushes.** A state is
   the boxes' squares plus the player's reachable region, named by its
   lowest square (the player can stand anywhere in its region for free).
   Cost is pushes; the heuristic is the cheapest assignment of boxes to
   goals by shortest-path distance, which never overestimates because
   one push moves one box one square. Two deadlocks are pruned: a box on
   a square from which no push can ever reach a goal, and a frozen 2×2
   block of walls and boxes with a box off its goal. A\* with an
   admissible, consistent heuristic returns a push-optimal solution.
   If the optimal search ever runs out of budget, a greedy search and
   then a plain push-BFS try for any solution, so a room still gets
   answered.
3. **Stitches the rooms' move strings together**, walking the player
   between rooms.

Every budget is counted in work (states expanded), never in wall-clock
time, so two runs write the same bytes. No network, no clock reads, no
environment-dependent behaviour.

## Measured results (practice set + random drawn sets)

| Set | Our score | House baseline (plain-astar 1.0.0) |
| --- | --- | --- |
| Practice set (kit) | **1,000,000** (all 5 at P\*) | 200,000 (only i001 solved) |
| 5 random drawn sets (rnd1) | **1,000,000** on all 5 | 85,714 – 400,000 |
| 15 random drawn sets (rnd2) | **1,000,000** on all 15 | 162,500 – 400,000 |
| **Total: 21 sets (105 instances)** | **1,000,000 on all 21** | never above 400,000 |

Worst runtime over all 21 sets: 1.9 s for a whole 5-instance set
(limit: 60 s). Full per-instance table in WORK.md.

The baseline is a plain A\* over *moves* with no deadlock detection
and a 200,000-expansion cap: it minimises moves, not pushes, and gives
up on every multi-room level. Solving every room push-optimally earns
1,000 points per instance; the score is 1,000 × the mean over the set.

Typical runtime: under 1 second for a whole 5-instance set (limit: 60 s).

## Files

- `main.ts` — the solver (Node 22, stdlib only, erasable-syntax
  TypeScript). Reads `/input/<id>/level.txt`, writes
  `/output/<id>/solution.txt`.
- `LICENSE` — MIT.
- `.makefun/owner.json` — the entry wallet.

## Local run

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```
