import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { ACCENTS } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Section, Row, Segmented } from '../../components/ui.jsx'

export default function SettingsAppearance() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update } = useStore()
  const toast = useUI(s => s.toast)

  const themeOptions = [
    { value: 'dark', label: t('Dark') },
    { value: 'light', label: t('Light') },
    {
      value: 'prestige', label: t('Prestige'),
      disabled: !user?.perks?.appTheme,
      onDisabledClick: () => toast(t('Unlocks at Prestige {0}', 8)),
    },
  ]

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Appearance')}</h1></div>
    </div>

    <Section>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented options={themeOptions} value={S.theme} onChange={v => update(s => { s.theme = v })} />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + (S.accent === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>
  </div>
}
