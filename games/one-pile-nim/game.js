'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let settings       = null;
let state          = null;
let hasShownRules  = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const settingsScreen    = $('settings-screen');
const gameScreen        = $('game-screen');
const turnIndicator     = $('turn-indicator');
const pileInfo          = $('pile-info');
const counterArea       = $('counter-area');
const movesSection      = $('moves-section');
const moveButtonsEl     = $('move-buttons');
const thinkingIndicator = $('thinking-indicator');
const rulesPanel        = $('rules-panel');
const gameOverPanel     = $('game-over-panel');
const winnerText        = $('winner-text');
const closeSettingsBtn  = $('close-settings-btn');

// ── Rules content ─────────────────────────────────────────────────────────────

const VARIANT_NAMES = {
  '123':     '1, 2, 3 Nim',
  'squares': 'Nim Squares',
  'primes1': 'Nim Primes',
};

const VARIANT_RULES = {
  '123': [
    '1, 2, 3 Nim is a game for two players.',
    'On your turn, take 1, 2 or 3 counters.',
    'The winner is the player who takes the last counter.',
  ],
  'squares': [
    'Nim Squares is a game for two players.',
    'On your turn, take some counters. The number of counters you take must be a square number.',
    'The winner is the player who takes the last counter.',
  ],
  'primes1': [
    'Nim Primes is a game for two players.',
    'On your turn, take some counters. The number of counters you take must be either a prime number or 1.',
    'The winner is the player who takes the last counter.',
  ],
};

