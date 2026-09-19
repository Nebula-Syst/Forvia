import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Payment isn't wired up yet (Stripe, when it lands) — tapping a paid plan is a toast, not a
// checkout. What each plan unlocks IS real and enforced already, though (perksFor's maxPhotos,
// POST /api/coach/apply, POST /api/prestige server-side; the foods/meals/exercises cap is a
// frontend-only check in sheets.jsx, since those live in the trusted per-user state blob, not a
// create endpoint). Prestige 5/10 already promise a discount "once it exists" (see Rank.jsx's
// perk copy) — that's the same subscription this screen is the first piece of.
const PLANS = [
  { id: 'free', name: 'Free', price: '0€', period: null, current: true,
    features: ['1 photo per workout', 'Up to 5 custom foods, meals & exercises', 'Coaching not included', 'Prestige not included', 'No streak bonus'] },
  { id: 'monthly', name: 'Pro', price: '10€', period: '/mo',
    features: ['More photos per workout, by rank', 'Unlimited custom foods, meals & exercises', 'Apply to become a coach', 'Prestige unlocked', 'Up to ×3 XP from your streak'] },
  { id: 'annual', name: 'Pro', price: '99,99€', period: '/yr', badge: 'Save ~17%', highlight: true,
    features: ['More photos per workout, by rank', 'Unlimited custom foods, meals & exercises', 'Apply to become a coach', 'Prestige unlocked', 'Up to ×3 XP from your streak'] },
]

export default function SettingsSubscription() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)

  const pick = plan => {
    if (plan.current) return
    toast(t('Payments are coming soon — for now you can just see the plans.'))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Subscription')}</h1></div>
    </div>

    <p className="muted small" style={{ margin: '0 2px 16px' }}>{t('What each plan includes — already in effect. Paying to upgrade is coming soon.')}</p>

    {PLANS.map(p => (
      <div key={p.id} className="card" style={{ marginBottom: 12, ...(p.highlight ? { borderColor: 'var(--acc-line)' } : {}) }}>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{t(p.name)}</span>
              {p.current && <span className="tag acc">{t('Current')}</span>}
              {p.badge && <span className="tag" style={{ background: 'var(--acc-soft)', color: 'var(--acc)' }}>{t(p.badge)}</span>}
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--label)' }}>{p.price}</span>
              {p.period && t(p.period)}
            </div>
          </div>
          {!p.current && <Button size="sm" variant={p.highlight ? 'primary' : 'ghost'} onClick={() => pick(p)}>{t('Notify me')}</Button>}
        </div>
        <div style={{ marginTop: 10 }}>
          {p.features.map((f, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'center', marginTop: i ? 6 : 0 }}>
              <Icon name="check" style={{ fontSize: 13, color: 'var(--acc)', flexShrink: 0 }} />
              <span className="muted small">{t(f)}</span>
            </div>
          ))}
        </div>
      </div>
    ))}

    <p className="muted small" style={{ margin: '4px 2px 0' }}>{t('Prestige 5 and 10 already promise a discount on this once it launches — see Level & Prestige.')}</p>
  </div>
}
