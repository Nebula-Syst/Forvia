import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, Row } from '../../components/ui.jsx'

// Just a WebView over this same app (Nebula-Syst/forvia-mobile) — no separate account, no
// offline copy, the phone just opens a shortcut into the site instead of a browser tab. The
// download itself always comes straight from GitHub Releases, never proxied through this
// app's own backend, so there's nothing here to keep in sync by hand.
const RELEASES_API = 'https://api.github.com/repos/Nebula-Syst/forvia-mobile/releases/latest'
const RELEASES_PAGE = 'https://github.com/Nebula-Syst/forvia-mobile/releases/latest'

export default function SettingsMobileApp() {
  const nav = useNavigate()
  const [release, setRelease] = useState(undefined)   // undefined = loading, null = failed
  const [guideOpen, setGuideOpen] = useState(false)

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
      <Row icon="warnTriangle" iconTint="var(--orange)" title={t('Android will warn you before installing it')}
        subtitle={t('This is normal — read why')} onClick={() => setGuideOpen(o => !o)}>
        <Icon name="chevronDown" className={'lrow-c' + (guideOpen ? ' rot' : '')} />
      </Row>
      {guideOpen && <div className="small" style={{ padding: '2px 2px 4px', lineHeight: 1.55 }}>
        <p style={{ marginTop: 10 }}>
          {t('Android shows this warning for every app that doesn’t come from the Play Store — not just this one. It has nothing to do with what the app actually does; it just means Google hasn’t scanned or has no history for this particular file, because it never went through their store. Self-hosted, open-source apps like this one almost always look like this to Android.')}
        </p>
        <p>
          <b>{t('How to know it’s really this app and nothing else:')}</b><br />
          {t('The download always comes straight from GitHub — github.com/Nebula-Syst/forvia-mobile — a public repository whose full source code (including the exact steps GitHub itself used to build the file) is right there for anyone to read. It never passes through any other server on the way to your phone.')}
        </p>
        <p><b>{t('Installing it, step by step:')}</b></p>
        <ol className="steps-list">
          <li>{t('Tap “Download” above — it opens in your browser.')}</li>
          <li>{t('When it finishes, tap the downloaded file. Android may first ask to allow your browser to install unknown apps — allow it (this is a one-time, per-app permission, not a global setting).')}</li>
          <li>{t('Play Protect may scan the file and show a warning screen. Tap “More details”, then “Install anyway”.')}</li>
          <li>{t('That’s it — it installs like any other app, with its own icon on your home screen.')}</li>
        </ol>
        <p className="muted">
          {t('If any of this makes you uneasy, that instinct is a good one to keep — don’t install APKs from places you don’t trust. The point of all this is so you can check for yourself, not so you take it on faith.')}
        </p>
      </div>}
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