function showRulesPanel() {
  $('rules-panel-title').textContent = VARIANT_NAMES[settings.rules];
  const rules = VARIANT_RULES[settings.rules].map((r, i, arr) =>
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

// ── Math helpers ──────────────────────────────────────────────────────────────

function isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

function validMoves(pile, rules) {
  const moves = [];
  if (rules === '123') {
    for (let i = 1; i <= Math.min(3, pile); i++) moves.push(i);
  } else if (rules === 'squares') {
    for (let k = 1; k * k <= pile; k++) moves.push(k * k);
  } else {
    // primes ∪ {1}
    if (pile >= 1) moves.push(1);
    for (let n = 2; n <= pile; n++) {
      if (isPrime(n)) moves.push(n);
    }
  }
  return moves;
}

// ── AI ────────────────────────────────────────────────────────────────────────

// Novice: take a winning move if one exists, otherwise pick at random.
//   Normal – winning move leaves 0 counters (opponent faces empty pile).
//   Misère – winning move leaves exactly 1 (opponent is forced to take it and lose).
function noviceMove(pile, rules, misere) {
  const moves = validMoves(pile, rules);
  const winTarget = misere ? 1 : 0;
  const win = moves.find(m => pile - m === winTarget);
  if (win !== undefined) return win;
  return moves[Math.floor(Math.random() * moves.length)];
}

// Expert lookup table for squares, standard game (positions 1–30).
// Entries are the move(s) the expert should take; when multiple, one is chosen at random.
const SQUARES_EXPERT = [
  null,          // 0 – unused
  [1],           // 1
  [1],           // 2
  [1],           // 3
  [4],           // 4
  [1],           // 5
  [1, 4],        // 6
  [1],           // 7
  [1],           // 8
  [9],           // 9
  [4],           // 10
  [1, 4, 9],     // 11
  [1],           // 12
  [1],           // 13
  [4, 9],        // 14
  [1],           // 15
  [16],          // 16
  [4],           // 17
  [1, 16],       // 18
  [4, 9],        // 19
  [1],           // 20
  [1, 4, 9, 16], // 21
  [1],           // 22
  [1, 16],       // 23
  [4, 9],        // 24
  [25],          // 25
  [4, 9, 16],    // 26
  [25],          // 27
  [16],          // 28
  [9],           // 29
  [25],          // 30
];

// Expert lookup table for primes1, standard game (positions 1–30).
const PRIMES1_EXPERT = [
  null,               // 0 – unused
  [1],                // 1
  [2],                // 2
  [3],                // 3
  [1],                // 4
  [5],                // 5
  [2],                // 6
  [7],                // 7
  [2],                // 8
  [1, 5],             // 9
  [2],                // 10
  [11],               // 11
  [2],                // 12
  [13],               // 13
  [2],                // 14
  [3, 7, 11],         // 15
  [2],                // 16
  [17],               // 17
  [2],                // 18
  [19],               // 19
  [2],                // 20
  [1, 5, 13, 17],     // 21
  [2],                // 22
  [23],               // 23
  [2],                // 24
  [1, 5, 13, 17],     // 25
  [2],                // 26
  [3, 7, 11, 19, 23], // 27
  [2],                // 28
  [29],               // 29
  [2],                // 30
];

// Expert lookup table for primes1, misère game (positions 1–30).
// Where n−1 is prime the computer always takes n−1 (leaving the opponent 1 counter).
const PRIMES1_EXPERT_MISERE = [
  null,                  // 0 – unused
  [1],                   // 1
  [1],                   // 2
  [2],                   // 3
  [3],                   // 4
  [1],                   // 5
  [5],                   // 6
  [2],                   // 7
  [7],                   // 8
  [2],                   // 9
  [5, 1],                // 10
  [2],                   // 11
  [11],                  // 12
  [2],                   // 13
  [13],                  // 14
  [2],                   // 15
  [11, 7, 3],            // 16
  [2],                   // 17
  [17],                  // 18
  [2],                   // 19
  [19],                  // 20
  [2],                   // 21
  [17, 13, 5, 1],        // 22
  [2],                   // 23
  [23],                  // 24
  [2],                   // 25
  [17, 13, 5, 1],        // 26
  [2],                   // 27
  [23, 19, 11, 7, 3],    // 28
  [2],                   // 29
  [29],                  // 30
];

// Expert lookup table for squares, misère game (positions 1–30).
const SQUARES_EXPERT_MISERE = [
  null,          // 0 – unused
  [1],           // 1
  [1],           // 2
  [1],           // 3
  [1],           // 4
  [4],           // 5
  [1],           // 6
  [4, 1],        // 7
  [1],           // 8
  [1],           // 9
  [9],           // 10
  [4],           // 11
  [9, 4, 1],     // 12
  [4],           // 13
  [1],           // 14
  [9, 4],        // 15
  [9],           // 16
  [16],          // 17
  [4],           // 18
  [16, 1],       // 19
  [9, 4],        // 20
  [1],           // 21
  [16, 9, 4, 1], // 22
  [4],           // 23
  [16, 1],       // 24
  [9, 4],        // 25
  [25],          // 26
  [16, 9, 4],    // 27
  [25],          // 28
  [16],          // 29
  [9],           // 30
];

// General expert via game-theory DP. Used as fallback for out-of-range piles.
// Computes which positions are losing for the player to move, then picks a random optimal move.
function expertMoveDP(pile, rules, misere) {
  const isLosing = new Array(pile + 1).fill(false);
  if (!misere) {
    isLosing[0] = true; // no counters left → you lose
    for (let n = 1; n <= pile; n++) {
      isLosing[n] = !validMoves(n, rules).some(m => isLosing[n - m]);
    }
  } else {
    // Taking the last counter is a loss, so moves to 0 are never optimal.
    isLosing[1] = true; // forced to take last counter → you lose
    for (let n = 2; n <= pile; n++) {
      isLosing[n] = !validMoves(n, rules).some(m => n - m > 0 && isLosing[n - m]);
    }
  }
  const moves = validMoves(pile, rules);
  const optimal = !misere
    ? moves.filter(m => isLosing[pile - m])
    : moves.filter(m => pile - m > 0 && isLosing[pile - m]);
  if (optimal.length === 0) return moves[0] ?? 1;
  return optimal[Math.floor(Math.random() * optimal.length)];
}

// Expert: uses rule-specific optimal strategy.
//   123     – mod-4 pattern (standard) / leave ≡1 mod 4 (misère)
//   squares – lookup table (standard); DP (misère)
//   primes1 – lookup table (standard and misère)
function expertMove(pile, rules, misere) {
  if (rules === '123') {
    const moves = validMoves(pile, rules);
    const targetRem = misere ? 1 : 0;
    const ideal = moves.find(m => (pile - m) % 4 === targetRem);
    return ideal !== undefined ? ideal : 1;
  }
  if (rules === 'primes1') {
    const table = misere ? PRIMES1_EXPERT_MISERE : PRIMES1_EXPERT;
    const options = table[pile];
    if (options) return options[Math.floor(Math.random() * options.length)];
  }
  if (rules === 'squares') {
    const table = misere ? SQUARES_EXPERT_MISERE : SQUARES_EXPERT;
    const options = table[pile];
    if (options) return options[Math.floor(Math.random() * options.length)];
  }
  return expertMoveDP(pile, rules, misere);
}

// ── Grid layout ───────────────────────────────────────────────────────────────

// Returns the number of columns that keeps the counter grid closest to a 3:7 ratio.
// ceil(n/3) gives exactly 3 rows for every starting value, with columns scaling to match.
function columnsForPile(n) {
  return Math.ceil(n / 3);
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
    pile:        parseInt($('starting-counters').value, 10),
    opponent:    document.querySelector('input[name="opponent"]:checked').value,
    firstPlayer: document.querySelector('input[name="first-player"]:checked').value,
    rules:       document.querySelector('input[name="rules"]:checked').value,
    misere:      $('misere').checked,
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

  state = {
    pile: settings.pile,
    currentPlayer,
    over:   false,
    winner: null,
    busy:   false,
  };

  counterArea.className = 'counter-area';
  counterArea.style.gridTemplateColumns = `repeat(${columnsForPile(settings.pile)}, 1fr)`;
  renderRulesDisplay();

  settingsScreen.hidden = true;
  gameScreen.hidden = false;

  render();

  if (!suppressComputerStart && isComputerTurn()) scheduleComputer();
}

function isComputerTurn() {
  return !state.over && isComputerOpponent() && state.currentPlayer === 2;
}

// ── Move execution ────────────────────────────────────────────────────────────

function applyMove(n) {
  if (state.busy || state.over) return;
  state.busy = true;

  movesSection.hidden = true;
  thinkingIndicator.hidden = true;

  // Grey out the last n active counters in place
  const active = Array.from(counterArea.querySelectorAll('.counter:not(.removed)'));
  for (let i = active.length - n; i < active.length; i++) {
    active[i].classList.remove('will-take');
    active[i].classList.add('removed');
  }

  setTimeout(() => {
    state.pile -= n;

    if (state.pile === 0) {
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

function scheduleComputer() {
  state.busy = true;
  thinkingIndicator.hidden = false;

  setTimeout(() => {
    thinkingIndicator.hidden = true;
    state.busy = false;
    const move = settings.opponent === 'expert'
      ? expertMove(state.pile, settings.rules, settings.misere)
      : noviceMove(state.pile, settings.rules, settings.misere);
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
    const active = r === settings.rules
      || (r === 'standard' && !settings.misere)
      || (r === 'misere'   &&  settings.misere);
    pill.classList.toggle('active', active);
  });
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

function renderCounters() {
  counterArea.innerHTML = '';

  // Always show the full starting pile; taken counters appear greyed out in place
  for (let i = 0; i < settings.pile; i++) {
    const div = document.createElement('div');
    div.className = i < state.pile ? 'counter' : 'counter removed';
    counterArea.appendChild(div);
  }

  pileInfo.textContent = `${state.pile} counter${state.pile !== 1 ? 's' : ''} remaining`;
}

function renderMoves() {
  if (state.over || isComputerTurn() || state.busy) {
    movesSection.hidden = true;
    return;
  }

  movesSection.hidden = false;
  moveButtonsEl.innerHTML = '';

  // The full set of amounts the rules allow is fixed for the whole game (based on the
  // starting pile); amounts that exceed what's left are shown greyed out, not removed.
  const allMoves = validMoves(settings.pile, settings.rules);
  allMoves.forEach(m => {
    const legal = m <= state.pile;
    const btn = document.createElement('button');
    btn.className = 'btn-move';
    btn.textContent = `Take ${m}`;
    btn.disabled = !legal;
    if (legal) {
      btn.addEventListener('mouseenter', () => highlightLast(m));
      btn.addEventListener('mouseleave', clearHighlight);
      btn.addEventListener('click', () => { clearHighlight(); applyMove(m); });
    }
    moveButtonsEl.appendChild(btn);
  });
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

function highlightLast(n) {
  const active = Array.from(counterArea.querySelectorAll('.counter:not(.removed)'));
  active.forEach((c, i) => c.classList.toggle('will-take', i >= active.length - n));
}

function clearHighlight() {
  counterArea.querySelectorAll('.counter.will-take').forEach(c => c.classList.remove('will-take'));
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

// Keep starting-counters display in sync with slider
$('starting-counters').addEventListener('input', () => {
  $('counter-display').textContent = $('starting-counters').value;
});

// Keep "Who goes first → Player 2/Computer" label in sync with opponent selection
document.querySelectorAll('input[name="opponent"]').forEach(r => {
  r.addEventListener('change', () => {
    const val = document.querySelector('input[name="opponent"]:checked').value;
    $('p2-label').textContent = val !== 'human' ? 'Computer' : 'Player 2';
  });
});
