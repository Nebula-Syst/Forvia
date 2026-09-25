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

## This fork

This repository is maintained by Nebula Systems as an update/fork of
[openGym](https://gitlab.com/DuarteSantos8/opengym) by Duarte Santos. The part of that lineage
that is still genuinely openGym's own code lives in
[forvia-core](https://github.com/Nebula-Syst/forvia-core) now, under its original AGPL v3.0
license (plus the handful of frontend files named above, until their own review is done); the
copyright notices in this file remain unchanged and apply to the original works they each
describe, regardless of which license governs the code that surrounds them today.
