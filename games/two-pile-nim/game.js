'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let settings       = null;
let state           = null;
let hasShownRules   = false;
let losingTable     = null; // DP table for the current variant/misère combo

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const settingsScreen    = $('settings-screen');
const gameScreen        = $('game-screen');
const turnIndicator     = $('turn-indicator');
const pileInfoA         = $('pile-info-a');
const pileInfoB         = $('pile-info-b');
const counterAreaA      = $('counter-area-a');
const counterAreaB      = $('counter-area-b');
const movesSection      = $('moves-section');
const moveBothEl        = $('move-both');
const moveButtonsAEl    = $('move-buttons-a');
const moveButtonsBEl    = $('move-buttons-b');
const moveButtonsBothEl = $('move-buttons-both');
const thinkingIndicator = $('thinking-indicator');
const rulesPanel        = $('rules-panel');
const gameOverPanel     = $('game-over-panel');
const winnerText        = $('winner-text');
const closeSettingsBtn  = $('close-settings-btn');

// ── Rules content ─────────────────────────────────────────────────────────────

const VARIANT_NAMES = {
  v1: 'Two-pile Nim',
  v2: 'Two-pile Nim (both piles)',
};

const VARIANT_RULES = {
  v1: [
    'Two-pile Nim is a game for two players, played with two piles of counters.',
    'On your turn, pick a pile and take 1, 2 or 3 counters from it.',
    'The winner is the player who takes the last counter.',
  ],
  v2: [
    'Two-pile Nim is a game for two players, played with two piles of counters.',
    'On your turn, either take 1, 2 or 3 counters from a single pile, or take 1, 2 or 3 counters from both piles.',
    'The winner is the player who takes the last counter.',
  ],
};

function showRulesPanel() {
  $('rules-panel-title').textContent = VARIANT_NAMES[settings.variant];
  const rules = VARIANT_RULES[settings.variant].map((r, i, arr) =>
    i === arr.length - 1 && settings.misere
      ? 'The player who takes the last counter loses.'
      : r
  );
  const list = $('rules-list');
  list.innerHTML = '';
  rules.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  rulesPanel.classList.add('active');
}

// ── Move generation ───────────────────────────────────────────────────────────

// Returns the list of resulting [na, nb] pairs reachable from (a, b).
function rawMoves(a, b, variant) {
  const moves = [];
  for (let k = 1; k <= 3; k++) {
    if (k <= a) moves.push([a - k, b]);
    if (k <= b) moves.push([a, b - k]);
  }
  if (variant === 'v2') {
    const m = Math.min(a, b);
    for (let k = 1; k <= 3; k++) {
      if (k <= m) moves.push([a - k, b - k]);
    }
  }
  return moves;
}

// Returns the list of legal moves from (a, b), annotated with how they're taken.
function movesWithMeta(a, b, variant) {
  const moves = [];
  for (let k = 1; k <= 3; k++) {
    if (k <= a) moves.push({ from: 'A', n: k, na: a - k, nb: b });
    if (k <= b) moves.push({ from: 'B', n: k, na: a, nb: b - k });
  }
  if (variant === 'v2') {
    const m = Math.min(a, b);
    for (let k = 1; k <= 3; k++) {
      if (k <= m) moves.push({ from: 'both', n: k, na: a - k, nb: b - k });
    }
  }
  return moves;
}

// A move to (na, nb) ends the game right now — standard: board is empty;
// misère: exactly one counter remains in a single pile, forcing the opponent
// to take it (and lose) on their very next turn.
function isImmediateWin(na, nb, misere) {
  if (!misere) return na === 0 && nb === 0;
  return na + nb === 1;
}

// ── Strategy table (backward induction) ──────────────────────────────────────

const MAX_PILE = 16;

// Builds a (MAX_PILE+1)x(MAX_PILE+1) table where table[a][b] === true means the
// player about to move from (a, b) loses under optimal play.
function buildLosingTable(variant, misere) {
  const L = Array.from({ length: MAX_PILE + 1 }, () => new Array(MAX_PILE + 1).fill(false));
  for (let total = 0; total <= 2 * MAX_PILE; total++) {
    for (let a = 0; a <= Math.min(total, MAX_PILE); a++) {
      const b = total - a;
      if (b < 0 || b > MAX_PILE) continue;
      if (a === 0 && b === 0) { L[0][0] = true; continue; }

      const moves = rawMoves(a, b, variant);
      if (!misere) {
        L[a][b] = !moves.some(([na, nb]) => L[na][nb]);
      } else {
        // A move to (0,0) means the mover just took the last counter and lost,
        // so such a move is never a "good" choice — it's excluded here.
        const canWin = moves.some(([na, nb]) => !(na === 0 && nb === 0) && L[na][nb]);
        L[a][b] = !canWin;
      }
    }
  }
  return L;
}

