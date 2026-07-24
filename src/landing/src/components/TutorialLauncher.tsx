import { lazy, Suspense, useEffect, useState } from 'react'
import {
  LEARN_PLAYLIST,
  ELEVATE_PLAYLIST,
  CELEBRATE_PLAYLIST,
  FULL_WALKTHROUGH,
  type TutorialAsset,
} from '../config/tutorials'

/**
 * Loaded on first click, never at page load. Two reasons:
 *  1. Performance -- the modal pulls in the editor's shared VideoControls, which
 *     is the biggest chunk on the site. Most visitors never open it.
 *  2. SSR safety -- VideoControls reads `window.matchMedia` at module scope, so
 *     a static import would crash the static build. Deferring the import keeps
 *     the shared editor file untouched.
 */
const TutorialModal = lazy(() =>
  import('./TutorialModal').then((m) => ({ default: m.TutorialModal }))
)

const PLAYLISTS: Record<string, TutorialAsset[]> = {
  learn: LEARN_PLAYLIST,
  elevate: ELEVATE_PLAYLIST,
  celebrate: CELEBRATE_PLAYLIST,
  full: FULL_WALKTHROUGH,
}

/**
 * Headless island that owns the tutorial modal.
 *
 * The page markup stays static, server-rendered HTML -- fully crawlable, zero
 * hydration cost. Any element on the page with `data-tutorial="learn|elevate|
 * celebrate|full"` opens the matching playlist through one delegated listener.
 * That keeps the interactive surface to this single small component instead of
 * hydrating the whole page just to make three buttons clickable.
 */
export function TutorialLauncher() {
  const [playlist, setPlaylist] = useState<TutorialAsset[] | null>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const trigger = (e.target as HTMLElement | null)?.closest('[data-tutorial]')
      if (!trigger) return
      const key = trigger.getAttribute('data-tutorial')
      if (!key || !PLAYLISTS[key]) return
      e.preventDefault()
      setPlaylist(PLAYLISTS[key])
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // Lock background scroll while the modal is open.
  useEffect(() => {
    if (!playlist) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [playlist])

  if (!playlist) return null
  return (
    <Suspense fallback={null}>
      <TutorialModal items={playlist} onClose={() => setPlaylist(null)} />
    </Suspense>
  )
}
