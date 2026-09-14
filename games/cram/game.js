'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let settings      = null;
let state         = null;
let hasShownRules = false;

const GAP = 5; // px, must match .cram-grid gap in styles.css
const EXACT_PLAY_THRESHOLD = 8; // switch novice AI to exact play once this many empty cells remain

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const settingsScreen    = $('settings-screen');
const gameScreen        = $('game-screen');
const turnIndicator     = $('turn-indicator');
const cramGrid          = $('cram-grid');
const promptSection     = $('prompt-section');
const promptLabel       = $('prompt-label');
const thinkingIndicator = $('thinking-indicator');
const rulesPanel        = $('rules-panel');
const gameOverPanel     = $('game-over-panel');
const winnerText        = $('winner-text');
const closeSettingsBtn  = $('close-settings-btn');

// ── Rules ─────────────────────────────────────────────────────────────────────

const RULES = {
  'even-even': {
    title: 'Even-by-Even Cram',
    lines: [
      'Cram is a game for two players.',
      'On your turn, place a domino on a pair of adjacent unoccupied squares.',
      'The player who places the last domino wins the game.',
    ],
  },
  'odd-even': {
    title: 'Odd-by-Even Cram',
    lines: [
      'Cram is a game for two players.',
      'On your turn, place a domino on a pair of adjacent unoccupied squares.',
      'The player who places the last domino wins the game.',
    ],
  },
};

const ROWS_OPTIONS = {
  'even-even': { values: [4, 6, 8], default: 6 },
  'odd-even':  { values: [3, 5, 7], default: 5 },
};

function showRulesPanel() {
  const r = RULES[settings.variant];
  $('rules-panel-title').textContent = r.title;
  const list = $('rules-list');
  list.innerHTML = '';
  r.lines.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  rulesPanel.classList.add('active');
}

// ── Board helpers ─────────────────────────────────────────────────────────────

function adjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function enumerateLegalMoves(grid, rows, cols) {
  const moves = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) continue;
      if (c + 1 < cols && grid[r][c + 1] === 0) moves.push({ r1: r, c1: c, r2: r, c2: c + 1 });
      if (r + 1 < rows && grid[r + 1][c] === 0) moves.push({ r1: r, c1: c, r2: r + 1, c2: c });
    }
  }
  return moves;
}

function hasAnyLegalMove(grid, rows, cols) {
  return enumerateLegalMoves(grid, rows, cols).length > 0;
}

function isMoveLegal(move, grid) {
  return grid[move.r1][move.c1] === 0 && grid[move.r2][move.c2] === 0;
}

function rotateMove(move, rows, cols) {
  return {
    r1: rows - 1 - move.r1, c1: cols - 1 - move.c1,
    r2: rows - 1 - move.r2, c2: cols - 1 - move.c2,
  };
}

// ── AI – Expert ───────────────────────────────────────────────────────────────
//
// Even-by-Even Cram has no self-symmetric domino, so the second player wins by
// always mirroring the opponent's most recent move 180° about the board centre.
// Odd-by-Even Cram has exactly one self-symmetric domino (the two central
// squares of the central row); playing it first strips out the only move that
// can't be mirrored, so the first player then wins by mirroring from then on.
// When the computer is on the "wrong" side of that split, it falls back to the
// same imitation strategy as a best-effort heuristic.

function expertMove(state, variant) {
  const { rows, cols, grid, lastMove } = state;

  if (!lastMove) {
    if (variant === 'odd-even') {
      const r0 = (rows - 1) / 2;
      const c0 = cols / 2 - 1;
      return [{ r: r0, c: c0 }, { r: r0, c: c0 + 1 }];
    }
    const r0 = rows / 2 - 1;
    const c0 = cols / 2 - 1;
    return [{ r: r0, c: c0 }, { r: r0, c: c0 + 1 }];
  }

  const rotated = rotateMove(lastMove, rows, cols);
  if (isMoveLegal(rotated, grid)) {
    return [{ r: rotated.r1, c: rotated.c1 }, { r: rotated.r2, c: rotated.c2 }];
  }

  const moves = enumerateLegalMoves(grid, rows, cols);
  const m = moves[Math.floor(Math.random() * moves.length)];
  return [{ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 }];
}

