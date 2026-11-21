// Sokoban solver for sokoban-solver-01-run-20261121.
//
// Idea: the levels this competition draws are a hallway with small rooms
// off it (3-4 boxes each), and a box pushed out of a room can never come
// back, so each room is an independent push-optimal problem and the
// level's optimum is the sum of its rooms'. This program therefore
//   1. splits a level into rooms (cut the hallway's dead squares out of
//      the floor; every part left that holds boxes is a room),
//   2. solves each room push-optimally with A* over pushes, and
//   3. stitches the rooms' move strings together with walks between them.
//
// The room search: a state is the boxes' squares plus the player's
// reachable region, named by its lowest square (the player can stand
// anywhere in its region for free, so the region, not the exact square,
// is what matters). Cost is pushes; the heuristic is the cheapest
// assignment of boxes to goals by shortest-path distance, which never
// overestimates because one push moves one box one square. Two
// deadlocks are pruned: a box on a square from which no push can ever
// reach a goal, and a frozen 2x2 block of walls and boxes with a box
// off its goal. A* with an admissible, consistent heuristic returns a
// push-optimal solution. Every budget is counted in work (states
// expanded), never in wall-clock time, so two runs write the same bytes.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=practice/input \
//   MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Work budgets (states expanded), counted, never timed: the same input
// always takes the same path through the search.
const ASTAR_CAP = 400_000;
const GREEDY_CAP = 150_000;
const BFS_CAP = 250_000;

// The four steps: [dx, dy, walk letter, push letter].
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

type Level = {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
};

/** Parse XSB text: # wall, ' ' floor, . goal, $ box, * box on goal, @ player, + player on goal. */
function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outer frame is wall whatever it shows: nothing leaves the board.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** The squares from which a box, pushed around alone, can still reach a goal. */
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** The lowest square the player reaches from `from` around walls and `occupied` boxes. */
function reachLow(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    // Neighbours in fixed order: up, down, left, right.
    const q0 = p - w;
    const q1 = p + w;
    const q2 = p - 1;
    const q3 = p + 1;
    if (wall[q0] === 0 && occupied[q0] === 0 && seen[q0] !== stamp) { seen[q0] = stamp; stack[n++] = q0; }
    if (wall[q1] === 0 && occupied[q1] === 0 && seen[q1] !== stamp) { seen[q1] = stamp; stack[n++] = q1; }
    if (wall[q2] === 0 && occupied[q2] === 0 && seen[q2] !== stamp) { seen[q2] = stamp; stack[n++] = q2; }
    if (wall[q3] === 0 && occupied[q3] === 0 && seen[q3] !== stamp) { seen[q3] = stamp; stack[n++] = q3; }
  }
  return low;
}

/** A box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
function frozenBlock(w: number, wall: Uint8Array, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** Shortest-path distances from every goal to every floor square (walls only, no boxes). */
function goalDistances(w: number, wall: Uint8Array, goals: number[]): Int32Array[] {
  return goals.map((g) => {
    const dist = new Int32Array(wall.length).fill(-1);
    const queue = [g];
    dist[g] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi]!;
      for (const [dx, dy] of DIRS) {
        const q = p + dy * w + dx;
        if (!wall[q] && dist[q] < 0) {
          dist[q] = dist[p]! + 1;
          queue.push(q);
        }
      }
    }
    return dist;
  });
}

/**
 * Cheapest assignment of boxes to goals by shortest-path distance.
 * Infinity when no perfect matching exists (a dead state). With 3-4
 * boxes a brute-force permutation is the cheapest honest way to do it.
 */
function assignmentCost(boxes: number[], dists: Int32Array[]): number {
  const n = boxes.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  let best = Infinity;
  const permute = (k: number, acc: number): void => {
    if (acc >= best) return;
    if (k === n) {
      best = acc;
      return;
    }
    for (let j = k; j < n; j++) {
      [idx[k], idx[j]] = [idx[j]!, idx[k]!];
      const d = dists[idx[k]!]![boxes[k]!];
      if (d >= 0) permute(k + 1, acc + d);
      [idx[k], idx[j]] = [idx[j]!, idx[k]!];
    }
  };
  permute(0, 0);
  return best;
}

