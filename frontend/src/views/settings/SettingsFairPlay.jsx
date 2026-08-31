import { useNavigate } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import PenaltiesRow from '../../components/PenaltiesRow.jsx'

// Plain header + paragraph blocks (h4.sec, the same small-caps label Rank.jsx uses for "Tier
// path"/"All tiers") — no Section/.sect-b card wrapper. That card look is right for grouping
// rows you interact with, but wrapping a paragraph of prose in one made three near-identical
// boxes stack up here for no reason; a plain reading page doesn't need a container per idea.
//
// The anti-cheat part stays deliberately vague on exact thresholds (how fast is "too fast", how
// heavy is "too heavy") — explaining that the checks exist and are fair is the point; publishing
// the exact numbers would just be a tuning guide for the next attempt.
export default function SettingsFairPlay() {
  const nav = useNavigate()

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('How it works')}</h1></div>
    </div>

    <PenaltiesRow />

    <h4 className="sec">{t('Rank')}</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Your rank climbs automatically with your level — nine tiers, from Iron to Legend, each covering a range of levels. There’s nothing separate to unlock: you’re always exactly the tier your current level falls into.')}
    </p>

    <h4 className="sec">{t('Prestige')}</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Once you finish Legend at level 100, your level caps there and waits — nothing resets on its own. You get the option to upgrade your mastery whenever you want: it resets your level back to 1 and your prestige goes up by one. Prestige never resets — it only ever grows, and its perks stay unlocked for good.')}
    </p>

    <h4 className="sec">{t('Leveling up')}</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Every level costs a bit more XP than the last, so climbing gets slower the higher you go. XP comes from the workouts you log — sets done, different exercises trained, total weight moved — plus a bonus for personal records, reaching your weigh-in goal, and completing daily tasks.')}
    </p>

    <h4 className="sec">{t('Fair play & penalties')}</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Some rank rewards are worth real money, so every workout you log is checked automatically against what a real session can actually produce.')}
    </p>
    <div className="small" style={{ fontWeight: 600, margin: '12px 0 2px' }}>{t('What gets checked')}</div>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Weights and rep counts beyond any real lift, sessions with missing or impossible timing, two sessions overlapping on the same account, and personal records claimed on exercises that weren’t actually trained.')}
    </p>
    <div className="small" style={{ fontWeight: 600, margin: '12px 0 2px' }}>{t('How penalties work')}</div>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      {t('A flagged workout docks between 1 and 5 levels from your account, depending on how far past the line it is — a small oddity costs little, a blatant one costs more.')}
    </p>
    <div className="small" style={{ fontWeight: 600, margin: '12px 0 2px' }}>{t('If it got one wrong')}</div>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>
      {t('Every penalty can be appealed once, with a short explanation — find yours under the Penalties card above if you have any. An admin then makes the final call; once decided, upheld or overturned, that penalty can’t be appealed again.')}
    </p>
  </div>
}