// ── AI – Novice ───────────────────────────────────────────────────────────────
//
// Plays randomly while more than EXACT_PLAY_THRESHOLD empty squares remain.
// Once few enough squares are left, solves the remaining position exactly via
// a memoised bitmask search and plays a winning move if one exists.

function noviceMove(state) {
  const { grid, rows, cols } = state;
  const legalMoves = enumerateLegalMoves(grid, rows, cols);

  const emptyCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0) emptyCells.push({ r, c });
    }
  }

  if (emptyCells.length > EXACT_PLAY_THRESHOLD) {
    const m = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    return [{ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 }];
  }

  const indexOf = new Map();
  emptyCells.forEach((cell, i) => indexOf.set(`${cell.r},${cell.c}`, i));

  const movePairs = legalMoves.map(m => [
    indexOf.get(`${m.r1},${m.c1}`),
    indexOf.get(`${m.r2},${m.c2}`),
  ]);

  const fullMask = (1 << emptyCells.length) - 1;
  const memo = new Map();

  function winning(mask) {
    if (memo.has(mask)) return memo.get(mask);
    let result = false;
    for (const [i, j] of movePairs) {
      const bit = (1 << i) | (1 << j);
      if ((mask & bit) === bit && !winning(mask & ~bit)) {
        result = true;
        break;
      }
    }
    memo.set(mask, result);
    return result;
  }

  for (const [i, j] of movePairs) {
    const bit = (1 << i) | (1 << j);
    if ((fullMask & bit) === bit && !winning(fullMask & ~bit)) {
      return [emptyCells[i], emptyCells[j]];
    }
  }

  const m = legalMoves[Math.floor(Math.random() * legalMoves.length)];
  return [{ r: m.r1, c: m.c1 }, { r: m.r2, c: m.c2 }];
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
    variant:     document.querySelector('input[name="variant"]:checked').value,
    rows:        parseInt(document.querySelector('input[name="rows"]:checked').value, 10),
    cols:        parseInt(document.querySelector('input[name="cols"]:checked').value, 10),
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

  const rows = settings.rows;
  const cols = settings.cols;
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  state = {
    rows, cols, grid,
    dominoes: [],
    renderedDominoCount: 0,
    selected: null,
    lastMove: null,
    currentPlayer,
    over: false,
    winner: null,
    busy: false,
    cellSize: 0,
  };

  cramGrid.innerHTML = '';

  settingsScreen.hidden = true;
  gameScreen.hidden = false;

  renderAll();
  gameOverPanel.classList.remove('active');

  if (!suppressComputerStart && isComputerTurn()) scheduleComputer();
}

function isComputerTurn() {
  return !state.over && isComputerOpponent() && state.currentPlayer === 2;
}

// ── Move execution ────────────────────────────────────────────────────────────

function handleCellClick(r, c) {
  if (state.busy || state.over || isComputerTurn()) return;
  if (state.grid[r][c] !== 0) return;

  if (!state.selected) {
    state.selected = { r, c };
  } else if (state.selected.r === r && state.selected.c === c) {
    state.selected = null;
  } else if (adjacent(state.selected, { r, c })) {
    const a = state.selected;
    state.selected = null;
    applyMove(a, { r, c });
    return;
  } else {
    state.selected = { r, c };
  }

  renderAll();
}

function applyMove(cellA, cellB) {
  if (state.busy || state.over) return;
  state.busy = true;

  const player = state.currentPlayer;
  state.grid[cellA.r][cellA.c] = player;
  state.grid[cellB.r][cellB.c] = player;

  const move = { r1: cellA.r, c1: cellA.c, r2: cellB.r, c2: cellB.c };
  state.dominoes.push({ ...move, player });
  state.lastMove = move;
  state.selected = null;

  if (!hasAnyLegalMove(state.grid, state.rows, state.cols)) {
    state.over = true;
    state.winner = player;
    state.busy = false;
    renderAll();
    return;
  }

  state.currentPlayer = player === 1 ? 2 : 1;
  renderAll();

  setTimeout(() => {
    state.busy = false;
    renderAll();

    if (isComputerTurn()) scheduleComputer();
  }, 450);
}

function scheduleComputer() {
  state.busy = true;
  thinkingIndicator.hidden = false;
  renderPrompt();

  setTimeout(() => {
    thinkingIndicator.hidden = true;
    state.busy = false;

    const [a, b] = settings.opponent === 'expert'
      ? expertMove(state, settings.variant)
      : noviceMove(state);

    applyMove(a, b);
  }, 750);
}

