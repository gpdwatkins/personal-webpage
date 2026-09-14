'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
//
// The board is a row of numbered cells 1..n, laid out as a horseshoe arc for
// display purposes only — the underlying game logic only cares about linear
// cell numbers. Three counters sit on it. Game logic only cares about their
// *positions*, sorted as [p0, p1, p2] (leftmost, middle, rightmost) — but for
// rendering we track each counter by a fixed identity (0, 1, 2), since which
// physical counter is "leftmost" changes from move to move. Only the counter
// that actually moves should have its position (and therefore its on-screen
// marble) change; the identity tracking below keeps that true.
//
// On a turn the player moves either the leftmost or the rightmost counter to
// any empty cell strictly between the other two. Moving the leftmost counter
// (p0) to y with p1 < y < p2 gives new positions [p1, y, p2]. Moving the
// rightmost counter (p2) to x with p0 < x < p1 gives new positions [p0, x, p1].
// The winner is the last player able to move; the game ends the instant a
// position has no empty cell between either remaining pair.

let settings      = null;
let state         = null;
let hasShownRules = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const settingsScreen    = $('settings-screen');
const gameScreen        = $('game-screen');
const turnIndicator     = $('turn-indicator');
const boardEl           = $('hopper-board');
const promptSection     = $('prompt-section');
const promptLabel       = $('prompt-label');
const thinkingIndicator = $('thinking-indicator');
const rulesPanel        = $('rules-panel');
const gameOverPanel     = $('game-over-panel');
const winnerText        = $('winner-text');
const closeSettingsBtn  = $('close-settings-btn');

// Persistent marble elements, one per counter *identity* (0, 1, 2) — created
// once per game and never re-created, so each only moves on screen when its
// own position actually changes.
let marbleEls = [];

// ── Rules content ─────────────────────────────────────────────────────────────

const RULES_LINES = [
  'Hopper is a game for two players.',
  'The game has three counters.',
  'On your turn, select one of the outer counters and move it to an empty space between the other two counters.',
  'The winner is the last player who is able to move.',
];

function showRulesPanel() {
  const list = $('rules-list');
  list.innerHTML = '';
  RULES_LINES.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  rulesPanel.classList.add('active');
}

// ── Move generation (works on plain sorted-position triples) ──────────────────

function applyMoveToPositions(positions, move) {
  const [p0, p1, p2] = positions;
  return move.which === 'left' ? [p1, move.to, p2] : [p0, move.to, p1];
}

function allLegalMoves(positions) {
  const [p0, p1, p2] = positions;
  const moves = [];
  for (let x = p0 + 1; x <= p1 - 1; x++) moves.push({ which: 'right', to: x });
  for (let y = p1 + 1; y <= p2 - 1; y++) moves.push({ which: 'left', to: y });
  return moves;
}

