import type { MountedSession } from "@opencode/plugin/gui"
import { batch, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { RailLabel } from "./gui"
import { mergeTurns, olderPageStart, promptTurn, type Turn } from "./turns"
import { findTimeline, jumpToTurn, readingTurns, type TimelineElements } from "./timeline"

const capacity = 13
const minimumWidth = 720

export function NavigationRail(props: { session: MountedSession; t: (key: RailLabel) => string }) {
  const id = props.session.id
  const data = () => props.session.server.data
  const labels = () => ({ attachment: props.t("attachment"), emptyPrompt: props.t("emptyPrompt") })
  const [timeline, setTimeline] = createSignal<TimelineElements>()
  const [wide, setWide] = createSignal(false)
  const [indexed, setIndexed] = createSignal<Turn[]>([])
  const [cursor, setCursor] = createSignal<string>()
  const [exhausted, setExhausted] = createSignal(false)
  const [loadState, setLoadState] = createSignal<"idle" | "loading" | "error">("idle")
  const [activeID, setActiveID] = createSignal<string>()
  const [inViewIDs, setInViewIDs] = createSignal(new Set<string>())
  const [pageEndID, setPageEndID] = createSignal<string>()
  const [hoveredID, setHoveredID] = createSignal<string>()
  const [focusedID, setFocusedID] = createSignal<string>()
  const [previewDismissed, setPreviewDismissed] = createSignal(false)
  let railAnchor!: HTMLSpanElement
  let nav: HTMLElement | undefined
  let request: AbortController | undefined

  const pending = createMemo(() => new Set(data().session.input.list(id)))
  const revert = () => data().session.get(id)?.revert?.messageID
  const turns = createMemo(() => mergeTurns(indexed(), data().session.message.list(id), pending(), revert(), labels()))
  const byID = createMemo(() => new Map(turns().map((turn, index) => [turn.id, { turn, index }])))
  const mayHaveOlder = () => !exhausted() && (!!cursor() || data().session.message.more(id))

  const pageEnd = createMemo(() => {
    const list = turns()
    const end = pageEndID()
    const pinned = end ? byID().get(end)?.index : undefined
    if (pinned !== undefined) return Math.min(list.length, Math.max(pinned + 1, capacity))

    const reading = activeID()
    const current = reading ? byID().get(reading)?.index : undefined
    if (current === undefined) return list.length
    return Math.min(list.length, Math.max(capacity, current + 1 + Math.floor(capacity / 2)))
  })
  const pageStart = () => Math.max(0, pageEnd() - capacity)
  const visibleIDs = createMemo(() => turns().slice(pageStart(), pageEnd()).map((turn) => turn.id))
  const waveIndex = createMemo(() => visibleIDs().indexOf(hoveredID() ?? focusedID() ?? ""))
  const tabStop = () => {
    const visible = visibleIDs()
    const focused = focusedID()
    const active = activeID()
    if (focused && visible.includes(focused)) return focused
    return active && visible.includes(active) ? active : visible.at(-1)
  }
  const preview = () => {
    const id = hoveredID() ?? focusedID()
    return id && !previewDismissed() ? byID().get(id)?.turn : undefined
  }

  onMount(() => {
    let frame = 0
    let observer: MutationObserver | undefined
    let resize: ResizeObserver | undefined
    // Only the mounted virtual rows are inspected, at most once per animation frame.
    const update = () => {
      frame = 0
      const host = timeline()
      if (!host || !host.root.isConnected) return
      const fits = host.root.clientWidth >= minimumWidth
      setWide(fits)
      if (fits) {
        const reading = readingTurns(host, byID(), turns().at(-1)?.id)
        batch(() => {
          setActiveID(reading.activeID ?? activeID())
          setInViewIDs(reading.visibleIDs)
        })
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resetPage = () => setPageEndID(undefined)
    const connect = () => {
      frame = 0
      if (!railAnchor.isConnected) return
      const host = findTimeline(railAnchor)
      if (!host) return
      setTimeline(host)
      host.viewport.addEventListener("scroll", schedule, { passive: true })
      host.viewport.addEventListener("wheel", resetPage, { passive: true })
      host.viewport.addEventListener("pointerdown", resetPage, { passive: true })
      resize = new ResizeObserver(schedule)
      resize.observe(host.root)
      resize.observe(host.content)
      observer = new MutationObserver(schedule)
      observer.observe(host.content, { childList: true })
      update()
    }
    frame = requestAnimationFrame(connect)
    onCleanup(() => {
      const host = timeline()
      host?.viewport.removeEventListener("scroll", schedule)
      host?.viewport.removeEventListener("wheel", resetPage)
      host?.viewport.removeEventListener("pointerdown", resetPage)
      observer?.disconnect()
      resize?.disconnect()
      if (frame) cancelAnimationFrame(frame)
      request?.abort()
    })
  })

  function showOlder(firstID: string | undefined) {
    const list = turns()
    const start = olderPageStart(list, firstID, capacity)
    setPageEndID(list[Math.min(start + capacity, list.length) - 1]?.id)
  }

  async function earlier() {
    if (loadState() === "loading") return
    const firstID = visibleIDs()[0]
    if (pageStart() > 0) {
      showOlder(firstID)
      return
    }
    if (!mayHaveOlder()) return

    const controller = new AbortController()
    request = controller
    setLoadState("loading")
    try {
      let next = cursor()
      do {
        const page = await props.session.server.client.message.list(
          { sessionID: id, type: "user", limit: 100, cursor: next },
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) },
        )
        if (controller.signal.aborted) return

        const following = page.cursor.next ?? undefined
        if (following && following === next) throw new Error("History cursor did not advance")
        next = following
        const older = page.data.flatMap((message) =>
          message.type === "user" ? [promptTurn(message, labels())] : [],
        )
        batch(() => {
          setIndexed((seen) => [...new Map([...seen, ...older].map((turn) => [turn.id, turn])).values()])
          setCursor(next)
          setExhausted(!next)
        })
        const hasEarlier = firstID
          ? turns().findIndex((turn) => turn.id === firstID) > 0
          : turns().length > 0
        if (hasEarlier) {
          showOlder(firstID)
          break
        }
      } while (next)
      setLoadState("idle")
    } catch {
      if (!controller.signal.aborted) setLoadState("error")
    } finally {
      if (request === controller) request = undefined
    }
  }

  function later() {
    const list = turns()
    setPageEndID(list[Math.min(pageEnd() + capacity, list.length) - 1]?.id)
  }

  function go(id: string) {
    const host = timeline()
    if (!host || !byID().has(id)) return
    setPreviewDismissed(true)
    jumpToTurn(id, host)
  }

  function moveFocus(event: KeyboardEvent, id: string) {
    if (event.key === "Escape") {
      setPreviewDismissed(true)
      event.stopPropagation()
      return
    }
    const visible = visibleIDs()
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
      nav?.querySelector<HTMLButtonElement>(`[data-turn-id="${CSS.escape(next)}"]`)?.focus()
    }
  }

  const earlierLabel = () => {
    if (loadState() === "loading") return props.t("loading")
    if (loadState() === "error") return props.t("retry")
    return props.t(pageStart() > 0 ? "earlier" : "load")
  }
  const showEarlier = () => pageStart() > 0 || mayHaveOlder()
  const showLater = () => pageEnd() < turns().length

  return (
    <>
      <span ref={railAnchor} class="onr-anchor" aria-hidden="true" />
      <Show when={timeline()} keyed>
        {(host) => (
          <Portal mount={host.root}>
            <Show when={wide() && turns().length >= 7}>
              <nav ref={nav} class="onr" aria-label={props.t("rail")}>
                <Show when={showEarlier()}>
                  <button
                    type="button"
                    class="onr-page onr-page-earlier"
                    aria-label={earlierLabel()}
                    title={earlierLabel()}
                    aria-busy={loadState() === "loading"}
                    aria-disabled={loadState() === "loading"}
                    onClick={() => void earlier()}
                  >
                    <span aria-hidden="true" />
                  </button>
                </Show>
                <For each={visibleIDs()}>
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
                        }}
                        onBlur={() => setFocusedID((current) => (current === id ? undefined : current))}
                      >
                        <span aria-hidden="true" />
                      </button>
                      <Show when={preview()?.id === id ? preview() : undefined} keyed>
                        {(turn) => (
                          <div class="onr-preview" aria-hidden="true">
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
                    </div>
                  )}
                </For>
                <Show when={showLater()}>
                  <button
                    type="button"
                    class="onr-page onr-page-later"
                    aria-label={props.t("later")}
                    title={props.t("later")}
                    onClick={later}
                  >
                    <span aria-hidden="true" />
                  </button>
                </Show>
                <Show when={loadState() !== "idle"}>
                  <span class="onr-sr" role="status">{earlierLabel()}</span>
                </Show>
              </nav>
            </Show>
          </Portal>
        )}
      </Show>
    </>
  )
}
