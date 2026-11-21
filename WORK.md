# WORK.md — Sokoban solver, measurement log

Built 2026-11-21 by Skadi (subagent) for Vicko. Entry #16 on the road
to 100. Bounty: sokoban-solver-01-run-20261121, $100 (10 × $10),
deadline Mon 23 Nov 2026 10:00 WIB, no fee. Reward needs a score
strictly above the house baseline plain-astar 1.0.0.

## Scoring (one paragraph)

Each instance's answer is `solution.txt` (LURD moves, case ignored);
the checker replays it: an illegal step scores 0, an unsolved replay
scores 0, a solved replay earns 1,000 points when it takes P* pushes
(the level's push-optimal count, known by construction) and
500 × P*/pushes when it takes more. Score = 1,000 × the mean points
over the 5 instances, rounded half up: 0 to 1,000,000. A reward also
needs every instance answered and a score strictly above the baseline's
on the scored set (drawn from drand round 34200012 after the deadline).

## Approach

Room decomposition + push-space A* (see main.ts header for the full
description). A state is the boxes plus the player's reachable region
named by its lowest square; cost is pushes; the heuristic is the
cheapest box→goal assignment by shortest-path distance (admissible);
dead-square and frozen-2×2 pruning; greedy and plain push-BFS as
fallbacks if A* ever runs out of its work budget. All budgets count
states expanded, never wall-clock time.

## Practice set (kit) — ours vs baseline

| inst | P* | ours (pushes) | ours (points) | baseline (points) |
| ---- | -- | ------------- | ------------- | ----------------- |
| i001 | 13 | 13 | 1000 | 1000 (13 pushes) |
| i002 | 16 | 16 | 1000 | 0 (gave up) |
| i003 | 29 | 29 | 1000 | 0 (gave up) |
| i004 | 47 | 47 | 1000 | 0 (gave up) |
| i005 | 60 | 60 | 1000 | 0 (gave up) |
| **score** | | | **1,000,000** | **200,000** |

Our runtime on the practice set: 0.42 s (baseline: 5.5 s).

## Random drawn sets (kit generator, fresh seeds)

20 sets drawn with `program/generator/draw.ts` (seeds sha256 of
`rnd1-N` / `rnd2-N`), each scored with the kit scorer for both our
solver and the baseline. Every instance solved at exactly P*.

| set | P* | ours | baseline | our time |
| --- | --- | --- | --- | --- |
| rnd1-0 | 12,19,35,43,59 | 1,000,000 | 85,714 | 541 ms |
| rnd1-1 | 17,15,34,47,60 | 1,000,000 | 200,000 | 457 ms |
| rnd1-2 | 12,15,35,45,57 | 1,000,000 | 288,235 | 385 ms |
| rnd1-3 | 15,14,32,45,62 | 1,000,000 | 400,000 | 473 ms |
| rnd1-4 | 12,14,33,45,61 | 1,000,000 | 400,000 | 364 ms |
| rnd2-0 | 14,16,29,47,60 | 1,000,000 | 400,000 | 374 ms |
| rnd2-1 | 12,14,31,47,57 | 1,000,000 | 162,500 | 364 ms |
| rnd2-2 | 20,14,31,45,67 | 1,000,000 | 200,000 | 438 ms |
| rnd2-3 | 15,14,30,42,58 | 1,000,000 | 287,500 | 348 ms |
| rnd2-4 | 13,14,28,49,62 | 1,000,000 | 400,000 | 373 ms |
| rnd2-5 | 12,14,31,44,65 | 1,000,000 | 277,778 | 475 ms |
| rnd2-6 | 12,21,29,47,64 | 1,000,000 | 200,000 | 411 ms |
| rnd2-7 | 18,14,28,45,56 | 1,000,000 | 200,000 | 724 ms |
| rnd2-8 | 12,16,30,47,60 | 1,000,000 | 200,000 | 512 ms |
| rnd2-9 | 12,14,28,50,60 | 1,000,000 | 200,000 | 788 ms |
| rnd2-10 | 12,18,35,48,59 | 1,000,000 | 200,000 | 1,608 ms |
| rnd2-11 | 12,15,29,43,62 | 1,000,000 | 400,000 | 1,924 ms |
| rnd2-12 | 13,14,31,45,58 | 1,000,000 | 200,000 | 1,936 ms |
| rnd2-13 | 14,15,28,46,60 | 1,000,000 | 200,000 | 1,305 ms |
| rnd2-14 | 12,22,28,45,59 | 1,000,000 | 200,000 | 659 ms |

Summary: **21/21 sets perfect (1,000,000), 105/105 instances at P\***.
Baseline never scored above 400,000 on any set. Worst our-solver
time: 1,936 ms (limit 60,000 ms).

Why the baseline is so weak here: it is a plain A* over *moves* with
no deadlock detection and a 200,000-expansion cap per level. It
minimises moves, not pushes (so even a solved level can score under
500 points), and on every multi-room level it burns its budget on
dead positions and gives up (empty solution).

## Verification

- Determinism: two runs on the practice set, `diff -r` clean.
- `makefun check --worktree`: 5 passed (competition_open, snapshot,
  license_osi, entrypoint, entry_size), 0 failed, 15 skipped
  (transcripts NOT required for this competition —
  `transcripts_required: false` in competition.yaml), 5 at submission.
  Repo 22,663 bytes (cap 1 MiB); largest file main.ts 18,398 bytes.
- No external refs, no network, no clock reads, stdlib only.

## Still needed (not done here)

- Vicko approves the entry (the measurement says: submit — it beats
  the baseline on every measured set by 600,000+ points).
- Create the public GitHub repo `sokoban-solver-01`, push, submit
  before Mon 23 Nov 2026 10:00 WIB. No transcript bundle is needed
  for this competition.
