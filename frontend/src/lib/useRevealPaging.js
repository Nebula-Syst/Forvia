import { useState, useEffect, useRef } from 'react'

export const PAGE_SIZE = 5
export const REVEAL_DELAY_MS = 500

// Reveal N-at-a-time instead of mounting an entire fetched list at once — a box roster, a
// social feed, a search result list all fetch everything in one call (cheap on its own), but
// mounting every row/card together is the actual slow part once a list runs long (a box with
// 200 members meant 200 avatars/rows all mounting — and 200 avatar images all fetching — on
// the very first paint). `resetKey` is caller-controlled rather than `items` itself, since a
// filtered array can get a new identity on every unrelated re-render (e.g. toggling a follow
// state) — tying the reset to that would snap an open list back to `pageSize` rows just from
// an unrelated tap.
export function useRevealPaging(items, resetKey, pageSize = PAGE_SIZE) {
  const [shown, setShown] = useState(pageSize)
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => { setShown(pageSize) }, [resetKey])
  const sentinelElRef = useRef(null)
  const liveRef = useRef({ items, shown, loadingMore })
  liveRef.current = { items, shown, loadingMore }
  useEffect(() => {
    const node = sentinelElRef.current
    if (!node) return
    const io = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      const { items, shown, loadingMore } = liveRef.current
      if (loadingMore || !items || shown >= items.length) return
      setLoadingMore(true)
      setTimeout(() => { setShown(s => Math.min(items.length, s + pageSize)); setLoadingMore(false) }, REVEAL_DELAY_MS)
    }, { rootMargin: '200px' })
    io.observe(node)
    return () => io.disconnect()
  }, [items === null || !items, shown, loadingMore])
  return { shown, loadingMore, hasMore: !!items && shown < items.length, sentinelElRef }
}