function hasAnyMove(positions) {
  const [p0, p1, p2] = positions;
  return (p1 - p0 - 1) >= 1 || (p2 - p1 - 1) >= 1;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── AI ────────────────────────────────────────────────────────────────────────
//
// A position (g1, g2) — g1 = gap between leftmost and middle, g2 = gap
// between middle and rightmost — is a loss for the player to move if and
// only if g1 and g2 are BOTH even. (Proof sketch: from a both-even position
// every move strictly consumes one gap and re-splits it into two parts
// summing to an odd number, so the result can't be both-even; from any
// not-both-even position, whichever gap is odd can always be split as
// (0, gap-1), and since that gap is odd, gap-1 is even — giving a both-even
// reply. Induction on the total then finishes it.)

// Expert: always leaves both gaps even when possible, picking randomly among
// every destination that achieves it. If already in a lost (both-even)
// position, there's no move that avoids losing to correct play, so instead
// it plays for practical difficulty: it finds the larger of the two gaps and
// moves the counter that can reach it to the middle of that gap, leaving the
// opponent with the most room to make a mistake in.
function expertMove(positions) {
  const [p0, p1, p2] = positions;
  const g1 = p1 - p0 - 1;
  const g2 = p2 - p1 - 1;
  const candidates = [];

  if (g1 % 2 === 1) {
    // Move the rightmost counter into the left-hand gap.
    for (let x = p0 + 1; x <= p1 - 1; x++) {
      const g1p = x - p0 - 1;
      const g2p = p1 - x - 1;
      if (g1p % 2 === 0 && g2p % 2 === 0) candidates.push({ which: 'right', to: x });
    }
  }
  if (g2 % 2 === 1) {
    // Move the leftmost counter into the right-hand gap.
    for (let y = p1 + 1; y <= p2 - 1; y++) {
      const g1p = y - p1 - 1;
      const g2p = p2 - y - 1;
      if (g1p % 2 === 0 && g2p % 2 === 0) candidates.push({ which: 'left', to: y });
    }
  }

  if (candidates.length) return pickRandom(candidates);

  // Already lost: move into the middle of the larger gap.
  if (g1 >= g2) {
    const a = Math.floor((g1 - 1) / 2); // resulting gap on the near side
    return { which: 'right', to: p0 + 1 + a };
  }
  const a = Math.floor((g2 - 1) / 2);
  return { which: 'left', to: p1 + 1 + a };
}

// Novice: takes an immediate win if one exists, otherwise avoids handing the
// opponent an immediate win where possible, otherwise plays randomly.
function noviceMove(positions) {
  const all = allLegalMoves(positions);

  const wins = all.filter(m => !hasAnyMove(applyMoveToPositions(positions, m)));
  if (wins.length) return pickRandom(wins);

  const safe = all.filter(m => {
    const next = applyMoveToPositions(positions, m);
    const oppMoves = allLegalMoves(next);
    return !oppMoves.some(om => !hasAnyMove(applyMoveToPositions(next, om)));
  });

  return pickRandom(safe.length ? safe : all);
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
    boardSize:   parseInt($('board-size').value, 10),
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

  const n = settings.boardSize;
  const mid = n % 2 === 1
    ? (n + 1) / 2
    : (Math.random() < 0.5 ? n / 2 : n / 2 + 1);

  state = {
    n,
    counterPos: [1, mid, n], // fixed identities 0, 1, 2 — order is arbitrary, only values matter
    phase: 'select-counter', // or 'select-cell'
    selectedCounter: null,   // 'left' | 'right' (role, at time of selection)
    currentPlayer,
    over: false,
    winner: null,
    busy: false,
  };

  buildMarbles();

  settingsScreen.hidden = true;
  gameScreen.hidden = false;
  gameOverPanel.classList.remove('active');

  render();

  if (!suppressComputerStart && isComputerTurn()) scheduleComputer();
}

function isComputerTurn() {
  return !state.over && isComputerOpponent() && state.currentPlayer === 2;
}

function sortedPositions() {
  return [...state.counterPos].sort((a, b) => a - b);
}

// Maps current roles (by position) to the fixed identity indices that
// currently hold them.
function roleIdentities() {
  const order = [0, 1, 2].sort((a, b) => state.counterPos[a] - state.counterPos[b]);
  return { leftIdx: order[0], midIdx: order[1], rightIdx: order[2] };
}

function buildMarbles() {
  boardEl.querySelectorAll('.counter-marble').forEach(el => el.remove());

  marbleEls = [0, 1, 2].map(i => {
    const m = document.createElement('div');
    m.className = 'counter-marble';
    m.addEventListener('click', () => handleCounterClick(i));
    boardEl.appendChild(m);
    return m;
  });
}

// ── Move execution ────────────────────────────────────────────────────────────

function handleCounterClick(identityIdx) {
  if (state.busy || state.over || isComputerTurn()) return;

  const { leftIdx, midIdx, rightIdx } = roleIdentities();
  if (identityIdx === midIdx) return;

  const role = identityIdx === leftIdx ? 'left' : 'right';

  if (state.phase === 'select-cell') {
    // Only the currently-selected counter can be clicked again (to deselect);
    // the other outer counter is inert until you back out of the selection.
    if (state.selectedCounter === role) {
      state.selectedCounter = null;
      state.phase = 'select-counter';
      render();
    }
    return;
  }

  const [p0, p1, p2] = sortedPositions();
  const gapForThis = role === 'left' ? (p2 - p1 - 1) : (p1 - p0 - 1);
  if (gapForThis < 1) return;

  state.selectedCounter = role;
  state.phase = 'select-cell';
  render();
}

function handleCellClick(pos) {
  if (state.busy || state.over || isComputerTurn() || state.phase !== 'select-cell') return;
  applyMove({ which: state.selectedCounter, to: pos });
}

// A fixed duration made long hops (which cover a much bigger angle around
// the arc) visibly zip past faster than short ones. Instead, duration scales
// with the angular distance travelled — capping the top speed — with a
// floor so a one-cell hop still reads as a slide rather than a jump.
const MIN_SLIDE_MS = 450;
const MS_PER_RADIAN = 450;

function slideDurationFor(layout, fromPos, toPos) {
  const angularDistance = Math.abs(layout.thetaFor(toPos) - layout.thetaFor(fromPos));
  return Math.max(MIN_SLIDE_MS, angularDistance * MS_PER_RADIAN);
}

// Slow-start, slow-end easing (fast in the middle).
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Animates one marble from `fromPos` to `toPos` by interpolating its angle
// along the arc (not its x/y coordinates), so it visibly follows the curve
// of the board rather than cutting a straight line across it. Returns a
// cancel function so a caller can stop it early.
function animateMarbleSlide(el, layout, fromPos, toPos, duration, onDone) {
  const size = Math.max(12, Math.round(layout.cs * 0.7));
  const thetaStart = layout.thetaFor(fromPos);
  const thetaEnd = layout.thetaFor(toPos);
  const startTime = performance.now();
  let cancelled = false;

  function frame(now) {
    if (cancelled) return;
    const t = Math.min(1, (now - startTime) / duration);
    const eased = easeInOutCubic(t);
    const { x, y } = layout.pointAt(thetaStart + (thetaEnd - thetaStart) * eased);
    el.style.left = `${x - size / 2}px`;
    el.style.top = `${y - size / 2}px`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      onDone();
    }
  }
  requestAnimationFrame(frame);

  return () => { cancelled = true; };
}

