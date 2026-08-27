import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, hasData, DEF } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { DEMO } from '../../lib/demo.js'
import { MOBILE, shareExport } from '../../lib/mobile.js'
import { importFromApp, confirmSheet } from '../../sheets.jsx'
import Icon from '../../components/Icon.jsx'
import { Section, Row } from '../../components/ui.jsx'

export default function SettingsData() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { replaceState, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const importAppInput = useRef(null)
  const importBackupInput = useRef(null)

  const doExport = async () => {
    const json = JSON.stringify(S)
    const filename = `forvia-backup-${new Date().toISOString().slice(0, 10)}.json`
    if (MOBILE) {
      try { await shareExport(json, filename) }
      catch (e) { toast(t('Import failed: {0}', e.message || String(e))) }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }

  const onImportBackup = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const rd = new FileReader()
    rd.onload = () => {
      let data
      try { data = JSON.parse(String(rd.result)) } catch (err) { toast(t('Import failed: {0}', err.message)); return }
      confirmSheet({
        title: t('Import backup?'), message: t('This replaces all current data with the backup file.'),
        confirmText: t('Import backup'), danger: true,
        onConfirm: () => { replaceState(Object.assign({}, DEF, data)); toast(t('Backup imported')); nav('/home') },
      })
    }
    rd.onerror = () => toast(t('Import failed: {0}', t('Could not read that file')))
    rd.readAsText(file)
  }

  const onImportApp = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) importFromApp(file)
  }

  const doLoadDemo = () => confirmSheet({
    title: t('Load demo data?'), message: t('This replaces all current data with the example demo history.'),
    confirmText: t('Load demo data'), danger: true,
    onConfirm: async () => { await resetDemo(); toast(t('Demo data loaded')); nav('/home') },
  })

  const doReset = () => confirmSheet({
    title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'),
    confirmText: t('Delete everything'), danger: true,
    onConfirm: () => { replaceState(DEF); toast(t('All data reset')); nav('/home') },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Data')}</h1></div>
    </div>

    <Section title={t('Import from another app')}>
      <Row icon="upload" iconTint="var(--blue)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')} accessory="chevron"
        onClick={() => importAppInput.current?.click()} />
    </Section>

    <Section title={t('Data')} footer={!MOBILE && !user ? t('Guest data stays on this device — export a backup now and then!') : null}>
      <Row icon="download" iconTint="var(--teal)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      {!MOBILE && (
        <Row icon="upload" iconTint="var(--indigo)" title={t('Import backup')} accessory="chevron"
          onClick={() => importBackupInput.current?.click()} />
      )}
      {!DEMO && !MOBILE && !hasData(S) && (
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Load demo data')} accessory="chevron" onClick={doLoadDemo} />
      )}
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger accessory="chevron" onClick={doReset} />
    </Section>

    <input ref={importAppInput} type="file" accept=".csv,.xml" style={{ display: 'none' }} onChange={onImportApp} />
    <input ref={importBackupInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportBackup} />
  </div>
}
