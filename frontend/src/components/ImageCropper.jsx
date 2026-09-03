import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Pick which part of an image to keep, and how zoomed in — pan by dragging, zoom with the
// slider (or pinch/wheel). Renders to a fixed-size square canvas on confirm; the caller never
// has to think about source image dimensions, just gets back a data: URL.
const VIEW = 280      // on-screen crop viewport, px — square
const OUTPUT = 480    // exported image size, px — square

export default function ImageCropper({ file, onDone, onCancel, outputType = 'image/jpeg', quality = 0.88 }) {
  const [img, setImg] = useState(null)     // the loaded HTMLImageElement
  const [zoom, setZoom] = useState(1)      // 1..3, multiplies the cover-fit base scale
  const [pos, setPos] = useState({ x: 0, y: 0 })  // drag offset from centered, in view px
  const dragRef = useRef(null)             // { startX, startY, baseX, baseY } while pointer is down

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!img) return <div className="muted small" style={{ textAlign: 'center', padding: '30px 0' }}>{t('Loading…')}</div>

  const baseScale = Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight)
  const scale = baseScale * zoom
  const dispW = img.naturalWidth * scale
  const dispH = img.naturalHeight * scale
  // Clamp so the image can never be dragged to reveal empty space past its own edge.
  const maxX = Math.max(0, (dispW - VIEW) / 2)
  const maxY = Math.max(0, (dispH - VIEW) / 2)
  const cx = Math.min(maxX, Math.max(-maxX, pos.x))
  const cy = Math.min(maxY, Math.max(-maxY, pos.y))

  const onPointerDown = e => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: cx, baseY: cy }
  }
  const onPointerMove = e => {
    if (!dragRef.current) return
    const { startX, startY, baseX, baseY } = dragRef.current
    setPos({ x: baseX + (e.clientX - startX), y: baseY + (e.clientY - startY) })
  }
  const onPointerUp = () => { dragRef.current = null }
  const onWheel = e => { e.preventDefault(); setZoom(z => Math.min(3, Math.max(1, z - e.deltaY * 0.001))) }

  const confirm = () => {
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    // View-space (VIEW×VIEW, image centered+offset by cx/cy at `scale`) -> the source rect
    // in the ORIGINAL image's own pixels that the crop viewport is currently showing.
    const srcX = (dispW / 2 - cx - VIEW / 2) / scale
    const srcY = (dispH / 2 - cy - VIEW / 2) / scale
    const srcSize = VIEW / scale
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT)
    onDone(canvas.toDataURL(outputType, quality))
  }

  return <>
    <h3>{t('Adjust photo')}</h3>
    <div
      style={{
        width: VIEW, height: VIEW, margin: '0 auto 16px', borderRadius: '50%', overflow: 'hidden',
        position: 'relative', touchAction: 'none', cursor: 'grab', background: '#000',
        boxShadow: '0 0 0 2000px rgba(0,0,0,.55)',
      }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <img src={img.src} draggable={false} alt=""
        style={{
          position: 'absolute', left: VIEW / 2 - dispW / 2 + cx, top: VIEW / 2 - dispH / 2 + cy,
          width: dispW, height: dispH, maxWidth: 'none', userSelect: 'none', pointerEvents: 'none',
        }} />
    </div>
    <div className="row" style={{ gap: 10, marginBottom: 18, padding: '0 4px' }}>
      <Icon name="magnifier" style={{ fontSize: 14, color: 'var(--label-3)' }} />
      <input type="range" min="1" max="3" step="0.01" value={zoom} className="grow"
        onChange={e => setZoom(+e.target.value)} />
    </div>
    <div className="row" style={{ gap: 8 }}>
      <Button style={{ flex: 1 }} onClick={onCancel}>{t('Cancel')}</Button>
      <Button variant="primary" style={{ flex: 1 }} onClick={confirm}>{t('Save')}</Button>
    </div>
  </>
}
