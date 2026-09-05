import { useNavigate } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Section, Row } from '../../components/ui.jsx'

// Its own top-level Settings tile now (Settings.jsx), same as Mobile app / How it works —
// used to be two rows tucked inside Account, moved out to its own card so it's reachable
// directly rather than nested a level deeper than it needs to be.
export default function SettingsLegal() {
  const nav = useNavigate()
  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Legal')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Terms of service and privacy policy.')}</p>
    <Section title={t('Documents')}>
      <Row icon="clipboard" iconTint="var(--grey)" title={t('Terms of service')} onClick={() => nav('/legal/terms')} />
      <Row icon="clipboard" iconTint="var(--grey)" title={t('Privacy policy')} onClick={() => nav('/legal/privacy')} />
    </Section>
  </div>
}
