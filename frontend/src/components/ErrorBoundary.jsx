import { Component } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

/**
 * Last line of defence: one bad render used to blank the whole app, with no way back —
 * a workout referencing an exercise the build doesn't know would white-screen and, since
 * the running workout is persisted, do it again on every reload.
 *
 * Sits inside #app so the tab bar stays usable; the shell keys this subtree on the route,
 * so switching tabs re-mounts it and clears the error by itself.
 */
export default class ErrorBoundary extends Component {
  state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error) {
    console.error('Forvia render error:', error)
  }

  reloadApp = () => {
    location.reload()
  }

  discardWorkoutAndReload = () => {
    useStore.getState().update(state => { state.active = null })
    location.reload()
  }

  renderCrashScreen() {
    const hasActiveWorkout = !!useStore.getState().S.active
    return (
      <div className="narrow">
        <div className="empty" style={{ marginTop: '18vh' }}>
          <div className="ico"><Icon name="info" /></div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('Something went wrong')}</div>
          {t('This screen could not be drawn. Your data is safe on this device.')}
        </div>
        <Button variant="primary" icon="reset" onClick={this.reloadApp}>
          {t('Reload Forvia')}
        </Button>
        {hasActiveWorkout && <>
          <div style={{ height: 8 }} />
          <Button variant="danger" icon="trash" onClick={this.discardWorkoutAndReload}>
            {t('Discard the running workout')}
          </Button>
        </>}
      </div>
    )
  }

  render() {
    return this.state.crashed ? this.renderCrashScreen() : this.props.children
  }
}