/** A binary heap on [f, -g, sequence]: deterministic, smallest first. */
class Heap {
  private a: [number, number, number, number][] = [];
  get size(): number {
    return this.a.length;
  }
  push(e: [number, number, number, number]): void {
    const a = this.a;
    let i = a.length;
    a.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): [number, number, number, number] {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && less(a[c + 1]!, a[c]!)) c++;
        if (!less(a[c]!, a[i]!)) break;
        [a[i], a[c]] = [a[c]!, a[i]!];
        i = c;
      }
    }
    return top;
  }
}
function less(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
}

type Push = { box: number; dir: number }; // dir indexes DIRS; the box moves from `box` along DIRS[dir]

/**
 * Push-optimal search over one room's boxes (A*), or null when the
 * budget runs out or the room cannot be solved. `mode` picks the
 * ordering: 'astar' (g + h, optimal), 'greedy' (h only, any solution
 * fast), 'bfs' (g only, optimal but slow). The search never reads the
 * clock: `cap` counts expansions.
 */
function searchRoom(
  level: Level,
  maxStates: number,
  mode: 'astar' | 'greedy' | 'bfs',
): { pushes: Push[]; expanded: number } | null {
  const { w, wall, goals, boxes: startBoxes, player: startPlayer } = level;
  const size = wall.length;
  const n = startBoxes.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(w, wall, goals);
  const dists = goalDistances(w, wall, goals);
  const solved = (bs: number[]): boolean => bs.every((b) => goal[b]);
  if (startBoxes.some((b) => !live[b])) return null;
  if (solved(startBoxes)) return { pushes: [], expanded: 0 };

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  // Numeric state key: region's lowest square, then the boxes, in base
  // `size` — exact while size ** (n + 1) stays under 2 ** 53.
  const keyOf = (bs: number[], low: number): number => {
    let k = low;
    for (const b of bs) k = k * size + b;
    return k;
  };

  const statesBoxes: number[][] = [startBoxes];
  const statesPlayer: number[] = [startPlayer];
  const parent: number[] = [-1];
  const madeBy: (Push | null)[] = [null];
  const gOf: number[] = [0];
  const index = new Map<number, number>();
  for (const b of startBoxes) occupied[b] = 1;
  index.set(keyOf(startBoxes, reachLow(w, wall, occupied, startPlayer, seen, ++stamp, stack)), 0);
  for (const b of startBoxes) occupied[b] = 0;

  const heap = new Heap();
  let seq = 0;
  const h0 = assignmentCost(startBoxes, dists);
  if (h0 === Infinity) return null;
  const fOf = (g: number, h: number): number => (mode === 'astar' ? g + h : mode === 'greedy' ? h : g);
  heap.push([fOf(0, h0), 0, seq++, 0]);

  let expanded = 0;
  let found = -1;
  while (heap.size > 0 && expanded < maxStates) {
    const [, negG, , s] = heap.pop();
    const g = -negG;
    if (gOf[s] !== g) continue; // stale heap entry: a cheaper path to this state was found
    const boxes = statesBoxes[s]!;
    if (solved(boxes)) {
      found = s;
      break;
    }
    expanded++;
    for (const b of boxes) occupied[b] = 1;
    reachLow(w, wall, occupied, statesPlayer[s]!, seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < n; bi++) {
      const b = boxes[bi]!;
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = DIRS[di]!;
        const d = dy * w + dx;
        const t = b + d;
        // The player must stand on b - d, and t must be open floor the box can reach a goal from.
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(w, wall, occupied, goal, t);
        let key = -1;
        let next: number[] | null = null;
        let h = Infinity;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          key = keyOf(next, reachLow(w, wall, occupied, b, mark, ++stamp, stack));
          h = assignmentCost(next, dists);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || h === Infinity) continue;
        const seenIdx = index.get(key);
        if (seenIdx !== undefined) {
          // One state per key: a cheaper path replaces the old one in
          // place (its stale heap entry is skipped by the g check).
          if (gOf[seenIdx]! <= g + 1) continue;
          parent[seenIdx] = s;
          madeBy[seenIdx] = { box: b, dir: di };
          gOf[seenIdx] = g + 1;
          heap.push([fOf(g + 1, h), -(g + 1), seq++, seenIdx]);
          continue;
        }
        const t2 = statesBoxes.length;
        statesBoxes.push(next!);
        statesPlayer.push(b);
        parent.push(s);
        madeBy.push({ box: b, dir: di });
        gOf.push(g + 1);
        index.set(key, t2);
        heap.push([fOf(g + 1, h), -(g + 1), seq++, t2]);
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;
  const pushes: Push[] = [];
  for (let s = found; s > 0; s = parent[s]!) pushes.push(madeBy[s]!);
  pushes.reverse();
  return { pushes, expanded };
}

/** The shortest walk from `from` to `to` around walls and boxes (lower-case LURD). */
function walkTo(w: number, wall: Uint8Array, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

type Room = { boxes: number[]; goals: number[] };

/**
 * The level's rooms: cut the dead squares of the player's row (the
 * hallway: a box there reaches no goal) out of the floor, and each part
 * left that holds boxes is a room. Null when the level is no set of
 * rooms (a box starts in the hallway, a goal is cut off, or some part
 * holds more or fewer boxes than goals).
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** Solve one room's boxes from the current global state; null when it cannot be solved. */
function solveRoom(level: Level, room: Room, globalBoxes: number[], player: number): { moves: string; pushes: number } | null {
  const wall = level.wall.slice();
  for (const b of globalBoxes) if (!room.boxes.includes(b)) wall[b] = 1; // other rooms' boxes are walls
  const sub: Level = {
    w: level.w,
    h: level.h,
    wall,
    goals: room.goals.slice().sort((a, b) => a - b),
    boxes: room.boxes.slice().sort((a, b) => a - b),
    player,
  };
  // A* first (optimal); greedy, then plain BFS, as fallbacks that still
  // return a solution when the optimal search runs out of budget.
  const found = searchRoom(sub, ASTAR_CAP, 'astar')
    ?? searchRoom(sub, GREEDY_CAP, 'greedy')
    ?? searchRoom(sub, BFS_CAP, 'bfs');
  if (found === null) return null;
  // Turn the push list into moves: walk to each push's square, then push.
  const occupied = new Uint8Array(level.w * level.h);
  let boxes = sub.boxes.slice();
  let p = player;
  let moves = '';
  for (const push of found.pushes) {
    for (const b of boxes) occupied[b] = 1;
    const [dx, dy, , pushLetter] = DIRS[push.dir]!;
    const d = dy * level.w + dx;
    moves += walkTo(level.w, wall, occupied, p, push.box - d);
    for (const b of boxes) occupied[b] = 0;
    moves += pushLetter;
    p = push.box;
    boxes = boxes.map((b) => (b === push.box ? push.box + d : b)).sort((a, b) => a - b);
  }
  return { moves, pushes: found.pushes.length };
}

/** The level's moves: room by room, the player walking on from where the last room left it. */
function solveLevel(level: Level): string {
  const rooms = roomsOf(level);
  if (rooms === null) {
    // No room split: search the whole level as one room.
    const whole = solveRoom({ ...level, goals: level.goals, boxes: level.boxes }, { boxes: level.boxes, goals: level.goals }, [], level.player);
    return whole === null ? '' : whole.moves;
  }
  const globalBoxes = level.boxes.slice();
  let player = level.player;
  let moves = '';
  for (const room of rooms) {
    const solved = solveRoom(level, room, globalBoxes, player);
    if (solved === null) return ''; // a room left unsolved solves nothing: answer empty
    moves += solved.moves;
    // Advance the global state by simulating this room's moves, so the
    // next room starts from the true box positions (boxes on goals now).
    const sim = simulate(level.w, level.wall, globalBoxes, player, solved.moves);
    globalBoxes.splice(0, globalBoxes.length, ...sim.boxes);
    player = sim.player;
  }
  return moves;
}

/** Play `moves` on the level's walls from (`player`, `boxes`): the state after. */
function simulate(
  w: number,
  wall: Uint8Array,
  boxes: number[],
  player: number,
  moves: string,
): { boxes: number[]; player: number } {
  const bs = boxes.slice();
  let p = player;
  for (const ch of moves.toLowerCase()) {
    const d = ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
    const next = p + d;
    const at = bs.indexOf(next);
    if (at >= 0) bs[at] = next + d;
    p = next;
  }
  bs.sort((a, b) => a - b);
  return { boxes: bs, player: p };
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(I, id, 'level.txt'), 'utf8')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
