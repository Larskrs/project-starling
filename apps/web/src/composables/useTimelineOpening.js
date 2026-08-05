import { ref, readonly } from 'vue'

/**
 * Tracks the timeline currently being opened, so a loading screen can cover the
 * whole journey into the editor.
 *
 * Module-level state on purpose: the wait spans three things that no single
 * component outlives — the auth check in the router guard, the editor's lazy
 * chunk downloading, and the editor's own timeline fetch. The view that starts
 * the navigation is unmounted long before the one that ends it exists.
 *
 * `name` and `profileImageId` are optional: a click from a list can name the
 * timeline immediately, while a pasted URL only learns it once data arrives.
 */
const opening = ref(null)   // { id, name?, profileImageId? } | null

export function useTimelineOpening() {
  function startOpening(timeline) {
    if (!timeline?.id) return
    // The router raises the screen knowing only the id, often just after a list
    // supplied the name — so re-opening the same timeline keeps what's known.
    const known = opening.value?.id === timeline.id ? opening.value : null
    opening.value = {
      id:             timeline.id,
      name:           timeline.name ?? known?.name ?? '',
      profileImageId: timeline.profileImageId ?? known?.profileImageId ?? null,
    }
  }

  /** Fill in details once they're known, without restarting the screen. */
  function describeOpening(timeline) {
    if (!opening.value || opening.value.id !== timeline?.id) return
    opening.value = { ...opening.value, ...timeline }
  }

  function finishOpening() {
    opening.value = null
  }

  return { opening: readonly(opening), startOpening, describeOpening, finishOpening }
}
