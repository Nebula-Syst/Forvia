import { t } from './i18n.js'

// One label per CHEAT_RULES row in api/server.js — keep the two in sync. The server sends the
// finding by id, not by translated text, so a new detection rule needs a line here too before
// it reads as anything but its bare id. Shared (not React) so both the reveal dialog and the
// penalties list read the exact same wording for the exact same finding.
export const FINDING_LABEL = {
  weight: () => t('Weight far beyond any recorded human lift'),
  reps: () => t('Far more reps in one set than physically possible'),
  prs: () => t('More new records claimed than exercises actually trained'),
  timing: () => t('Missing or nonsensical start/end time'),
  duration: () => t('Session far longer than a real workout'),
  pace: () => t('Sets completed far faster than physically possible'),
  overlap: () => t('Overlaps another logged session on the same account'),
}
export const STATUS_LABEL = { active: () => t('Flagged'), appealed: () => t('Under review'), upheld: () => t('Reviewed — penalty stands'), overturned: () => t('Reviewed — removed') }
export const STATUS_COLOR = { active: 'var(--red)', appealed: 'var(--orange)', upheld: 'var(--red)', overturned: 'var(--acc)' }
