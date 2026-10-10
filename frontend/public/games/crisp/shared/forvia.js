// Forvia's own host polish for every crisp-game-lib game (see NOTICE.md) — not part of
// upstream. Registered via a plain <script src> tag placed AFTER
// `<script>window.addEventListener('load', onLoad);</script>` in each game's index.html, so
// this listener fires second: onLoad() does `document.body.style.cssText = bodyCss` (a full
// overwrite), which would erase a background set before it runs.
window.addEventListener('load', function () {
  document.body.style.background =
    'radial-gradient(1400px 1000px at 8% -5%, rgba(163,230,53,.38), transparent 62%),' +
    'radial-gradient(1300px 950px at 96% 14%, rgba(163,230,53,.26), transparent 64%),' +
    'radial-gradient(1500px 1100px at 40% 105%, rgba(163,230,53,.24), transparent 60%),' +
    'radial-gradient(1200px 900px at 100% 100%, rgba(163,230,53,.16), transparent 60%),' +
    '#000000';

  // The engine fits its canvas to the screen's constraining axis at each game's own fixed
  // aspect ratio (bundle.js's setSize) — several of these games (Up 1 Way, Charge Beam, Growth,
  // Pakupaku...) use a wide/landscape viewSize, so on a tall 9:16 phone the canvas ends up a
  // thin strip with a lot of bare space above and below it. Reworking each game's own viewSize
  // would mean re-tuning 26 hand-built layouts/collision bounds — not worth the risk. Instead,
  // dress the canvas as a deliberate floating card (rounded corners, elevation, a soft lime
  // glow matching the app's own accent) so that space reads as intentional chrome around a
  // "cartridge", not a layout bug.
  var canvas = document.querySelector('canvas');
  if (canvas) {
    canvas.style.borderRadius = '20px';
    canvas.style.boxShadow =
      '0 24px 60px -12px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08) inset, 0 0 90px 10px rgba(163,230,53,.12)';
  }
});
