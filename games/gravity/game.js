'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let settings      = null;
let state         = null;
let hasShownRules = false;
let vertexEls     = {};
let counterEl     = null;
let boardGeom     = null;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_UNIT_X = 34;
const MAX_UNIT_X = 100;
const PADDING_RATIO = 0.5; // padding is always >= counterR (0.30*unitX), so nothing at the edge can ever be clipped by the SVG's own viewBox

const key = (i, x) => `${i}_${x}`;

// A fixed, deterministic per-lane size driven only by the board's own
// dimensions - no measuring of live layout (clientWidth, getBoundingClientRect,
// scroll position, etc). Earlier attempts tried to have the board grow to fill
// whatever space the container happened to measure out to, but every one of
// those measurements turned out to have an edge case that let the board size
// itself larger than what was actually visible. This trades "fills the
// container exactly" for "physically cannot overflow it" - the actual display
// size is then capped down (never up) by plain CSS (max-width: 100%,
// max-height: 70vh in styles.css), which the browser's layout engine enforces
// natively and can't get out of sync with reality the way JS math can.
function computeUnitX(H, W) {
  const k = (W - 1) / 2;
  const extent = H + 2 * k; // rough combined measure of the board's height and width
  // Inverse-square-root rather than a plain inverse: a plain 1/extent made
  // the largest board (H=11,W=7) shrink much more aggressively relative to
  // the default (H=7,W=3) than actually wanted - sqrt keeps that spread gentler.
  return Math.max(MIN_UNIT_X, Math.min(MAX_UNIT_X, 238 / Math.sqrt(extent)));
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const settingsScreen    = $('settings-screen');
const gameScreen        = $('game-screen');
const turnIndicator     = $('turn-indicator');
const boardSvg          = $('gravity-board');
const promptSection     = $('prompt-section');
const promptLabel       = $('prompt-label');
const thinkingIndicator = $('thinking-indicator');
const rulesPanel        = $('rules-panel');
const gameOverPanel     = $('game-over-panel');
const winnerText        = $('winner-text');
const closeSettingsBtn  = $('close-settings-btn');

// ── Rules ─────────────────────────────────────────────────────────────────────

const RULES = {
  title: 'Gravity',
  lines: [
    'Gravity is a game for two players.',
    'The game starts with a counter at the top.',
    'On your turn, move the counter downwards.',
    'The player who moves the counter to the lowest point wins.',
  ],
};

function showRulesPanel() {
  $('rules-panel-title').textContent = RULES.title;
  const list = $('rules-list');
  list.innerHTML = '';
  RULES.lines.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  rulesPanel.classList.add('active');
}

// ── Board topology ────────────────────────────────────────────────────────────
//
// The board is a chain of regular hexagons (each split into 6 equilateral
// triangles around its centre), stacked so each shares its bottom two
// triangles with the top two of the next. A hexagon has a vertex directly
// above its centre and a vertex directly below it, so within a row of
// vertices at half-integer row-index spacing, "row" i's envelope
// e(i) = min(i, H-1-i, k) - where k = (W-1)/2 - grows from the top apex,
// plateaus at k, then shrinks to the bottom apex. Only x with the same
// parity as i are populated (the standard brick offset of a triangular
// lattice), so every hexagon-boundary edge is a diagonal (down-left/right)
// to the next row, while every hexagon *spoke* through its centre is a
// vertical edge two rows tall (e.g. the apex straight down to the centre).
// Both edge types have the same length, so every face is an equilateral
// triangle, and a vertex can have up to 3 downward moves: straight down
// (the two-row spoke), down-left and down-right (the one-row diagonals).

function buildBoard(H, W) {
  const k = (W - 1) / 2;
  const rows = [];
  for (let i = 0; i < H; i++) {
    const e = Math.min(i, H - 1 - i, k);
    const xs = [];
    for (let x = -e; x <= e; x++) {
      if (((x - i) % 2 + 2) % 2 === 0) xs.push(x);
    }
    rows.push(xs);
  }

  const rowSets = rows.map(xs => new Set(xs));
  const adj = new Map();
  for (let i = 0; i < H; i++) {
    rows[i].forEach(x => {
      const targets = [];
      if (i + 1 < H) {
        [x - 1, x + 1].forEach(tx => {
          if (rowSets[i + 1].has(tx)) targets.push({ i: i + 1, x: tx });
        });
      }
      if (i + 2 < H && rowSets[i + 2].has(x)) targets.push({ i: i + 2, x });
      adj.set(key(i, x), targets);
    });
  }

  return { H, W, rows, adj };
}

// win.get(key(i,x)) === true means the player about to move from (i,x) can
// force being the one who eventually moves the counter onto the bottom vertex.
function solveBoard(board) {
  const { H, rows, adj } = board;
  const win = new Map();

  for (let i = H - 1; i >= 0; i--) {
    rows[i].forEach(x => {
      if (i === H - 1) {
        win.set(key(i, x), false);
        return;
      }
      const targets = adj.get(key(i, x));
      win.set(key(i, x), targets.some(t => win.get(key(t.i, t.x)) === false));
    });
  }

  return win;
}

// ── AI – Expert ───────────────────────────────────────────────────────────────
//
// Plays optimally: moves to any child position that is losing for the
// opponent (per the backward-induction solve above). If no such move exists
// the position is already lost against perfect play, so any move is as good
// as any other.

function expertMove(board, win, pos) {
  const targets = board.adj.get(key(pos.i, pos.x));
  const winning = targets.filter(t => win.get(key(t.i, t.x)) === false);
  const pool = winning.length ? winning : targets;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── AI – Novice ───────────────────────────────────────────────────────────────
//
// One-ply lookahead only: takes an immediate win if available, otherwise
// avoids handing the opponent an immediate win next turn where possible, and
// falls back to a random legal move.

function noviceMove(board, pos) {
  const bottomRow = board.H - 1;
  const targets = board.adj.get(key(pos.i, pos.x));

  const immediateWins = targets.filter(t => t.i === bottomRow);
  if (immediateWins.length) return immediateWins[Math.floor(Math.random() * immediateWins.length)];

  const safe = targets.filter(t => {
    const further = board.adj.get(key(t.i, t.x)) || [];
    return !further.some(t2 => t2.i === bottomRow);
  });
  const pool = safe.length ? safe : targets;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Game lifecycle ────────────────────────────────────────────────────────────

function isComputerOpponent() {
  return settings.opponent === 'computer' || settings.opponent === 'expert';
}

function playerName(p) {
  if (p === 2 && isComputerOpponent()) return 'Computer';
  return p === 1 ? 'Player 1' : 'Player 2';
}

function readSettings() {
  return {
    height:      parseInt(document.querySelector('input[name="height"]:checked').value, 10),
    width:       parseInt(document.querySelector('input[name="width"]:checked').value, 10),
    opponent:    document.querySelector('input[name="opponent"]:checked').value,
    firstPlayer: document.querySelector('input[name="first-player"]:checked').value,
  };
}

function startGame() {
  settings = readSettings();
  const firstGame = !hasShownRules;
  launchGame(firstGame);
  if (firstGame) {
    hasShownRules = true;
    showRulesPanel();
  }
}

function launchGame(suppressComputerStart = false) {
  let currentPlayer;
  if (settings.firstPlayer === 'player1')      currentPlayer = 1;
  else if (settings.firstPlayer === 'player2') currentPlayer = 2;
  else currentPlayer = Math.random() < 0.5 ? 1 : 2;

  const board = buildBoard(settings.height, settings.width);
  const win = solveBoard(board);

  state = {
    board, win,
    pos: { i: 0, x: board.rows[0][0] },
    currentPlayer,
    over: false,
    winner: null,
    busy: false,
  };

  settingsScreen.hidden = true;
  gameScreen.hidden = false;
  window.scrollTo(0, 0);

  buildBoardSvg();
  renderAll();
  gameOverPanel.classList.remove('active');

  if (!suppressComputerStart && isComputerTurn()) scheduleComputer();
}

function isComputerTurn() {
  return !state.over && isComputerOpponent() && state.currentPlayer === 2;
}

// ── Move execution ────────────────────────────────────────────────────────────

function handleVertexClick(ni, nx) {
  if (state.busy || state.over || isComputerTurn()) return;
  applyMove(ni, nx);
}

function applyMove(ni, nx) {
  if (state.busy || state.over) return;
  state.busy = true;

  const mover = state.currentPlayer;
  const fromPos = state.pos;
  const toPos = { i: ni, x: nx };

  // Re-render now (clears the old highlights/prompt, via `busy`) before the
  // counter's logical position changes, then hand off to the slide
  // animation. state.pos itself - and therefore the new legal moves, game
  // over check, and the computer's next turn - only become real once the
  // counter has actually finished sliding there, so nothing ever has to be
  // computed from (or clicked on) a mid-slide, non-vertex position.
  renderAll();

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnim();
    positionCounter(toPos.i, toPos.x); // snap to the exact resting spot

    state.pos = toPos;
    if (toPos.i === state.board.H - 1) {
      state.over = true;
      state.winner = mover;
    } else {
      state.currentPlayer = mover === 1 ? 2 : 1;
    }
    state.busy = false;
    renderAll();

    if (isComputerTurn()) scheduleComputer();
  }

  const cancelAnim = animateCounterSlide(fromPos, toPos, finish);

  // Safety net: requestAnimationFrame is throttled or fully paused in a
  // backgrounded/minimised tab, which would otherwise leave the game stuck
  // mid-move indefinitely. This guarantees the move still resolves on
  // schedule even if the animation itself never gets to run.
  setTimeout(finish, COUNTER_SLIDE_MS + 150);
}

function scheduleComputer() {
  state.busy = true;
  thinkingIndicator.hidden = false;
  renderPrompt();

  setTimeout(() => {
    thinkingIndicator.hidden = true;
    state.busy = false;

    const move = settings.opponent === 'expert'
      ? expertMove(state.board, state.win, state.pos)
      : noviceMove(state.board, state.pos);

    applyMove(move.i, move.x);
  }, 750);
}

// ── Render ────────────────────────────────────────────────────────────────────

function buildBoardSvg() {
  const { H, W, rows, adj } = state.board;

  const unitX = computeUnitX(H, W);
  const rowSpacing = unitX / Math.sqrt(3);
  const padding = unitX * PADDING_RATIO;
  const edgeStrokeWidth = unitX * 0.035;
  const vertexStrokeWidth = unitX * 0.028;
  const vertexR = unitX * 0.22;
  const counterR = unitX * 0.30;

  const maxAbsX = (W - 1) / 2;
  const boardWidthPx  = 2 * maxAbsX * unitX + padding * 2;
  const boardHeightPx = (H - 1) * rowSpacing + padding * 2;
  const centerX = boardWidthPx / 2;

  const sx = x => centerX + x * unitX;
  const sy = i => padding + i * rowSpacing;
  boardGeom = { sx, sy };

  boardSvg.innerHTML = '';
  boardSvg.setAttribute('viewBox', `0 0 ${boardWidthPx} ${boardHeightPx}`);

  // This is the board's natural size - the actual on-screen size is then
  // capped (never enlarged) by CSS (max-width: 100%, max-height: 65vh),
  // which the browser guarantees can't overflow its container.
  boardSvg.style.width = `${boardWidthPx}px`;
  boardSvg.style.height = 'auto';

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = `
    <radialGradient id="counterGradient" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#f5d030"/>
      <stop offset="55%" stop-color="#c87828"/>
      <stop offset="100%" stop-color="#8a4f16"/>
    </radialGradient>
  `;
  boardSvg.appendChild(defs);

  const edgeGroup = document.createElementNS(SVG_NS, 'g');
  rows.forEach((xs, i) => {
    xs.forEach(x => {
      adj.get(key(i, x)).forEach(t => {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'board-edge');
        line.setAttribute('x1', sx(x));
        line.setAttribute('y1', sy(i));
        line.setAttribute('x2', sx(t.x));
        line.setAttribute('y2', sy(t.i));
        line.style.strokeWidth = edgeStrokeWidth;
        edgeGroup.appendChild(line);
      });
    });
  });
  boardSvg.appendChild(edgeGroup);

  vertexEls = {};
  const vertexGroup = document.createElementNS(SVG_NS, 'g');
  rows.forEach((xs, i) => {
    xs.forEach(x => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('class', 'board-vertex');
      c.setAttribute('cx', sx(x));
      c.setAttribute('cy', sy(i));
      c.setAttribute('r', vertexR);
      c.style.strokeWidth = vertexStrokeWidth;
      vertexGroup.appendChild(c);
      vertexEls[key(i, x)] = c;
    });
  });
  boardSvg.appendChild(vertexGroup);

  counterEl = document.createElementNS(SVG_NS, 'circle');
  counterEl.setAttribute('class', 'board-counter');
  counterEl.setAttribute('r', counterR);
  counterEl.style.strokeWidth = vertexStrokeWidth;
  boardSvg.appendChild(counterEl);
}

