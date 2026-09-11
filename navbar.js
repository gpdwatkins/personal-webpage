// Shared navbar for sub-pages — logo centred, optional back button on the left.
// Include with:
//   <script src="[path/]navbar.js" data-root="[relative/path/to/root/]"
//           data-back-href="[relative/path/to/parent]" data-back-label="Label"></script>
// data-root: relative path from this page back to the repo root.
// data-back-href: href for the back link (relative to the current page). Omit if no back button.
// data-back-label: text for the back link (default "Back").

(function () {
  var script    = document.currentScript;
  var root      = script ? (script.getAttribute('data-root') || '') : '';
  var backHref  = script ? script.getAttribute('data-back-href') : null;
  var backLabel = script ? (script.getAttribute('data-back-label') || 'Back') : 'Back';

  var leftHTML = backHref
    ? '<a href="' + backHref + '" class="nav-back"><span class="nav-back-arrow"></span>' + backLabel + '</a>'
    : '';

  var nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.innerHTML =
    '<div class="nav-container">' +
      '<div class="nav-left">' + leftHTML + '</div>' +
      '<a href="' + root + 'index.html" class="nav-logo">Dr. George Watkins</a>' +
    '</div>';

  document.body.prepend(nav);
})();
