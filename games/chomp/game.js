'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let settings      = null;
let state         = null;
let hasShownRules = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const settingsScreen    = $('settings-screen');
const gameScreen        = $('game-screen');
const turnIndicator     = $('turn-indicator');
const chompGrid         = $('chomp-grid');
const promptSection     = $('prompt-section');
const thinkingIndicator = $('thinking-indicator');
const rulesPanel        = $('rules-panel');
const gameOverPanel     = $('game-over-panel');
const winnerText        = $('winner-text');
const closeSettingsBtn  = $('close-settings-btn');

// ── Rules ─────────────────────────────────────────────────────────────────────

const RULES = {
  rectangular: {
    title: 'Rectangular Chomp',
    lines: [
      'Rectangular Chomp is a game for two players.',
      'The game is played on a board with 2 rows.',
      'The bottom right square is poisoned.',
      'On your turn, choose a square. That square gets ‘chomped’, together with all the squares above it and to the left.',
      'The player who chomps the poisoned square loses.',
    ],
  },
  square: {
    title: 'Square Chomp',
    lines: [
      'Square Chomp is a game for two players.',
      'The game is played on a square board.',
      'The bottom right square is poisoned.',
      'On your turn, choose a square. That square gets ‘chomped’, together with all the squares above it and to the left.',
      'The player who chomps the poisoned square loses.',
    ],
  },
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

// ── Minimax for square chomp ──────────────────────────────────────────────────
// State: colStart[r] = leftmost present column in row r (N = empty row).
// colStart is non-increasing top-to-bottom (bottom rows have <= colStart).
// Returns true if current position is a loss for the player to move.

const minimaxCache = new Map();

function stateKey(colStart) {
  return colStart.join(',');
}

function isLosing(colStart, N) {
  const key = stateKey(colStart);
  if (minimaxCache.has(key)) return minimaxCache.get(key);

  // Only poison remains: current player must take it → lose
  const onlyPoison = colStart.every((cs, r) =>
    r < N - 1 ? cs === N : cs === N - 1
  );
  if (onlyPoison) {
    minimaxCache.set(key, true);
    return true;
  }

  // Try every legal move (r, c) where colStart[r] <= c <= N-1,
  // but not the poison (r=N-1, c=N-1) unless forced
  for (let r = 0; r < N; r++) {
    const cMin = colStart[r];
    if (cMin >= N) continue;
    const cMax = (r === N - 1) ? N - 2 : N - 1; // skip poison unless only move
    for (let c = cMin; c <= cMax; c++) {
      const next = applyMoveToState(colStart, r, c, N);
      if (isLosing(next, N)) {
        minimaxCache.set(key, false);
        return false;
      }
    }
  }

  // Check poison move separately (forced last resort)
  // If we reach here, all non-poison moves lead to non-losing states for opponent.
  // Taking poison is a loss too, so we lose regardless.
  minimaxCache.set(key, true);
  return true;
}

function applyMoveToState(colStart, moveR, moveC, N) {
  const next = colStart.slice();
  for (let r = 0; r <= moveR; r++) {
    next[r] = Math.max(next[r], moveC + 1);
  }
  return next;
}

function bestSquareMove(colStart, N) {
  // Find a move that leaves the opponent in a losing position
  for (let r = 0; r < N; r++) {
    const cMin = colStart[r];
    if (cMin >= N) continue;
    const cMax = (r === N - 1) ? N - 2 : N - 1;
    for (let c = cMin; c <= cMax; c++) {
      const next = applyMoveToState(colStart, r, c, N);
      if (isLosing(next, N)) return [r, c];
    }
  }
  // No winning move exists; pick any non-poison move
  for (let r = 0; r < N; r++) {
    const cMin = colStart[r];
    if (cMin >= N) continue;
    const cMax = (r === N - 1) ? N - 2 : N - 1;
    if (cMin <= cMax) return [r, cMin];
  }
  // Only poison remains
  return [N - 1, N - 1];
}

// ── AI – Rectangular ──────────────────────────────────────────────────────────
// State is fully described by (T, B) where T = colStart[0], B = colStart[1].
// T >= B always. Expert strategy: leave T = B+1 for opponent.

function rectExpertMove(T, B, N) {
  if (T === B) {
    // Equal rows: click top row at col T → new state (T+1, B=T). T'=B'+1. ✓
    return [0, T];
  }
  if (T > B + 1) {
    // Click bottom row at col T-2 → new state (T, T-1). T=T, B'=T-1, T=B'+1. ✓
    return [1, T - 2];
  }
  // T === B+1: we're in the losing position; equalize
  // Click bottom row at col B → new state (T, T). Equal rows.
  return [1, B];
}

function rectNoviceMove(T, B, N) {
  // Win now: top row empty and bottom has non-poison cells → clear bottom branch
  if (T === N && B <= N - 2) return [1, N - 2];

  const validMoves = [];
  if (T < N) {
    for (let c = T; c <= N - 1; c++) validMoves.push([0, c]);
  }
  for (let c = B; c <= N - 2; c++) validMoves.push([1, c]);

  // A gift state is one from which the opponent can win immediately:
  // (T'=N, B'≤N-2): opp clicks bottom at N-2 → only poison
  // (T'=N-1, B'=N-1): opp clicks top at N-1 → only poison
  function isGiftState(T2, B2) {
    if (T2 === N && B2 <= N - 2) return true;
    if (T2 === N - 1 && B2 === N - 1) return true;
    return false;
  }

  function moveResult(r, c) {
    const T2 = Math.max(T, c + 1);
    const B2 = r === 1 ? Math.max(B, c + 1) : B;
    return [T2, B2];
  }

  const nonGift = validMoves.filter(([r, c]) => {
    const [T2, B2] = moveResult(r, c);
    return !isGiftState(T2, B2);
  });

  if (nonGift.length > 0) {
    return nonGift[Math.floor(Math.random() * nonGift.length)];
  }

  // All non-poison moves give a gift; pick random non-poison move
  if (validMoves.length > 0) {
    return validMoves[Math.floor(Math.random() * validMoves.length)];
  }

  // Only poison left
  return [1, N - 1];
}

// ── AI – Square ───────────────────────────────────────────────────────────────

function isInTwoBranchState(colStart, N) {
  for (let r = 0; r < N - 1; r++) {
    if (colStart[r] !== N - 1 && colStart[r] !== N) return false;
  }
  return true;
}

function twoBranchCounts(colStart, N) {
  // Bottom branch: non-poison cells in bottom row = cols colStart[N-1]..N-2
  const botCells = Math.max(0, N - 1 - colStart[N - 1]);
  // Right branch: rows in col N-1 (rows 0..N-2 where colStart[r]=N-1)
  let rightCells = 0;
  for (let r = 0; r < N - 1; r++) {
    if (colStart[r] === N - 1) rightCells++;
  }
  return { botCells, rightCells };
}

function squareExpertMove(colStart, N) {
  // If computer goes first (all cells present): play NW of poison
  const allPresent = colStart.every(cs => cs === 0);
  if (allPresent) return [N - 2, N - 2];

  // If in two-branch state, use mirror/equalise strategy
  if (isInTwoBranchState(colStart, N)) {
    const { botCells, rightCells } = twoBranchCounts(colStart, N);
    if (botCells === rightCells && botCells === 0) {
      // Only poison remains; forced to take it
      return [N - 1, N - 1];
    }
    if (botCells > rightCells) {
      // Reduce bottom branch to match right branch
      // Bottom row has cells colStart[N-1]..N-2; want N-1-newB = rightCells → newB = N-1-rightCells
      const newB = N - 1 - rightCells;
      // Click (N-1, newB-1) to remove bottom row cols 0..newB-1
      return [N - 1, newB - 1];
    }
    if (rightCells > botCells) {
      // Right branch occupies rows (N-1-rightCells)..(N-2).
      // To leave botCells rows, click at row N-2-botCells (removes top rightCells-botCells rows).
      return [N - 2 - botCells, N - 1];
    }
    // Equal branches: both at 0 (handled above) or some equal value.
    // This means the opponent just equalised; we're in a losing position.
    // Just take 1 from bottom branch if possible, else 1 from right branch.
    if (botCells > 0) {
      const newB = N - 1 - (botCells - 1);
      return [N - 1, newB - 1];
    }
    if (rightCells > 0) {
      // Top of right branch is row N-1-rightCells; remove just that row.
      return [N - 1 - rightCells, N - 1];
    }
    return [N - 1, N - 1];
  }

  // General case: use minimax
  return bestSquareMove(colStart, N);
}

function squareNoviceMove(colStart, N) {
  const { botCells, rightCells } = isInTwoBranchState(colStart, N)
    ? twoBranchCounts(colStart, N)
    : { botCells: -1, rightCells: -1 };

  // Win immediately: leave just poison (only possible from two-branch with one branch empty)
  if (isInTwoBranchState(colStart, N)) {
    // If bottom branch = 0 and right branch > 0: clear it entirely.
    // Right branch is always rows (N-1-rightCells)..(N-2); clicking (N-2, N-1) clears all of them.
    if (botCells === 0 && rightCells > 0) {
      return [N - 2, N - 1];
    }
    // If right branch = 0 and bottom branch > 0: clear bottom branch
    if (rightCells === 0 && botCells > 0) {
      return [N - 1, N - 2]; // removes all bottom branch cells (cols 0..N-2)
    }
  }

  // Collect all non-poison moves
  const allMoves = [];
  for (let r = 0; r < N; r++) {
    const cMin = colStart[r];
    if (cMin >= N) continue;
    for (let c = cMin; c < N; c++) {
      if (r === N - 1 && c === N - 1) continue; // skip poison
      allMoves.push([r, c]);
    }
  }

  if (allMoves.length === 0) return [N - 1, N - 1]; // only poison

  // Check if a move leads to a gift state (two-branch with one branch empty)
  function wouldBeGift(r, c) {
    const next = applyMoveToState(colStart, r, c, N);
    if (!isInTwoBranchState(next, N)) return false;
    const { botCells: b2, rightCells: r2 } = twoBranchCounts(next, N);
    return (b2 === 0 || r2 === 0);
  }

  const nonGift = allMoves.filter(([r, c]) => !wouldBeGift(r, c));
  if (nonGift.length > 0) {
    return nonGift[Math.floor(Math.random() * nonGift.length)];
  }

  // All non-poison moves lead to gifts; pick random non-game-ending move
  // (any move that doesn't leave only poison)
  function wouldLeaveOnlyPoison(r, c) {
    const next = applyMoveToState(colStart, r, c, N);
    const ob = isInTwoBranchState(next, N);
    if (!ob) return false;
    const { botCells: b2, rightCells: r2 } = twoBranchCounts(next, N);
    return b2 === 0 && r2 === 0;
  }

  const nonTerminal = allMoves.filter(([r, c]) => !wouldLeaveOnlyPoison(r, c));
  if (nonTerminal.length > 0) {
    return nonTerminal[Math.floor(Math.random() * nonTerminal.length)];
  }

  // Only the poison remains (every non-poison move would leave only poison — shouldn't happen
  // unless only poison is left, in which case allMoves is empty, handled above)
  return [N - 1, N - 1];
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
    cols:        parseInt($('cols-slider').value, 10),
    size:        parseInt($('size-slider').value, 10),
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

  const rows = settings.variant === 'rectangular' ? 2 : settings.size;
  const cols = settings.variant === 'rectangular' ? settings.cols : settings.size;

  // colStart[r] = leftmost present column in row r; N means row is empty
  const colStart = new Array(rows).fill(0);

  state = { rows, cols, colStart, currentPlayer, over: false, winner: null, busy: false };

  minimaxCache.clear();

  settingsScreen.hidden = true;
  gameScreen.hidden = false;

  renderGrid();
  renderTurnIndicator();
  renderPrompt();
  gameOverPanel.classList.remove('active');

  if (!suppressComputerStart && isComputerTurn()) scheduleComputer();
}

function isComputerTurn() {
  return !state.over && isComputerOpponent() && state.currentPlayer === 2;
}

// ── Move execution ────────────────────────────────────────────────────────────

function applyMove(moveR, moveC) {
  if (state.busy || state.over) return;
  state.busy = true;

  // Check if player clicked poison
  const isPoison = moveR === state.rows - 1 && moveC === state.cols - 1;

  // Update colStart
  for (let r = 0; r <= moveR; r++) {
    state.colStart[r] = Math.max(state.colStart[r], moveC + 1);
  }

  // Check game over: poison was chomped OR only poison remains
  let gameOver = false;
  let loser;

  if (isPoison) {
    gameOver = true;
    loser = state.currentPlayer;
  }

  if (gameOver) {
    state.over = true;
    state.winner = loser === 1 ? 2 : 1;
    state.busy = false;
    renderGrid();
    renderTurnIndicator();
    renderPrompt();
    renderGameOver();
    return;
  }

  state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
  renderGrid();
  renderTurnIndicator();
  renderPrompt(); // busy=true → prompt hidden during transition

  setTimeout(() => {
    state.busy = false;
    renderPrompt(); // now show prompt (or let scheduleComputer take over)
    if (isComputerTurn()) scheduleComputer();
  }, 300);
}

function scheduleComputer() {
  state.busy = true;
  thinkingIndicator.hidden = false;
  renderPrompt();

  setTimeout(() => {
    thinkingIndicator.hidden = true;
    state.busy = false;

    let moveR, moveC;
    if (settings.variant === 'rectangular') {
      const T = state.colStart[0];
      const B = state.colStart[1];
      const N = state.cols;
      if (settings.opponent === 'expert') {
        [moveR, moveC] = rectExpertMove(T, B, N);
      } else {
        [moveR, moveC] = rectNoviceMove(T, B, N);
      }
    } else {
      if (settings.opponent === 'expert') {
        [moveR, moveC] = squareExpertMove(state.colStart.slice(), state.cols);
      } else {
        [moveR, moveC] = squareNoviceMove(state.colStart.slice(), state.cols);
      }
    }

    applyMove(moveR, moveC);
  }, 750);
}

// ── Render ────────────────────────────────────────────────────────────────────

function cellSize(rows, cols) {
  const maxW = Math.min(window.innerWidth - 80, 620);
  const maxH = window.innerHeight * 0.55;
  const byCols = (maxW - (cols - 1) * 5) / cols;
  const byRows = (maxH - (rows - 1) * 5) / rows;
  return Math.floor(Math.min(byCols, byRows, 72, Math.max(32, 480 / cols)));
}

function renderGrid() {
  const { rows, cols, colStart } = state;
  const cs = cellSize(rows, cols);

  chompGrid.style.gridTemplateColumns = `repeat(${cols}, ${cs}px)`;
  chompGrid.style.gridTemplateRows    = `repeat(${rows}, ${cs}px)`;
  chompGrid.innerHTML = '';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      const isPoison = r === rows - 1 && c === cols - 1;
      const removed  = c < colStart[r];

      cell.className = 'chomp-cell' + (isPoison ? ' poison' : '') + (removed ? ' removed' : '');
      cell.dataset.r = r;
      cell.dataset.c = c;

      if (isPoison) {
        const img = document.createElement('img');
        img.src = 'https://res.cloudinary.com/dg5qdikkj/image/upload/w_auto,dpr_auto,f_auto,q_auto/v1789150412/chomp_skull_image_orange_v9g2re.png';
        img.alt = 'Poison';
        cell.appendChild(img);
      }

      if (!removed && !state.over && !state.busy && !isComputerTurn()) {
        cell.addEventListener('mouseenter', () => highlightChomp(r, c));
        cell.addEventListener('mouseleave', clearHighlight);
        cell.addEventListener('click', () => { clearHighlight(); applyMove(r, c); });
      }

      chompGrid.appendChild(cell);
    }
  }
}

