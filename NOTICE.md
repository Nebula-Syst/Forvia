# Third-party notices

## This repository's own license (2026-09-19 split)

Forvia is a continuation of [**openGym**](https://gitlab.com/DuarteSantos8/opengym) by Duarte
Santos, AGPL-3.0 — auth, sessions, account management, workout/routine/bodyweight/nutrition-diary
sync, the base admin panel, and the exercise catalog are still substantially that codebase's own
history, carried forward. That part has been split into its own repository and service,
[**forvia-core**](https://github.com/Nebula-Syst/forvia-core), which stays AGPL-3.0 (its own
NOTICE.md explains why in full) — that service is never distributed itself, only run, so nothing
below concerns it.

Everything else in THIS repository — the frontend, and the backend in `api/` (level/XP/prestige,
streaks, anti-cheat, daily tasks, the social feed, and the whole coach/box system) — is Nebula
Systems' own original work, genuinely separable from openGym's contribution (confirmed by diffing
directly against the real upstream repository, not by assumption): none of it exists there at all.
It's licensed under the **PolyForm Noncommercial License 1.0.0** (see [LICENSE](LICENSE)) — free
to run, study, modify and redistribute for any noncommercial purpose; commercial use needs a
separate license from Nebula Systems. The two services talk to each other over a small internal
API (see `api/server.js`'s own comments) so the product still works as one app; each side's own
license only ever governs its own code.

**Update, 2026-09-20:** the frontend files flagged in the previous version of this notice —
`components/BodyMap.jsx`, `components/ErrorBoundary.jsx`, `components/Heatmap.jsx`,
`components/LineChart.jsx`, `components/NumField.jsx`, `components/RestTimer.jsx`,
`components/Stepper.jsx`, `components/Toast.jsx`, `main.jsx`, and `views/History.jsx` — have
since been independently rewritten: same behavior and the same CSS/DOM contract the rest of the
app already relies on, but a genuinely different implementation (different internal structure,
different naming, different algorithms where there was room for one) rather than openGym's own
original expression carried forward with cosmetic edits. They're covered by the PolyForm license
above now, along with the rest of `frontend/src`.

**Update, 2026-09-25 — the last caveat is closed.** `components/Icon.jsx`'s glyphs are no longer
openGym's own artwork: the whole set is now [**Tabler Icons**](https://github.com/tabler/tabler-icons)
(MIT license) — chosen because Tabler's own convention (24×24 grid, 2px stroke, round caps/joins)
already matches this file's existing CSS contract, so nothing about how `<Icon>` is called
anywhere else in the app changed. A handful of genuinely gym-specific glyphs Tabler doesn't carry
(the arm/abs/legs/pullup routine badges, a weight plate, a cable machine, a boxing glove, and the
two small water-preset icons) are this project's own new drawings instead. Nothing in this
repository is openGym's own original expression any more.

## App icon set

Most of the icon glyphs in `frontend/src/components/Icon.jsx` (navigation, actions, achievements,
food, and most training icons) are from [**Tabler Icons**](https://github.com/tabler/tabler-icons)
by Paweł Kuna, used under the **MIT License** and reproduced below, unmodified apart from being
inlined as bare `<path>`/`<circle>`/`<rect>` elements (Tabler's own per-icon stroke/fill attributes
are dropped, since this app already applies them once via CSS). The arm/abs/legs/pullup routine
badges, the weight plate, the cable machine, the boxing glove, and the two small water-preset
icons are Forvia's own original drawings, not from Tabler.

```
MIT License

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Body diagram geometry

The muscle outlines the body maps are drawn from (`frontend/src/lib/body-paths.js`) are derived
from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the
**MIT License** and reproduced below. MuscleMap ships its path data as Swift source rather than
`.svg` files; the paths were converted to a JSON module, its sub-group shapes were dropped, and
nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Exercise data & media

Forvia obtains both through
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset), which
licenses them differently. Neither is covered by Forvia's own license.

That dataset is itself a redistribution: the content originates from
[**ExerciseDB v1**](https://exercisedb.dev/) by **AscendAPI**. This is verifiable from Forvia's
own data — the stored media filenames embed ExerciseDB's `exerciseId` (Forvia's `0001` is
`0001-2gPfomN.jpg`; `2gPfomN` is ExerciseDB's id for "3/4 sit-up"), every metadata field matches,
and the instruction sentences are identical apart from stripped `Step:N ` prefixes. See
[issue #5](https://github.com/hasaneyldrm/exercises-dataset/issues/5) on that dataset.

### Metadata & instruction text

The exercise names, attributes and instructions (English in `frontend/src/lib/exercises-data.js`,
other languages in `frontend/src/instr/`, regenerated via `scripts/build-instructions.mjs`)
originate from ExerciseDB v1 and reach Forvia through the dataset above, which distributes them
under the MIT license reproduced below. The translations into languages other than English are
Forvia's own derivative work and are covered by Forvia's own license above.

```
MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation and data files (the "Software"),
to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Images & animations — third-party, not MIT and not Forvia's own license

The exercise thumbnails (180×180) and animations are **not** covered by the MIT license above and
**not** by Forvia's own license. Their ownership is currently **unresolved**, and Forvia states
this plainly rather than guessing:

- The upstream dataset attributes them to **© [Gym visual](https://gymvisual.com/)**, redistributed
  there with that rights holder's written permission — a permission granted to *that dataset* and
  **not transferable**.
- **ExerciseDB/AscendAPI** describes itself as "the original creator and owner" of this content and
  publishes its own [terms](https://exercisedb.io/faq), which permit self-hosting, bundling and
  commercial display, while prohibiting redistribution of the raw dataset or media as a standalone
  or competing content package.

These two claims contradict each other. A clarification has been requested from AscendAPI; this
notice will be updated once the provenance is settled.

**Until then, treat the media as third-party content licensed to neither Forvia nor to you.**

**Forvia does not redistribute it.** It is not in this repository, not in its history, and not in
the published container images or the Android APK. A self-hosted instance downloads it from the
upstream source on first `docker compose up`; the mobile and demo builds load it from a CDN at
runtime.

If you want to reuse the media — in Forvia or anywhere else, commercially or not — **clear it with
the rights holder first**, and keep any attribution that accompanies it intact.

## Mini-games (2026-10-09)

`frontend/public/games/` (`shared/`, `labyrinth/`, `snake/`, `memory/`, `whac-a-mole/`) is
vendored from [**OpenGames**](https://github.com/opengames-dev/opengames-dev.github.io) by the
OpenGames contributors, commit `b3afbbb` (2026-09-09), used under the **MIT License** reproduced
below. These are the playable mini-games offered during a workout's rest periods and from the
standalone "Mini-games" catalog in Settings — pure HTML/CSS/vanilla JS, no build step, no network
calls, no accounts. Everything *around* them (the catalog page, the rest-timer integration, the
embedding chrome) is Forvia's own code under the PolyForm license above.

**Not unmodified.** Each game's `index.html` carries two small Forvia-specific additions on top
of the otherwise-untouched upstream file: an extra stylesheet link
(`shared/forvia.css`, a new file, not from upstream — a dark-theme override layer matching
Forvia's own palette instead of the games' light default, and larger touch targets) and one
inline script neutralizing the games' own Escape-key "exit immersive view" handler, since that
view is now forced on permanently (`is-focused` added to `<body>`'s class list in each file) —
without it, the normal view's header (a title and an "← All games" link to a page Forvia doesn't
serve) would show through status-bar/notch safe areas with no working destination. CSS can't
reach a `<canvas>`'s own drawing, so `snake/game.js` and `labyrinth/game.js` also have their few
hardcoded board/wall/trail colors swapped for this same dark palette (same shapes, same logic,
different hex values only). `logic.js`, `style.css`, `shared/favicon.svg`, and `LICENSE` are
untouched.

**2026-10-09 — Spanish.** `GamePlayer.jsx` appends `?lang=es|en` to every game's iframe `src`.
A new `shared/forvia-i18n.js` (loaded first, not from upstream) holds a small EN→ES dictionary
and does two things when that param is `es`: translates the static shell text present in every
game's `index.html` (stat labels, Pause/Restart, the difficulty panel, the control hint) by
element id/class — the same markup in all four games, so one pass covers them — and exposes a
`FT(string)` lookup helper. `shared/ui.js` and each game's own `game.js` (`snake/`, `labyrinth/`,
`memory/`, `whac-a-mole/`) now wrap their handful of hardcoded result strings (e.g. "Game over",
"N fruits collected · Best N") in calls to that helper instead of hardcoding English outright.

```
MIT License

Copyright (c) 2026 OpenGames contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## More mini-games (2026-10-09)

`frontend/public/games/crisp/` (`shared/bundle.js`, `shared/sounds.js`, and one `<slug>/main.js`
per game) is vendored from [**crisp-game-lib-11-games**](https://github.com/abagames/crisp-game-lib-11-games)
by ABA Games, MIT License, plus the [**crisp-game-lib**](https://github.com/abagames/crisp-game-lib)
engine itself (`shared/bundle.js`) and [**sounds-some-sounds**](https://github.com/abagames/sounds-some-sounds)
(`shared/sounds.js`), both by the same author, same license — reproduced in
`frontend/public/games/crisp/shared/LICENSE.txt`. Three of these games use a theme that needs
real WebGL filters, so `shared/pixi.min.js` and `shared/pixi-filters.js` are also vendored, from
[**pixi.js**](https://github.com/pixijs/pixijs) and [**pixi-filters**](https://github.com/pixijs/pixi-filters)
(Mathew Groves, Chad Engler, MIT License) — self-hosted rather than loaded from a CDN at runtime
like upstream's own demo page does, so these games work offline and don't depend on a third
party staying up. Each game's `index.html` is this project's own (not from upstream, which uses
one shared page with a `?gamename` query string instead of a folder per game) — same dark
background recipe as the rest of the mini-games, and the one line needed to actually boot the
engine (`window.addEventListener('load', onLoad)`, upstream's own bootstrapping call, just made
explicit here instead of living in upstream's shared index.html).

**2026-10-09 — Spanish.** This engine's bitmap font (`shared/bundle.js`) only ever covered
0x21–0x7e, plain ASCII — no `áéíóúñ¿¡`. `printChar`'s range check and character-to-glyph lookup
are patched to also recognize those fourteen characters, and `textPatterns` (the font's own
pixel-pattern table, one entry per character, untouched for every character already in it) gets
fourteen more hand-drawn entries appended in the exact same format — same 'l'-per-dot style as
every existing glyph, not a different font. The only hardcoded UI string shared by every game in
the collection (checked: none of the 26 override it) is also patched there: `GAME_OVER`'s English
default becomes `FIN DEL JUEGO` under `?lang=es`. Each game's own `main.js` has its `title` and
`description` (the text shown on the title screen, control instructions included) translated the
same way — an `__es` check picks between the original English and a new Spanish string — with
everything else in that file (actual gameplay logic) untouched.

**2026-10-10 — Volume and portrait framing.** `shared/sounds.js`'s own `setVolume` (no on/off
concept, no persistence) is called directly from `GamePlayer.jsx` via same-origin
`iframe.contentWindow.sss.setVolume(...)` — nothing in this vendored batch changed for that.
What did change: `setSize`'s fit multiplier in `shared/bundle.js` (`const cs`, was `0.95`) is now
`0.88`, a pure CSS-display-size constant, decoupled from each game's own `canvasSize`/`viewSize`
game-unit coordinates and therefore from its gameplay/collision math. And a new, not-from-upstream
`shared/forvia.js` (loaded by every game's `index.html` in place of the small inline background
script each used to carry individually) adds rounded corners and a drop shadow/glow to the
`<canvas>` once it's on the page. Several of these games use a wide/landscape `viewSize`
(Up 1 Way, Charge Beam, Growth, Pakupaku...), and the engine always fits the canvas to the
screen's *constraining* axis at that fixed ratio — on a tall 9:16 phone that leaves real empty
space above and below even a square game, and a thin strip for a wide one. Re-tuning 26 games'
own `viewSize` to fill a phone screen would mean re-balancing each one's hand-built layout and
collision bounds, so that's left untouched; the card framing instead makes that empty space read
as deliberate chrome around a floating "cartridge" rather than a layout bug.

**2026-10-10 — Landscape lock.** Card framing alone wasn't enough for the widest of these games
(`landscape: true` in `lib/games.js`: Charge Beam, Clean Robo, Foot Laser, Growth, Paku Paku,
Shiny, Sky Golf, Up 1 Way) — nothing about their own `viewSize` changed, but `GamePlayer.jsx` now
tries to rotate the *screen* for just those, with `requestFullscreen()` + `screen.orientation.lock
('landscape')` (both standard Web APIs, no vendored file touched), unwound on close. Once the
screen is actually landscape, `shared/bundle.js`'s own `setSize` (unmodified logic, just reacting
to the resize its own `window.addEventListener('resize', ...)` already listens for) fills it
properly on its own. Neither API is universal — no Fullscreen or Orientation Lock support at all
on iOS Safari, and some browsers refuse a landscape lock outright — so both calls are wrapped in
try/catch; where they're refused, this just falls back to the portrait card framing above, not a
crash.

`frontend/public/games/2048/` (`js/`, `style/`, minus its old IE/Safari-only `.eot`/`.svg` font
formats — this project only ever serves a modern WebView or browser, and `.woff` alone covers
that) is vendored from [**2048**](https://github.com/gabrielecirulli/2048) by Gabriele Cirulli,
MIT License (`LICENSE.txt` kept alongside it). `index.html` is this project's own: the same
elements and scripts as upstream's, minus the apple-touch-icon/startup-image links (dropped along
with the image files themselves — not useful inside an iframe) and the closing promotional
paragraphs, plus one new `forvia.css` for the same dark background treatment. The board's own
tile colors — the whole point of the game's look — are untouched.

**2026-10-09 — Spanish.** `index.html` sets `<html lang>` from the same `?lang=` param and
translates its own static text (intro, "New Game", "How to play") inline when it's `es`;
`js/html_actuator.js`'s two win/lose messages do the same. "Score"/"Best" are CSS-generated
content in upstream's own `style/main.css` (untouched) — overridden for Spanish in `forvia.css`
instead, scoped to `html[lang="es"]`.

## This fork

This repository is maintained by Nebula Systems as an update/fork of
[openGym](https://gitlab.com/DuarteSantos8/opengym) by Duarte Santos. The part of that lineage
that is still genuinely openGym's own code lives in
[forvia-core](https://github.com/Nebula-Syst/forvia-core) now, under its original AGPL v3.0
license (plus the handful of frontend files named above, until their own review is done); the
copyright notices in this file remain unchanged and apply to the original works they each
describe, regardless of which license governs the code that surrounds them today.
