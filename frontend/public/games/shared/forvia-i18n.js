// Forvia addition, not upstream (see NOTICE.md). GamePlayer.jsx appends ?lang=es|en to every
// game's iframe src; this tiny dictionary + helper is what shared/ui.js and each game's own
// game.js call instead of hardcoding English, for the strings these games actually produce
// (control hints and the dynamic "N things collected" results messages). Loaded before ui.js
// and before each game's own game.js.
window.FT = (() => {
  const lang = new URLSearchParams(location.search).get('lang') === 'es' ? 'es' : 'en';
  const es = {
    'Sound on': 'Sonido activado',
    'Sound off': 'Sonido desactivado',
    'Resume': 'Reanudar',
    'Pause': 'Pausa',
    'Paused': 'En pausa',
    'Ready': 'Listo',
    'Play': 'Jugar',
    'Play again': 'Jugar de nuevo',
    'Game over': 'Fin del juego',
    'Board complete': 'Tablero completo',
    'fruit': 'fruta',
    'fruits': 'frutas',
    'collected': 'recogidas',
    'Best': 'Mejor',
    'Maze complete': 'Laberinto completo',
    'moves': 'movimientos',
    'Another maze': 'Otro laberinto',
    'All pairs found': 'Todas las parejas encontradas',
    'pairs': 'parejas',
    'New board': 'Nuevo tablero',
    'Round complete': 'Ronda completada',
    'moles caught': 'topos atrapados',
    'Another round': 'Otra ronda',
    '30 seconds': '30 segundos',
  };
  return s => (lang === 'es' && es[s] != null) ? es[s] : s;
})();

// Static shell text (stat labels, buttons, the difficulty/control-hint panel) — identical markup
// across all four OpenGames pages, so one pass covers them all. Runs once the shell exists;
// `defer` already guarantees this script and the DOM are both ready by the time it executes.
if (new URLSearchParams(location.search).get('lang') === 'es') {
  const STATS = { Score: 'Puntos', Best: 'Mejor', Moves: 'Movs', Time: 'Tiempo', Left: 'Quedan', Pairs: 'Parejas' };
  const HINTS = {
    'Arrow keys / WASD · Swipe or use the arrows · Gamepad supported<br>R to restart · Esc to pause / exit fullscreen':
      'Flechas / WASD · Desliza o usa las flechas · Mando compatible<br>R para reiniciar · Esc para pausar / salir de pantalla completa',
    'Tap a mole · Arrow keys + Space · Or use keys 1–9, left to right<br>R to restart · Esc to pause / exit fullscreen':
      'Toca un topo · Flechas + Espacio · O las teclas 1–9, de izq. a dcha.<br>R para reiniciar · Esc para pausar / salir de pantalla completa',
    'Tap a card · Arrow keys to move between cards · Enter or Space to flip<br>R to restart · Esc to pause / exit fullscreen':
      'Toca una carta · Flechas para moverte entre cartas · Intro o Espacio para voltear<br>R para reiniciar · Esc para pausar / salir de pantalla completa',
  };
  document.querySelectorAll('.stat-label').forEach(el => { if (STATS[el.textContent]) el.textContent = STATS[el.textContent]; });
  const pause = document.getElementById('pause'); if (pause) pause.textContent = 'Pausa';
  const restart = document.getElementById('restart'); if (restart) restart.textContent = 'Reiniciar';
  const action = document.getElementById('overlay-action'); if (action) action.textContent = 'Jugar de nuevo';
  const sound = document.getElementById('sound'); if (sound) sound.textContent = 'Sonido desactivado';
  document.querySelectorAll('.settings-label').forEach(el => { if (el.textContent === 'Difficulty') el.textContent = 'Dificultad'; });
  document.querySelectorAll('[data-difficulty]').forEach(el => {
    const d = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' }[el.dataset.difficulty];
    if (d) el.textContent = d;
  });
  const hint = document.getElementById('control-hint');
  if (hint && HINTS[hint.innerHTML]) hint.innerHTML = HINTS[hint.innerHTML];
  const settingsBtn = document.querySelector('summary.icon-button');
  if (settingsBtn) { settingsBtn.setAttribute('aria-label', 'Ajustes y controles'); settingsBtn.title = 'Ajustes y controles'; }
}