function highlightChomp(hoverR, hoverC) {
  const cells = chompGrid.querySelectorAll('.chomp-cell');
  const { rows, cols, colStart } = state;
  cells.forEach(cell => {
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const removed = c < colStart[r];
    if (!removed && r <= hoverR && c <= hoverC) {
      cell.classList.add('will-chomp');
    } else {
      cell.classList.remove('will-chomp');
    }
  });
}

function clearHighlight() {
  chompGrid.querySelectorAll('.will-chomp').forEach(c => c.classList.remove('will-chomp'));
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
  promptSection.hidden = state.over || isComputerTurn() || state.busy;
}

function renderGameOver() {
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

$('cols-slider').addEventListener('input', () => {
  $('cols-display').textContent = $('cols-slider').value;
});

$('size-slider').addEventListener('input', () => {
  $('size-display').textContent = $('size-slider').value;
});

document.querySelectorAll('input[name="variant"]').forEach(r => {
  r.addEventListener('change', () => {
    const v = document.querySelector('input[name="variant"]:checked').value;
    $('rect-size-field').hidden  = v !== 'rectangular';
    $('square-size-field').hidden = v !== 'square';
  });
});

document.querySelectorAll('input[name="opponent"]').forEach(r => {
  r.addEventListener('change', () => {
    const val = document.querySelector('input[name="opponent"]:checked').value;
    $('p2-label').textContent = val !== 'human' ? 'Computer' : 'Player 2';
  });
});
