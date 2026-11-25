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
  let scroll = anchor.closest<HTMLElement>(scrollSelector)
  let scope = anchor.parentElement
  // Since Desktop 2.4.1, the header is a sibling of the scroll container.
  while (!scroll && scope) {
    scroll = scope.querySelector<HTMLElement>(scrollSelector)
    scope = scope.parentElement
  }
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
  const { root, viewport, content } = timeline
  const atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2

  const top = viewport.getBoundingClientRect().top
  const inset = root.querySelector<HTMLElement>(titleSelector)?.offsetHeight ?? 0
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

export async function jumpToTurn(id: string, timeline: TimelineElements, path: string): Promise<void> {
  const hash = "#message-" + id
  const { root, viewport, content } = timeline
  const document = root.ownerDocument
  function navigate(hash: string) {
    // Desktop's MemoryRouter intercepts route links, not changes to window.location.
    const link = document.createElement("a")
    link.href = path + hash
    link.hidden = true
    link.setAttribute("link", "")
    link.setAttribute("replace", "")
    link.setAttribute("noscroll", "")
    root.append(link)
    try {
      link.click()
    } finally {
      link.remove()
    }
  }

  const row = document.getElementById(hash.slice(1))
  if (row && content.contains(row)) {
    navigate(hash)
    // The router ignores an identical target, so mounted prompts also scroll directly.
    const inset = root.querySelector<HTMLElement>(titleSelector)?.offsetHeight ?? 0
    const top = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - inset
    viewport.scrollTo({ top: Math.max(0, top), behavior: "instant" })
    return
  }

  // Re-arm even an identical virtual target. Let the router apply the clear before the target,
  // within the same frame so the host's scheduled scroll-to-end is superseded by the seek.
  navigate("")
  await Promise.resolve()
  if (root.isConnected) navigate(hash)
}