function applyMove(move) {
  if (state.busy || state.over) return;
  state.busy = true;

  const mover = state.currentPlayer;
  const { leftIdx, rightIdx } = roleIdentities();
  const movingIdx = move.which === 'left' ? leftIdx : rightIdx;
  const fromPos = state.counterPos[movingIdx];
  const toPos = move.to;

  state.selectedCounter = null;
  state.phase = 'select-counter';

  // Re-render now (clears destination highlights / prompt) before the
  // counter's actual position changes, then hand its marble off to the
  // arc-following animation.
  render();

  const layout = state.layout;
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnim();
    positionMarble(marbleEls[movingIdx], toPos, layout); // snap to the exact resting spot

    state.counterPos[movingIdx] = toPos;
    const positions = sortedPositions();
    if (!hasAnyMove(positions)) {
      state.over = true;
      state.winner = mover;
    } else {
      state.currentPlayer = mover === 1 ? 2 : 1;
    }
    state.busy = false;
    render();

    if (isComputerTurn()) scheduleComputer();
  }

  const duration = slideDurationFor(layout, fromPos, toPos);
  const cancelAnim = animateMarbleSlide(marbleEls[movingIdx], layout, fromPos, toPos, duration, finish);

  // Safety net: requestAnimationFrame is throttled or fully paused in a
  // backgrounded/minimised tab, which would otherwise leave the game stuck
  // mid-move indefinitely. This guarantees the move still resolves on
  // schedule even if the animation itself never gets to run.
  setTimeout(finish, duration + 150);
}

function scheduleComputer() {
  state.busy = true;
  thinkingIndicator.hidden = false;
  render();

  setTimeout(() => {
    thinkingIndicator.hidden = true;
    state.busy = false;
    const move = settings.opponent === 'expert'
      ? expertMove(sortedPositions())
      : noviceMove(sortedPositions());
    applyMove(move);
  }, 750);
}

// ── Layout ────────────────────────────────────────────────────────────────────
//
// Cells are arranged along the upper half of a circle — a horseshoe/arch
// shape with both ends resting on the same baseline and the arc rising over
// the top. Cell centres are evenly spaced by angle; the radius is chosen so
// the spacing between adjacent cells along the arc matches a target cell
// size, which is itself sized to fit the available width.

function computeLayout(n) {
  const maxW = Math.min(window.innerWidth - 64, 640);
  const gap = 6;
  const pad = 20;
  const k = 2 * (n - 1) / Math.PI;

  let cs = (maxW - 2 * pad - gap * k) / (k + 1);
  cs *= 1.15; // a bit bigger than the tightest fit — `gap` (fixed, above) is what keeps them from touching
  cs = Math.max(25, Math.min(cs, 44));

  const step = cs + gap;
  const R = (n - 1) * step / Math.PI;
  const cx = R + cs / 2 + pad;
  const cy = R + cs / 2 + pad;
  const width = 2 * R + cs + 2 * pad;
  const height = R + cs + 2 * pad;

  function thetaFor(pos) {
    const i = pos - 1;
    return Math.PI * (1 - i / (n - 1));
  }

  function pointAt(theta) {
    return { x: cx + R * Math.cos(theta), y: cy - R * Math.sin(theta) };
  }

  function coordsFor(pos) {
    return pointAt(thetaFor(pos));
  }

  return { cs, width, height, cx, cy, R, thetaFor, pointAt, coordsFor };
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderTurnIndicator();
  renderBoard();
  renderPrompt();
  renderGameOver();
}