// ── AI ────────────────────────────────────────────────────────────────────────

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Novice: take a winning move if one exists, otherwise pick any legal move at random.
function noviceMove(a, b, variant, misere) {
  const moves = movesWithMeta(a, b, variant);
  const wins = moves.filter(m => isImmediateWin(m.na, m.nb, misere));
  if (wins.length) return pickRandom(wins);
  return pickRandom(moves);
}

// Expert:
//   1. Take a winning move if one exists (finishes the game now).
//   2. Else take a random move that leaves the opponent in a losing position.
//   3. Else (already lost) take 1 counter from a single pile, preferring —
//      where possible — not to hand the opponent an immediate win.
function expertMove(a, b, variant, misere, table) {
  const moves = movesWithMeta(a, b, variant);

  const wins = moves.filter(m => isImmediateWin(m.na, m.nb, misere));
  if (wins.length) return pickRandom(wins);

  const strategic = moves.filter(m => table[m.na][m.nb]);
  if (strategic.length) return pickRandom(strategic);

  const candidates = [];
  if (a >= 1) candidates.push({ from: 'A', n: 1, na: a - 1, nb: b });
  if (b >= 1) candidates.push({ from: 'B', n: 1, na: a, nb: b - 1 });

  const safe = candidates.filter(c => {
    const oppMoves = movesWithMeta(c.na, c.nb, variant);
    return !oppMoves.some(m => isImmediateWin(m.na, m.nb, misere));
  });

  return pickRandom(safe.length ? safe : candidates);
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
    pileA:       parseInt($('pile-a-counters').value, 10),
    pileB:       parseInt($('pile-b-counters').value, 10),
    variant:     document.querySelector('input[name="variant"]:checked').value,
    opponent:    document.querySelector('input[name="opponent"]:checked').value,
    firstPlayer: document.querySelector('input[name="first-player"]:checked').value,
    misere:      $('misere').checked,
  };
}

function startGame() {
  settings = readSettings();
  losingTable = buildLosingTable(settings.variant, settings.misere);
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

  state = {
    a: settings.pileA,
    b: settings.pileB,
    currentPlayer,
    over:   false,
    winner: null,
    busy:   false,
  };

  counterAreaA.className = 'counter-area';
  counterAreaB.className = 'counter-area';
  counterAreaA.style.gridTemplateColumns = `repeat(${columnsForPile(settings.pileA)}, 1fr)`;
  counterAreaB.style.gridTemplateColumns = `repeat(${columnsForPile(settings.pileB)}, 1fr)`;
  renderRulesDisplay();

  settingsScreen.hidden = true;
  gameScreen.hidden = false;

  render();

  if (!suppressComputerStart && isComputerTurn()) scheduleComputer();
}

function isComputerTurn() {
  return !state.over && isComputerOpponent() && state.currentPlayer === 2;
}

function columnsForPile(n) {
  return Math.ceil(n / 3);
}

// ── Move execution ────────────────────────────────────────────────────────────

function applyMove(move) {
  if (state.busy || state.over) return;
  state.busy = true;

  movesSection.hidden = true;
  thinkingIndicator.hidden = true;

  if (move.from === 'A' || move.from === 'both') greyOutLast(counterAreaA, move.n);
  if (move.from === 'B' || move.from === 'both') greyOutLast(counterAreaB, move.n);

  setTimeout(() => {
    state.a = move.na;
    state.b = move.nb;

    if (state.a === 0 && state.b === 0) {
      state.over = true;
      state.winner = settings.misere
        ? (state.currentPlayer === 1 ? 2 : 1)
        : state.currentPlayer;
    } else {
      state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
    }

    state.busy = false;
    render();

    if (isComputerTurn()) scheduleComputer();
  }, 450);
}

function greyOutLast(area, n) {
  const active = Array.from(area.querySelectorAll('.counter:not(.removed)'));
  for (let i = active.length - n; i < active.length; i++) {
    active[i].classList.remove('will-take');
    active[i].classList.add('removed');
  }
}

