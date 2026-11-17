const scrollSelector = '[data-slot="session-timeline-scroll"]'
const viewportSelector = ".scroll-view__viewport"
const rowSelector = "[data-message-id][data-timeline-row]"
const titleSelector = "[data-session-title]"

export interface TimelineElements {
  root: HTMLElement
  viewport: HTMLElement
  content: HTMLElement
}

export function findTimeline(anchor: HTMLElement): TimelineElements | undefined {
  const scroll = anchor.closest<HTMLElement>(scrollSelector)
  const root = scroll?.parentElement
  const viewport = scroll?.querySelector<HTMLElement>(viewportSelector)
  const content = viewport?.querySelector<HTMLElement>("[data-timeline-virtual-content]")
  if (root && viewport && content) return { root, viewport, content }
}

export function readingTurns(
  timeline: TimelineElements,
  known: { has(id: string): boolean },
  latestID: string | undefined,
): { activeID: string | undefined; visibleIDs: Set<string> } {
  const { viewport, content } = timeline
  const atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2

  const top = viewport.getBoundingClientRect().top
  const inset = viewport.querySelector<HTMLElement>(titleSelector)?.offsetHeight ?? 0
  const line = top + inset + 4
  const visibleIDs = new Set<string>()
  let before: { id: string; top: number } | undefined
  let after: { id: string; top: number } | undefined

  for (const row of content.querySelectorAll<HTMLElement>(rowSelector)) {
    const id = row.dataset.messageId
    if (!id || !known.has(id)) continue

    const box = row.getBoundingClientRect()
    if (!box.height) continue
    if (box.bottom > top + inset && box.top < top + viewport.clientHeight) visibleIDs.add(id)
    if (box.top <= line) {
      if (!before || box.top >= before.top) before = { id, top: box.top }
    } else if (box.top < top + viewport.clientHeight && (!after || box.top < after.top)) {
      after = { id, top: box.top }
    }
  }

  return { activeID: atBottom && latestID ? latestID : before?.id ?? after?.id, visibleIDs }
}

export function jumpToTurn(id: string, timeline: TimelineElements): void {
  const hash = "#message-" + id
  if (window.location.hash !== hash) {
    window.location.hash = hash
    return
  }

  // Re-selecting a mounted prompt with an identical hash would otherwise be a browser no-op.
  const { viewport, content } = timeline
  const row = viewport.ownerDocument.getElementById(hash.slice(1))
  if (row && content.contains(row)) {
    const inset = viewport.querySelector<HTMLElement>(titleSelector)?.offsetHeight ?? 0
    const top = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - inset
    viewport.scrollTo({ top: Math.max(0, top), behavior: "instant" })
    return
  }

  // A repeated hash for a virtual row still needs to pass through the router.
  const url = new URL(window.location.href)
  url.hash = ""
  window.history.replaceState(window.history.state, "", url)
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }))
  window.location.hash = hash
}