function renderAll() {
  updateBoard();
  renderTurnIndicator();
  renderPrompt();
  renderGameOver();
}

// Every edge on the board is the same length (the board is built from
// equilateral triangles - see the comment above buildBoard), so unlike the
// hopper game's hops, a gravity move never needs its duration scaled by
// distance - a single fixed duration always matches the distance travelled.
const COUNTER_SLIDE_MS = 450;

// Slow-start, slow-end easing (fast in the middle) - matches the hopper game.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function positionCounter(i, x) {
  counterEl.setAttribute('cx', boardGeom.sx(x));
  counterEl.setAttribute('cy', boardGeom.sy(i));
}

// Animates the counter from fromPos to toPos, calling onDone once it
// arrives. state.pos is deliberately left untouched until then (see
// applyMove) - the animation only ever moves between two real vertices, and
// nothing reads a position while one is in flight.
function animateCounterSlide(fromPos, toPos, onDone) {
  const startCx = boardGeom.sx(fromPos.x);
  const startCy = boardGeom.sy(fromPos.i);
  const targetCx = boardGeom.sx(toPos.x);
  const targetCy = boardGeom.sy(toPos.i);
  const startTime = performance.now();
  let cancelled = false;

  function frame(now) {
    if (cancelled) return;
    const t = Math.min(1, (now - startTime) / COUNTER_SLIDE_MS);
    const eased = easeInOutCubic(t);
    counterEl.setAttribute('cx', startCx + (targetCx - startCx) * eased);
    counterEl.setAttribute('cy', startCy + (targetCy - startCy) * eased);
    if (t < 1) requestAnimationFrame(frame);
    else onDone();
  }
  requestAnimationFrame(frame);

  return () => { cancelled = true; };
}

