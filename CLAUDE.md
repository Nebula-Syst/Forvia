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
