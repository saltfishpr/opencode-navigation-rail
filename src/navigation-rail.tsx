import type { MountedSession } from "@opencode/plugin/gui"
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { RailLabel } from "./gui"
import { mergeTurns, promptTurn, type Turn } from "./turns"
import { findTimeline, jumpToTurn, readingTurns, type TimelineElements } from "./timeline"

const minimumWidth = 720

export function NavigationRail(props: { session: MountedSession; t: (key: RailLabel) => string; path: () => string }) {
  const id = props.session.id
  const data = () => props.session.server.data
  const labels = () => ({ attachment: props.t("attachment"), emptyPrompt: props.t("emptyPrompt") })
  const [timeline, setTimeline] = createSignal<TimelineElements>()
  const [wide, setWide] = createSignal(false)
  const [indexed, setIndexed] = createSignal<Turn[]>([])
  const [loadFailed, setLoadFailed] = createSignal(false)
  const [activeID, setActiveID] = createSignal<string>()
  const [inViewIDs, setInViewIDs] = createSignal(new Set<string>())
  const [hoveredID, setHoveredID] = createSignal<string>()
  const [focusedID, setFocusedID] = createSignal<string>()
  const [previewDismissed, setPreviewDismissed] = createSignal(false)
  const [pointerInside, setPointerInside] = createSignal(false)
  const [focusInside, setFocusInside] = createSignal(false)
  const [bounds, setBounds] = createSignal({ top: 0, height: 0 })
  const [above, setAbove] = createSignal(false)
  const [below, setBelow] = createSignal(false)
  const [previewTop, setPreviewTop] = createSignal<number>()
  let railAnchor!: HTMLSpanElement
  let nav: HTMLElement | undefined
  let scroller: HTMLDivElement | undefined
  let previewCard: HTMLDivElement | undefined
  let request: AbortController | undefined
  let cursor: string | undefined
  let exhausted = false
  let frame = 0

  const pending = createMemo(() => new Set(data().session.input.list(id)))
  const revert = () => data().session.get(id)?.revert?.messageID
  const turns = createMemo(() => mergeTurns(indexed(), data().session.message.list(id), pending(), revert(), labels()))
  const byID = createMemo(() => new Map(turns().map((turn, index) => [turn.id, { turn, index }])))
  const turnIDs = createMemo(() => turns().map((turn) => turn.id))
  const waveIndex = createMemo(() => turnIDs().indexOf(hoveredID() ?? focusedID() ?? ""))
  const tabStop = () => {
    const visible = turnIDs()
    const focused = focusedID()
    const active = activeID()
    if (focused && visible.includes(focused)) return focused
    return active && visible.includes(active) ? active : visible.at(-1)
  }
  const preview = () => {
    const id = hoveredID() ?? focusedID()
    return id && !previewDismissed() ? byID().get(id)?.turn : undefined
  }
  const shown = () => wide() && (turns().length >= 7 || loadFailed())

  function revealMarker(id: string | undefined) {
    const marker = id && scroller?.querySelector<HTMLButtonElement>(`[data-turn-id="${CSS.escape(id)}"]`)
    if (!marker || !scroller) return
    const box = marker.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    if (box.top < view.top) scroller.scrollTop += box.top - view.top
    else if (box.bottom > view.bottom) scroller.scrollTop += box.bottom - view.bottom
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update)
  }

  function update() {
    frame = 0
    const host = timeline()
    if (!host || !host.root.isConnected) return
    const root = host.root.getBoundingClientRect()
    const viewport = host.viewport.getBoundingClientRect()
    const titleHeight = host.viewport.querySelector<HTMLElement>("[data-session-title]")?.offsetHeight ?? 0
    const top = Math.max(root.top, viewport.top + titleHeight, 0) + 24
    const bottom = Math.min(root.bottom, viewport.bottom, window.innerHeight) - 24
    const height = Math.max(0, bottom - top)
    const resized = height !== bounds().height
    const fits = host.root.clientWidth >= minimumWidth && height > 0
    batch(() => {
      setWide(fits)
      setBounds({ top: (top + bottom) / 2 - root.top, height })
      if (fits) {
        const reading = readingTurns(host, byID(), turns().at(-1)?.id)
        setActiveID(reading.activeID ?? activeID())
        setInViewIDs(reading.visibleIDs)
      }
    })
    if (!fits || !nav?.isConnected) return
    if (!pointerInside() && !focusInside()) revealMarker(activeID())
    else if (resized && focusInside()) revealMarker(focusedID())
    setAbove(!!scroller && scroller.scrollTop > 1)
    setBelow(!!scroller && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1)

    const turn = preview()
    const marker = turn && scroller?.querySelector<HTMLButtonElement>(`[data-turn-id="${CSS.escape(turn.id)}"]`)
    const box = marker && marker.getBoundingClientRect()
    const view = scroller?.getBoundingClientRect()
    if (!box || !view || !previewCard?.isConnected || box.bottom <= view.top || box.top >= view.bottom) {
      setPreviewTop(undefined)
      return
    }
    const cardTop = Math.max(top, Math.min(box.top + box.height / 2 - 1, bottom - previewCard.offsetHeight))
    setPreviewTop(cardTop - nav.getBoundingClientRect().top)
  }

  createEffect(() => {
    turnIDs()
    preview()
    pointerInside()
    focusInside()
    loadFailed()
    if (!shown()) {
      setPointerInside(false)
      setFocusInside(false)
      setHoveredID(undefined)
      setFocusedID(undefined)
    }
    schedule()
  })

  onMount(() => {
    let observer: MutationObserver | undefined
    let resize: ResizeObserver | undefined
    const connect = () => {
      frame = 0
      if (!railAnchor.isConnected) return
      const host = findTimeline(railAnchor)
      if (!host) return
      setTimeline(host)
      host.viewport.addEventListener("scroll", schedule, { passive: true })
      window.addEventListener("resize", schedule)
      resize = new ResizeObserver(schedule)
      resize.observe(host.root)
      resize.observe(host.viewport)
      resize.observe(host.content)
      observer = new MutationObserver(schedule)
      observer.observe(host.content, { childList: true })
      update()
    }
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(connect)
    void loadHistory()
    onCleanup(() => {
      const host = timeline()
      host?.viewport.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      observer?.disconnect()
      resize?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      request?.abort()
    })
  })

  async function loadHistory() {
    if (request || exhausted) return
    const controller = new AbortController()
    request = controller
    setLoadFailed(false)
    try {
      let next = cursor
      do {
        // Keep the full prompt index separate from the host's window of heavy transcript messages.
        const page = await props.session.server.client.message.list(
          { sessionID: id, type: "user", limit: 100, cursor: next },
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) },
        )
        if (controller.signal.aborted) return

        const following = page.cursor.next ?? undefined
        if (following && following === next) throw new Error("History cursor did not advance")
        const older = page.data.flatMap((message) =>
          message.type === "user" ? [promptTurn(message, labels())] : [],
        )
        // Prepending history must not move the marker the user is browsing.
        const viewTop = scroller?.getBoundingClientRect().top ?? 0
        const anchor = Array.from(scroller?.querySelectorAll<HTMLButtonElement>("[data-turn-id]") ?? [])
          .find((marker) => marker.getBoundingClientRect().bottom > viewTop)
        const anchorTop = anchor?.getBoundingClientRect().top
        setIndexed((seen) => [...new Map([...seen, ...older].map((turn) => [turn.id, turn])).values()])
        if (scroller && anchor?.isConnected && anchorTop !== undefined) {
          scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop
        }
        cursor = next = following
        exhausted = !next
      } while (next)
    } catch {
      if (!controller.signal.aborted) setLoadFailed(true)
    } finally {
      if (request === controller) request = undefined
    }
  }

  function go(id: string) {
    const host = timeline()
    if (!host || !byID().has(id)) return
    setPreviewDismissed(true)
    void jumpToTurn(id, host, props.path())
  }

  function moveFocus(event: KeyboardEvent, id: string) {
    if (event.key === "Escape") {
      setPreviewDismissed(true)
      event.stopPropagation()
      return
    }
    const visible = turnIDs()
    const index = visible.indexOf(id)
    let next: string | undefined
    if (event.key === "ArrowUp") next = visible[index - 1]
    else if (event.key === "ArrowDown") next = visible[index + 1]
    else if (event.key === "Home") next = visible[0]
    else if (event.key === "End") next = visible.at(-1)
    else return
    event.preventDefault()
    event.stopPropagation()
    if (next) {
      setHoveredID(undefined)
      nav?.querySelector<HTMLButtonElement>(`[data-turn-id="${CSS.escape(next)}"]`)?.focus({ preventScroll: true })
    }
  }

  return (
    <>
      <span ref={railAnchor} class="onr-anchor" aria-hidden="true" />
      <Show when={timeline()} keyed>
        {(host) => (
          <Portal mount={host.root}>
            <Show when={shown()}>
              <nav
                ref={(element) => { nav = element; schedule() }}
                class="onr"
                classList={{ "onr-above": above(), "onr-below": below() }}
                style={{ top: `${bounds().top}px`, "max-height": `${bounds().height}px` }}
                aria-label={props.t("rail")}
                onPointerEnter={() => setPointerInside(true)}
                onPointerLeave={() => { setPointerInside(false); setHoveredID(undefined) }}
                onFocusIn={() => setFocusInside(true)}
                onFocusOut={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusInside(false)
                }}
              >
                <Show when={turns().length >= 7}>
                  <div
                    ref={scroller}
                    class="onr-scroll"
                    onScroll={() => { setHoveredID(undefined); schedule() }}
                    onWheel={(event) => event.stopPropagation()}
                  >
                    <For each={turnIDs()}>
                      {(id, index) => (
                        <div class="onr-item">
                          <button
                            type="button"
                            class="onr-tick"
                            classList={{ "onr-visible": inViewIDs().has(id), "onr-wave-center": waveIndex() === index() }}
                            style={{ "--onr-distance": waveIndex() < 0 ? 4 : Math.abs(index() - waveIndex()) }}
                            data-turn-id={id}
                            tabIndex={tabStop() === id ? 0 : -1}
                            aria-label={byID().get(id)?.turn.prompt}
                            aria-current={activeID() === id ? "location" : undefined}
                            onClick={() => go(id)}
                            onKeyDown={(event) => moveFocus(event, id)}
                            onPointerEnter={() => {
                              setHoveredID(id)
                              setPreviewDismissed(false)
                            }}
                            onPointerLeave={() => setHoveredID((current) => (current === id ? undefined : current))}
                            onFocus={() => {
                              setFocusedID(id)
                              setPreviewDismissed(false)
                              revealMarker(id)
                              schedule()
                            }}
                            onBlur={() => setFocusedID((current) => (current === id ? undefined : current))}
                          >
                            <span aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={preview()} keyed>
                  {(turn) => (
                    <div
                      ref={(element) => { previewCard = element; setPreviewTop(undefined); schedule() }}
                      class="onr-preview"
                      style={{
                        top: `${previewTop() ?? 0}px`,
                        "max-height": `${bounds().height}px`,
                        visibility: previewTop() === undefined ? "hidden" : undefined,
                      }}
                      aria-hidden="true"
                    >
                      <div class="onr-prompt">{turn.prompt}</div>
                      <Show when={turn.reply}>
                        <div class="onr-reply">
                          <span class="onr-reply-label">{props.t("reply")}</span>
                          {turn.reply}
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
                <Show when={loadFailed()}>
                  <button
                    type="button"
                    class="onr-retry"
                    aria-label={props.t("retry")}
                    title={props.t("retry")}
                    onClick={() => void loadHistory()}
                  >
                    {props.t("retryShort")}
                  </button>
                </Show>
              </nav>
            </Show>
          </Portal>
        )}
      </Show>
    </>
  )
}