function updateBoard() {
  const { i, x } = state.pos;
  positionCounter(i, x);

  Object.values(vertexEls).forEach(el => {
    el.classList.remove('legal', 'p1', 'p2');
    el.onclick = null;
  });

  const clickable = !state.over && !state.busy && !isComputerTurn();
  if (!clickable) return;

  const playerClass = `p${state.currentPlayer}`;
  const targets = state.board.adj.get(key(i, x)) || [];
  targets.forEach(t => {
    const el = vertexEls[key(t.i, t.x)];
    el.classList.add('legal', playerClass);
    el.onclick = () => handleVertexClick(t.i, t.x);
  });
}

function renderTurnIndicator() {
  if (state.over) {
    turnIndicator.textContent = '';
    turnIndicator.className = 'turn-indicator';
    return;
  }
  const p = state.currentPlayer;
  turnIndicator.textContent = `${playerName(p)}'s turn`;
  turnIndicator.className = `turn-indicator p${p}`;
}

function renderPrompt() {
  if (state.over || isComputerTurn() || state.busy) {
    promptSection.hidden = true;
    return;
  }
  promptSection.hidden = false;
  promptLabel.textContent = 'Select a highlighted vertex to move the counter down to';
}

function renderGameOver() {
  if (!state.over) {
    gameOverPanel.classList.remove('active');
    return;
  }
  gameOverPanel.classList.add('active');
  winnerText.textContent = `${playerName(state.winner)} wins!`;
  winnerText.className = `winner-text p${state.winner}`;
}

