import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { aiScanStatus, aiCreditPacks, aiCreditsCheckout } from '../../lib/api.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// "Scan with AI"'s balance + shop — real EUR via Stripe Checkout (never Forvia Coin, see
// api/server.js's AI_CREDIT_PACKS comment for why). Buying redirects to Stripe's own hosted
// page (no card form here at all — that's Stripe's problem, not this app's) and comes back to
// ?checkout=success|cancel on this same route; the webhook usually lands before the redirect
// does, but re-fetching the balance on return covers the rare case it hasn't yet.
export default function SettingsAiCredits() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [params] = useSearchParams()
  const [status, setStatus] = useState(null)
  const [packs, setPacks] = useState(null)
  const [buying, setBuying] = useState(null)

  const refresh = () => aiScanStatus().then(setStatus).catch(() => setStatus(null))
  useEffect(() => { refresh(); aiCreditPacks().then(setPacks).catch(() => setPacks(null)) }, [])

  useEffect(() => {
    const outcome = params.get('checkout')
    if (!outcome) return
    if (outcome === 'success') { toast(t('Credits on their way — may take a moment to post')); setTimeout(refresh, 1500) }
    else if (outcome === 'cancel') toast(t('Purchase cancelled'))
    nav('/settings/ai-credits', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const buy = async packId => {
    if (buying) return
    setBuying(packId)
    try {
      const url = await aiCreditsCheckout(packId)
      window.location.href = url
    } catch (e) {
      toast(t('Could not start checkout — try again'))
      setBuying(null)
    }
  }

  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('AI scan credits')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Each food photo "Scan with AI" analyzes costs 1 credit — real money, never Forvia Coin.')}</p>

    <div className="coin-hero">
      <Icon name="coin" size={32} style={{ color: 'var(--acc)' }} />
      <div className="coin-hero-num">{status?.credits ?? 0}</div>
      <div className="coin-hero-label">{t('Credits left')}</div>
    </div>

    {!packs?.enabled && (
      <div className="empty"><div className="ico"><Icon name="sparkles" /></div>{t('Credit purchases are not configured on this instance yet.')}</div>
    )}

    {packs?.enabled && (
      <div className="coin-shop">
        <div className="coin-shop-label">{t('Buy more')}</div>
        {packs.packs.map(p => (
          <div key={p.id} className="redeem-panel" style={{ cursor: 'default' }}>
            <span className="redeem-txt">
              <span className="redeem-title">{t('{0} credits', p.credits)}</span>
              <span className="redeem-sub">{t('{0} AI scans', p.credits)}</span>
            </span>
            <Button variant="primary" disabled={!!buying} onClick={() => buy(p.id)}>
              {buying === p.id ? t('Loading…') : (p.amountCents / 100).toFixed(2) + ' ' + (p.currency === 'eur' ? '€' : p.currency.toUpperCase())}
            </Button>
          </div>
        ))}
      </div>
    )}
  </div>
}
