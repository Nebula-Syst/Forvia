# Third-party notices

## A note on this repository's own license (2026-09-19 split)

Forvia is a continuation of [**openGym**](https://gitlab.com/DuarteSantos8/opengym) by Duarte
Santos, AGPL-3.0 — auth, sessions, account management, workout/routine/bodyweight/nutrition-diary
sync, the base admin panel, and the exercise catalog are still substantially that codebase's own
history, carried forward. That part has been split into its own repository and service,
[**forvia-core**](https://github.com/Nebula-Syst/forvia-core), which stays AGPL-3.0 (its own
NOTICE.md explains why in full).

Everything else in THIS repository — the frontend, and the backend in `api/` (level/XP/prestige,
streaks, anti-cheat, daily tasks, the social feed, and the whole coach/box system) — is Nebula
Systems' own original work, genuinely separable from openGym's contribution (confirmed by diffing
directly against the real upstream repository, not by assumption). The two services talk to each
other over a small internal API (see `api/server.js`'s own comments) so the product still works as
one app; each side's own license only ever governs its own code.

**The AGPL-3.0 LICENSE file in this repository's root is being replaced** — Nebula Systems'
own license text for its share of this codebase is still being finalized. Until that lands, treat
this repository's non-openGym-derived code (as scoped above) as "all rights reserved, license
pending" rather than AGPL, since AGPL is no longer an accurate description of what's here.

## App store exception (forvia-core only)

As an additional permission under section 7 of the AGPL v3.0, forvia-core's copyright holder
permits distribution of the Forvia mobile application through app store platforms (such as the
Apple App Store and Google Play) whose terms of service would otherwise be incompatible
with the AGPL, provided the corresponding source code remains available under the AGPL at
that project's own repository. This permission applies to the distribution channel only and does
not otherwise limit the license.

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
licenses them differently. Neither is covered by Forvia's AGPL license.

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
Forvia's own derivative work and are covered by Forvia's AGPL.

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

### Images & animations — third-party, not MIT and not AGPL

The exercise thumbnails (180×180) and animations are **not** covered by the MIT license above and
**not** by Forvia's AGPL. Their ownership is currently **unresolved**, and Forvia states this
plainly rather than guessing:

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
[openGym](https://gitlab.com/DuarteSantos8/opengym) by Duarte Santos, distributed under the
same AGPL v3.0 license. `Forvia` is the current Nebula Systems continuation of that codebase;
the copyright notices above remain unchanged and apply to the original work they describe.