// ── Render ────────────────────────────────────────────────────────────────────

function cellSize(rows, cols) {
  const maxW = Math.min(window.innerWidth - 80, 620);
  const maxH = window.innerHeight * 0.55;
  const byCols = (maxW - (cols - 1) * GAP) / cols;
  const byRows = (maxH - (rows - 1) * GAP) / rows;
  return Math.floor(Math.min(byCols, byRows, 72, Math.max(32, 480 / cols)));
}

function renderAll() {
  renderGrid();
  renderTurnIndicator();
  renderPrompt();
  renderGameOver();
}

function renderGrid() {
  const { rows, cols, grid } = state;
  const cs = cellSize(rows, cols);
  state.cellSize = cs;

  cramGrid.style.gridTemplateColumns = `repeat(${cols}, ${cs}px)`;
  cramGrid.style.gridTemplateRows    = `repeat(${rows}, ${cs}px)`;
  cramGrid.classList.toggle('turn-p1', state.currentPlayer === 1);
  cramGrid.classList.toggle('turn-p2', state.currentPlayer === 2);

  // Only the cell layer is rebuilt each render; domino tiles are appended
  // once and left alone so placed dominoes don't re-animate on every click.
  cramGrid.querySelectorAll('.cram-cell').forEach(el => el.remove());

  const clickable = !state.over && !state.busy && !isComputerTurn();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      const occupied = grid[r][c] !== 0;
      const isSelected = state.selected && state.selected.r === r && state.selected.c === c;

      cell.className = 'cram-cell'
        + (occupied ? ' occupied' : '')
        + (isSelected ? ` selected p${state.currentPlayer}` : '');

      if (!occupied && clickable) {
        cell.addEventListener('click', () => handleCellClick(r, c));
      }

      cramGrid.appendChild(cell);
    }
  }

  renderDominoes();
}

function renderDominoes() {
  const cs = state.cellSize;

  for (let i = state.renderedDominoCount; i < state.dominoes.length; i++) {
    const d = state.dominoes[i];
    const horizontal = d.r1 === d.r2;
    const tile = document.createElement('div');
    tile.className = `domino-tile p${d.player} ${horizontal ? 'horizontal' : 'vertical'}`;

    const top  = Math.min(d.r1, d.r2) * (cs + GAP);
    const left = Math.min(d.c1, d.c2) * (cs + GAP);

    tile.style.top    = `${top}px`;
    tile.style.left   = `${left}px`;
    tile.style.width  = horizontal ? `${cs * 2 + GAP}px` : `${cs}px`;
    tile.style.height = horizontal ? `${cs}px` : `${cs * 2 + GAP}px`;

    cramGrid.appendChild(tile);
  }

  state.renderedDominoCount = state.dominoes.length;
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

function renderPrompt() {
  if (state.over || isComputerTurn() || state.busy) {
    promptSection.hidden = true;
    return;
  }
  promptSection.hidden = false;
  promptLabel.textContent = state.selected ? 'Select second square' : 'Select first square';
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

function syncOptionGroup(group) {
  group.querySelectorAll('.option-box').forEach(box => {
    box.classList.toggle('selected', box.querySelector('input').checked);
  });
}

document.querySelectorAll('.option-group').forEach(group => {
  group.addEventListener('change', () => syncOptionGroup(group));
  syncOptionGroup(group);
});

document.querySelectorAll('input[name="variant"]').forEach(r => {
  r.addEventListener('change', () => {
    const v = document.querySelector('input[name="variant"]:checked').value;
    const options = ROWS_OPTIONS[v];
    const rowsGroup = $('rows-options');
    rowsGroup.querySelectorAll('.option-box').forEach((box, i) => {
      const value = options.values[i];
      box.querySelector('input').value = value;
      box.querySelector('input').checked = value === options.default;
      box.querySelector('span').textContent = value;
    });
    syncOptionGroup(rowsGroup);
  });
});

document.querySelectorAll('input[name="opponent"]').forEach(r => {
  r.addEventListener('change', () => {
    const val = document.querySelector('input[name="opponent"]:checked').value;
    $('p2-label').textContent = val !== 'human' ? 'Computer' : 'Player 2';
  });
});