function scheduleComputer() {
  state.busy = true;
  thinkingIndicator.hidden = false;

  setTimeout(() => {
    thinkingIndicator.hidden = true;
    state.busy = false;
    const move = settings.opponent === 'expert'
      ? expertMove(state.a, state.b, settings.variant, settings.misere, losingTable)
      : noviceMove(state.a, state.b, settings.variant, settings.misere);
    applyMove(move);
  }, 750);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderTurnIndicator();
  renderCounters();
  renderMoves();
  renderGameOver();
}

function renderRulesDisplay() {
  document.querySelectorAll('.rule-pill').forEach(pill => {
    const r = pill.dataset.rule;
    const active = r === settings.variant
      || (r === 'standard' && !settings.misere)
      || (r === 'misere'   &&  settings.misere);
    pill.classList.toggle('active', active);
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

function renderCounters() {
  renderPile(counterAreaA, settings.pileA, state.a);
  renderPile(counterAreaB, settings.pileB, state.b);
  pileInfoA.textContent = `${state.a} counter${state.a !== 1 ? 's' : ''} remaining`;
  pileInfoB.textContent = `${state.b} counter${state.b !== 1 ? 's' : ''} remaining`;
}

function renderPile(area, startCount, remaining) {
  area.innerHTML = '';
  for (let i = 0; i < startCount; i++) {
    const div = document.createElement('div');
    div.className = i < remaining ? 'counter' : 'counter removed';
    area.appendChild(div);
  }
}

function renderMoves() {
  if (state.over || isComputerTurn() || state.busy) {
    movesSection.hidden = true;
    return;
  }

  movesSection.hidden = false;

  renderMoveGroup(moveButtonsAEl, 'A',    state.a);
  renderMoveGroup(moveButtonsBEl, 'B',    state.b);

  if (settings.variant === 'v2') {
    moveBothEl.hidden = false;
    renderMoveGroup(moveButtonsBothEl, 'both', Math.min(state.a, state.b));
  } else {
    moveBothEl.hidden = true;
  }
}

// Renders the fixed "Take 1 / Take 2 / Take 3" buttons for one move group,
// disabling (but not removing) any that would take more than is available.
function renderMoveGroup(container, from, available) {
  container.innerHTML = '';
  for (let n = 1; n <= 3; n++) {
    const legal = n <= available;
    const m = from === 'both'
      ? { from, n, na: state.a - n, nb: state.b - n }
      : from === 'A'
        ? { from, n, na: state.a - n, nb: state.b }
        : { from, n, na: state.a,     nb: state.b - n };

    const btn = document.createElement('button');
    btn.className = 'btn-move';
    btn.textContent = `Take ${n}`;
    btn.disabled = !legal;
    if (legal) {
      btn.addEventListener('mouseenter', () => highlightMove(m));
      btn.addEventListener('mouseleave', clearHighlight);
      btn.addEventListener('click', () => { clearHighlight(); applyMove(m); });
    }
    container.appendChild(btn);
  }
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

// ── Counter hover highlight ───────────────────────────────────────────────────

function highlightMove(m) {
  if (m.from === 'A' || m.from === 'both') highlightLast(counterAreaA, m.n);
  if (m.from === 'B' || m.from === 'both') highlightLast(counterAreaB, m.n);
}

function highlightLast(area, n) {
  const active = Array.from(area.querySelectorAll('.counter:not(.removed)'));
  active.forEach((c, i) => c.classList.toggle('will-take', i >= active.length - n));
}

function clearHighlight() {
  document.querySelectorAll('.counter.will-take').forEach(c => c.classList.remove('will-take'));
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
  settingsScreen.hidden = false;
  gameScreen.hidden = false;
});

$('play-again-btn').addEventListener('click', () => launchGame());

$('new-game-btn').addEventListener('click', () => {
  gameOverPanel.classList.remove('active');
  gameScreen.hidden = true;
  settingsScreen.hidden = false;
});

// Keep pile slider displays in sync
$('pile-a-counters').addEventListener('input', () => {
  $('pile-a-display').textContent = $('pile-a-counters').value;
});
$('pile-b-counters').addEventListener('input', () => {
  $('pile-b-display').textContent = $('pile-b-counters').value;
});

// Keep "Who goes first → Player 2/Computer" label in sync with opponent selection
document.querySelectorAll('input[name="opponent"]').forEach(r => {
  r.addEventListener('change', () => {
    const val = document.querySelector('input[name="opponent"]:checked').value;
    $('p2-label').textContent = val !== 'human' ? 'Computer' : 'Player 2';
  });
});