// ── Event listeners ───────────────────────────────────────────────────────────

$('start-btn').addEventListener('click', startGame);

$('rules-play-btn').addEventListener('click', () => {
  rulesPanel.classList.remove('active');
  if (isComputerTurn()) scheduleComputer();
});

$('see-rules-btn').addEventListener('click', showRulesPanel);

$('back-btn').addEventListener('click', () => {
  closeSettingsBtn.hidden = false;
  gameScreen.hidden = true;
  settingsScreen.hidden = false;
});

$('close-settings-btn').addEventListener('click', () => {
  closeSettingsBtn.hidden = true;
  settingsScreen.hidden = true;
  gameScreen.hidden = false;
});

$('play-again-btn').addEventListener('click', () => launchGame());

$('new-game-btn').addEventListener('click', () => {
  gameOverPanel.classList.remove('active');
  gameScreen.hidden = true;
  settingsScreen.hidden = false;
});

document.querySelectorAll('.option-group').forEach(group => {
  const sync = () => {
    group.querySelectorAll('.option-box').forEach(box => {
      box.classList.toggle('selected', box.querySelector('input').checked);
    });
  };
  group.addEventListener('change', sync);
  sync();
});

document.querySelectorAll('input[name="opponent"]').forEach(r => {
  r.addEventListener('change', () => {
    const val = document.querySelector('input[name="opponent"]:checked').value;
    $('p2-label').textContent = val !== 'human' ? 'Computer' : 'Player 2';
  });
});
