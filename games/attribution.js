// Shared "In association with Maths Camps" badge for game pages.
// Include with (see attribution.css for the matching stylesheet include):
//   <script src="[path/]attribution.js"></script>
// Remove both includes on any page to fully revert.
//
// The badge is right-aligned beneath whichever box contains the page's main
// content (the game grid on the games list page, or the settings/game card
// on an individual game page), and is hidden while a game's settings screen
// is showing.

(function () {
  var LOGO_URL = 'https://res.cloudinary.com/dg5qdikkj/image/upload/v1789391410/Maths_Camps_Master_Logo_Positive_RGB_qgfj3q.svg';

  var badge = document.createElement('div');
  badge.className = 'attribution-badge';
  badge.innerHTML =
    '<span class="attribution-badge-text">In association with</span>' +
    '<span class="attribution-badge-pill">' +
      '<img class="attribution-badge-logo" src="' + LOGO_URL + '" alt="Maths Camps logo">' +
    '</span>';

  var row = document.createElement('div');
  row.className = 'attribution-badge-row';
  row.appendChild(badge);

  var main = document.querySelector('main');
  if (main && main.parentNode) {
    main.insertAdjacentElement('afterend', row);
  } else {
    document.body.appendChild(row);
  }

  var settingsScreen = document.getElementById('settings-screen');
  var gameScreen = document.getElementById('game-screen');
  var referenceBox = document.querySelector('.game-grid') || gameScreen || main;

  function align() {
    if (!referenceBox) return;
    var rect = referenceBox.getBoundingClientRect();
    var gap = document.documentElement.clientWidth - rect.right;
    row.style.paddingRight = Math.max(gap, 0) + 'px';
  }

  function updateVisibility() {
    if (settingsScreen && gameScreen) {
      row.hidden = gameScreen.hidden;
    }
  }

  align();
  updateVisibility();
  window.addEventListener('resize', align);

  if (settingsScreen && gameScreen) {
    var observer = new MutationObserver(function () {
      updateVisibility();
      align();
    });
    observer.observe(settingsScreen, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(gameScreen, { attributes: true, attributeFilter: ['hidden'] });
  }
})();