function renderTurnIndicator() {
  if (state.over) {
    // A non-breaking space (not '') keeps the pill's line box — and so its
    // height — the same as when it holds real text, so nothing below it
    // (the board, the "in association with" badge) shifts up at game over.
    turnIndicator.textContent = ' ';
    turnIndicator.className = 'turn-indicator';
    return;
  }
  const p = state.currentPlayer;
  turnIndicator.textContent = `${playerName(p)}'s turn`;
  turnIndicator.className = `turn-indicator p${p}`;
}

function renderBoard() {
  const { n } = state;
  const layout = computeLayout(n);
  state.layout = layout;

  boardEl.style.width = `${layout.width}px`;
  boardEl.style.height = `${layout.height}px`;

  boardEl.querySelectorAll('.hopper-box').forEach(el => el.remove());

  const [p0, p1, p2] = sortedPositions();
  const occupied = new Set([p0, p1, p2]);
  const clickable = !state.over && !state.busy && !isComputerTurn();

  const destSet = new Set();
  if (clickable && state.phase === 'select-cell' && state.selectedCounter) {
    if (state.selectedCounter === 'left') {
      for (let y = p1 + 1; y <= p2 - 1; y++) destSet.add(y);
    } else {
      for (let x = p0 + 1; x <= p1 - 1; x++) destSet.add(x);
    }
  }

  for (let pos = 1; pos <= n; pos++) {
    const { x, y } = layout.coordsFor(pos);
    const box = document.createElement('div');
    box.className = 'hopper-box' + (occupied.has(pos) ? ' occupied' : '');
    box.style.width = `${layout.cs}px`;
    box.style.height = `${layout.cs}px`;
    box.style.left = `${x - layout.cs / 2}px`;
    box.style.top = `${y - layout.cs / 2}px`;

    const num = document.createElement('span');
    num.className = 'hopper-num';
    num.textContent = pos;
    box.appendChild(num);

    if (destSet.has(pos)) {
      box.classList.add('movable', `p${state.currentPlayer}`);
      box.addEventListener('click', () => handleCellClick(pos));
    }

    boardEl.appendChild(box);
  }

  const g1 = p1 - p0 - 1;
  const g2 = p2 - p1 - 1;
  const { leftIdx, rightIdx } = roleIdentities();

  [0, 1, 2].forEach(i => positionMarble(marbleEls[i], state.counterPos[i], layout));

  styleOuterMarble(marbleEls[leftIdx],  clickable && g2 >= 1, state.selectedCounter === 'left');
  styleOuterMarble(marbleEls[rightIdx], clickable && g1 >= 1, state.selectedCounter === 'right');
  [0, 1, 2].filter(i => i !== leftIdx && i !== rightIdx).forEach(i => styleOuterMarble(marbleEls[i], false, false));
}

function positionMarble(el, pos, layout) {
  const { x, y } = layout.coordsFor(pos);
  const size = Math.max(12, Math.round(layout.cs * 0.7));
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.left = `${x - size / 2}px`;
  el.style.top = `${y - size / 2}px`;
}

function styleOuterMarble(el, selectable, selected) {
  // Only show the highlight while a counter hasn't been chosen yet — once one
  // is selected, the other outer counter goes fully neutral, and the chosen
  // one switches from a pulsing ring to a solid, unmistakable "selected" fill.
  const showSelectable = selectable && state.phase === 'select-counter';
  el.classList.toggle('selectable', showSelectable);
  el.classList.toggle('selected', selected);
  el.classList.remove('p1', 'p2');
  if (showSelectable || selected) el.classList.add(`p${state.currentPlayer}`);
}

function renderPrompt() {
  if (state.over || isComputerTurn() || state.busy) {
    promptSection.hidden = true;
    return;
  }
  promptSection.hidden = false;

  if (state.phase === 'select-cell') {
    promptLabel.textContent = 'Select a new position to move the counter';
    return;
  }

  promptLabel.textContent = 'Select which of the outer counters to move';
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

$('board-size').addEventListener('input', () => {
  $('board-size-display').textContent = $('board-size').value;
});

document.querySelectorAll('input[name="opponent"]').forEach(r => {
  r.addEventListener('change', () => {
    const val = document.querySelector('input[name="opponent"]:checked').value;
    $('p2-label').textContent = val !== 'human' ? 'Computer' : 'Player 2';
  });
});
