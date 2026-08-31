import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { ACCENTS } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Section, Row, Switch, Segmented } from '../../components/ui.jsx'

// Hardcoded, not read from CSS vars: a swatch has to show what a theme looks like
// regardless of which one is active right now, so it can't lean on :root[data-theme]
// like the rest of the app does.
const THEMES = [
  { value: 'dark', label: 'Dark', bg: '#000000', card: '#1c1c1e', text: '#ffffff', sub: '#8e8e93' },
  { value: 'light', label: 'Light', bg: '#f2f2f7', card: '#ffffff', text: '#000000', sub: '#8e8e93' },
  { value: 'prestige', label: 'Prestige', bg: '#0d0221', card: '#2a1854', text: '#f5e9ff', sub: '#b79ee0', perk: true },
]

function ThemeSwatch({ theme, selected, locked, accent, onClick }) {
  return (
    <button className={'theme-swatch' + (selected ? ' on' : '') + (locked ? ' locked' : '')}
      style={{ background: theme.bg }} onClick={onClick} aria-label={theme.label}>
      <span className="theme-swatch-card" style={{ background: theme.card }}>
        <span className="theme-swatch-dot" style={{ background: accent }} />
        <span className="theme-swatch-line" style={{ background: theme.text }} />
        <span className="theme-swatch-line short" style={{ background: theme.sub }} />
      </span>
      {locked ? <Icon name="lock" className="theme-swatch-badge" />
        : selected ? <Icon name="check" className="theme-swatch-badge on" /> : null}
      <span className="theme-swatch-label">{t(theme.label)}</span>
    </button>
  )
}

export default function SettingsAppearance() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update } = useStore()
  const toast = useUI(s => s.toast)
  const accentHex = ACCENTS[S.accent] || ACCENTS.lime

  const pickTheme = th => {
    if (th.perk && !user?.perks?.appTheme) { toast(t('Unlocks at Prestige {0}', 8)); return }
    update(s => { s.theme = th.value })
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Appearance')}</h1></div>
    </div>

    {/* Bare, not inside a Section — each swatch is already its own little card, so a
        Section's glass card behind them would just double up. */}
    <h4 className="sec" style={{ marginTop: 0 }}>{t('Theme')}</h4>
    <div className="theme-grid" style={{ marginBottom: 22 }}>
      {THEMES.map(th => (
        <ThemeSwatch key={th.value} theme={th} accent={accentHex}
          selected={S.theme === th.value} locked={th.perk && !user?.perks?.appTheme}
          onClick={() => pickTheme(th)} />
      ))}
    </div>

    <Section title={t('Accent color')}>
      <div className="swatches" style={{ padding: '13px 2px 14px' }}>
        {Object.entries(ACCENTS).map(([k, c]) => (
          <button key={k} className={'swatch' + (S.accent === k ? ' on' : '')}
            style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
        ))}
      </div>
    </Section>

    <Section title={t('Exercise media')}>
      <Row icon="expand" iconTint="var(--teal)" title={t('Size during a workout')}
        subtitle={t('The minimize/expand button on the exercise animation remembers this for next time.')}>
        <Segmented className="seg-inline"
          options={[{ value: 'full', label: t('Full') }, { value: 'mini', label: t('Mini') }]}
          value={S.gifSize === 'mini' ? 'mini' : 'full'} onChange={v => update(s => { s.gifSize = v })} />
      </Row>
    </Section>

    <Section title={t('Motion')}>
      <Row icon="bolt" iconTint="var(--pink)" title={t('Reduce motion')}
        subtitle={t('Turns off the glow, shimmer and gradient effects on rank badges and profile frames.')}>
        <Switch checked={!!S.reduceMotion} onChange={v => update(s => { s.reduceMotion = v })} />
      </Row>
    </Section>
  </div>
}
