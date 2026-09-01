import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// Just a WebView over this same app (Nebula-Syst/forvia-mobile) — no separate account, no
// offline copy, the phone just opens a shortcut into the site instead of a browser tab. The
// download itself always comes straight from GitHub Releases, never proxied through this
// app's own backend, so there's nothing here to keep in sync by hand.
const RELEASES_API = 'https://api.github.com/repos/Nebula-Syst/forvia-mobile/releases/latest'
const RELEASES_PAGE = 'https://github.com/Nebula-Syst/forvia-mobile/releases/latest'

export default function SettingsMobileApp() {
  const nav = useNavigate()
  const [release, setRelease] = useState(undefined)   // undefined = loading, null = failed

  useEffect(() => {
    fetch(RELEASES_API).then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setRelease({
        version: d.tag_name,
        url: (d.assets || []).find(a => a.name.endsWith('.apk'))?.browser_download_url || d.html_url,
      }))
      .catch(() => setRelease(null))
  }, [])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Mobile app')}</h1></div>
    </div>

    <div className="card">
      <h2 style={{ margin: '0 0 8px' }}>{t('Android')}</h2>
      <div className="small muted" style={{ marginBottom: 14 }}>
        {t('The same app, wrapped for your home screen — same account, same data, nothing extra to set up. Not on the Play Store, so Android will ask you to allow installs from this source the first time.')}
      </div>
      {release === undefined && <Button disabled>{t('Loading…')}</Button>}
      {release === null && <Button icon="download" onClick={() => window.open(RELEASES_PAGE, '_blank', 'noopener')}>{t('Get it from GitHub')}</Button>}
      {release && (
        <Button variant="primary" icon="download" onClick={() => window.open(release.url, '_blank', 'noopener')}>
          {t('Download {0}', release.version)}
        </Button>
      )}
    </div>

    <div style={{ height: 14 }} />
    <div className="card">
      <h2 style={{ margin: '0 0 8px' }}>{t('iPhone')}</h2>
      <div className="small muted">
        {t('Apple doesn’t allow installing apps outside the App Store, so there’s no iOS download. Open forvia.fit in Safari and add it to your home screen instead — full-screen, its own icon, works the same.')}
      </div>
    </div>
  </div>
}
