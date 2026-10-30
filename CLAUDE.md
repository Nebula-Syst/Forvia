# Working on Forvia

## Before touching production

Before any change that touches `forvia-prod-*` — a code deploy (`gh release create`)
that affects data-adjacent behavior, or a direct SQL edit against
`forvia-prod-db-1` — take a backup first:

```
docker exec forvia-prod-db-1 pg_dump -U forvia forvia > <scratchpad>/forvia-prod-backup-$(date +%s).sql
```

Verify the change is actually correct afterward (query the data, check the live
app), *then* delete the backup file. Don't restore automatically — only restore
from it if verification finds something wrong.

This came out of a real incident: admin fields on a real account
(`adminXpAdjust`, `prestigeConfirmed`, `prestigeBaselineXp`) got reset because
their values looked like corruption from a stale read of the audit log — they
weren't; the account holder was live-testing a just-shipped feature at that
exact moment. There was no backup to fall back on. Check the audit log and ask
before assuming something on someone else's live data is broken, and always
have a backup ready regardless.

## How every change ships

Every feature or fix, however small, goes issue → branch → PR → milestone → release. Only
Dependabot's own PRs skip it. Issues and PRs are written in Spanish (the team's language); code,
comments and commit messages in English.

1. **Issue first.** Search before creating (`gh issue list -R Nebula-Syst/Forvia -s all --search "<words>"`).
   If there is none:
   ```bash
   gh issue create -R Nebula-Syst/Forvia --title "Añadir …" --assignee @me \
     --label <enhancement|bug|documentation|docker|github_actions> --milestone vX.Y.Z \
     --body "<problem · proposed approach · done when …>"
   ```
   A change that spans repos (Forvia / forvia-core / forvia-landing) gets one issue per repo,
   each linking the others.
2. **Milestone = the next version.** Each repo keeps one open milestone, named after the release
   it becomes (`vX.Y.Z`, like the closed ones). List it with
   `gh api repos/Nebula-Syst/Forvia/milestones -q '.[].title'`; if there is none, create it from
   the last release (`gh release list -R Nebula-Syst/Forvia -L 1`): patch for fixes/docs/chores,
   minor as soon as it holds a feature —
   `gh api repos/Nebula-Syst/Forvia/milestones -f title=vX.Y.Z`. A feature landing in a patch
   milestone renames it: `gh api -X PATCH repos/Nebula-Syst/Forvia/milestones/<n> -f title=vX.Y+1.0`.
3. **Branch from the issue**, never commit to `main`:
   `gh issue develop <n> -R Nebula-Syst/Forvia --name "<n>-<short-slug>" --base main`, then fetch
   and check it out. The `<n>-<slug>` name matches the existing branches and links the branch to
   the issue.
4. **Commits**: small, with a Conventional Commits prefix — `feat:`, `fix:`, `docs:`, `test:`,
   `ci:`, `chore:`.
5. **Test before opening the PR:**
   ```bash
   cd frontend && npm test && npm run build
   cd api && npm test   # needs Postgres: forvia-core's dev db by default, or TEST_DATABASE_URL
   ```
   and click through the flow you touched (see CONTRIBUTING.md). CI runs the same in `Tests`.
6. **Pull request** into `main`, with the issue's milestone and label:
   ```bash
   gh pr create -R Nebula-Syst/Forvia --base main --title "feat: …" --assignee @me \
     --milestone vX.Y.Z --label <same as the issue> \
     --body "Closes #<n> · what changed and why · how it was tested"
   ```
   `Closes #<n>` is required so merging closes the issue. Wait for `Tests` to pass. Don't merge it
   yourself unless asked — a teammate reviews and merges.
7. **Release = deploy to production.** Only when asked, and only once every issue in the
   milestone is closed:
   ```bash
   gh release create vX.Y.Z -R Nebula-Syst/Forvia --target main --title forvia_vX.Y.Z --generate-notes
   gh api -X PATCH repos/Nebula-Syst/Forvia/milestones/<n> -f state=closed
   gh run watch -R Nebula-Syst/Forvia <run-id>   # build + deploy, then check the live site
   ```

## How it deploys

Publishing a GitHub release (not just pushing a tag) runs `.github/workflows/docker-publish.yml`:
`build` publishes `ghcr.io/nebula-syst/forvia-api` and `forvia-web` with that tag on GHCR, then `deploy` runs on the
`forvia-deploy` self-hosted runner on the production host — it sets `FORVIA_VERSION=<tag>` in
`/home/server/services/forvia-prod/.env` and recreates only `api`, `web` (and `core-api`, at whatever `CORE_VERSION` pins). Nothing is built on
the server. A push to `main` only refreshes `:latest`, which production never runs. A release whose
commit predates a workflow fix still runs the old workflow — cut a new release instead of re-running.
