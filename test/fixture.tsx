import * as gui from "@opencode/plugin/gui"
import * as solid from "solid-js"
import * as web from "solid-js/web"

const { createSignal, For, onMount, Show } = solid
const user = (number: number, text = `Prompt ${number}`) => ({
  id: `msg_${String(number).padStart(3, "0")}`,
  type: "user",
  time: { created: number },
  text,
})
const reply = {
  id: "msg_005a",
  type: "assistant",
  time: { created: 5.1, completed: 5.2 },
  content: [{ type: "text", text: "A long reply to the fifth prompt." }],
}
const recent = [user(5), reply, user(6), user(7), user(8)]
const older = [user(1), { ...user(2, ""), files: [{ name: "notes.txt" }] }, user(3), user(4)]
const queued = user(9, "Queued prompt")
const [messages, setMessages] = createSignal([...recent, queued])
const [more, setMore] = createSignal(true)
const [active, setActive] = createSignal(true)
const [narrow, setNarrow] = createSignal(false)
const seenCursors: (string | undefined)[] = []

const fixture = {
  seenCursors,
  setActive,
  setNarrow,
  failures: 0,
  aborted: false,
  delayHistory: false,
}
Object.assign(window, { fixture })

const module = { exports: { default: undefined } }
const bundle = await fetch("/dist/gui-experimental.cjs").then((response) => response.text())
const modules: Record<string, unknown> = { "@opencode/plugin/gui": gui, "solid-js": solid, "solid-js/web": web }
const requireShared = (id: string) => {
  if (!modules[id]) throw new Error(`Unexpected external module ${id}`)
  return modules[id]
}
new Function("require", "module", "exports", bundle)(requireShared, module, module.exports)
const plugin = module.exports.default as any
let renderHeader: (input: any) => solid.JSX.Element

plugin.setup({
  t: (key: string) => plugin.i18n.en[key],
  add(registry: unknown, contribution: any) {
    if (registry === gui.Style) {
      const style = document.createElement("style")
      style.textContent = contribution
      document.head.append(style)
    }
    if (registry === gui.Slot) {
      if (contribution.at !== "session.header") throw new Error("Unexpected slot")
      renderHeader = contribution.render
    }
  },
})

const session = {
  id: "ses_fixture",
  pending: false,
  visit: {},
  server: {
    data: {
      session: {
        input: { list: () => [queued.id] },
        get: () => ({}),
        message: { list: messages, more },
      },
    },
    client: {
      message: {
        async list(input: any, { signal }: { signal: AbortSignal }) {
          if (input.sessionID !== "ses_fixture" || input.type !== "user") throw new Error("Unexpected history query")
          seenCursors.push(input.cursor)
          if (fixture.delayHistory) {
            await new Promise<void>((_, reject) => {
              signal.addEventListener("abort", () => {
                fixture.aborted = true
                reject(signal.reason)
              }, { once: true })
            })
          }
          if (fixture.failures > 0) {
            fixture.failures--
            throw new Error("Simulated network failure")
          }
          return input.cursor ? { data: older, cursor: { next: null } } : {
            data: recent.filter((item) => item.type === "user"),
            cursor: { next: "older" },
          }
        },
      },
    },
  },
}

function Timeline() {
  let viewport!: HTMLDivElement
  const reveal = () => {
    const fragment = window.location.hash.slice(1)
    if (!fragment) return
    if (older.some((message) => "message-" + message.id === fragment)) {
      setMessages([...older, ...recent, queued])
      setMore(false)
    }
    const row = document.getElementById(fragment)
    if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 48
  }

  onMount(() => {
    viewport.scrollTop = viewport.scrollHeight
    window.addEventListener("hashchange", reveal)
    window.addEventListener("popstate", reveal)
  })

  return (
    <main class="timeline" style={{ width: narrow() ? "600px" : undefined }}>
      <div data-slot="session-timeline-scroll">
        <div class="scroll-view__viewport" ref={viewport}>
          <header data-session-title>
            {renderHeader({ session, get active() { return active() } })}
          </header>
          <div data-timeline-virtual-content>
            <For each={messages()}>
              {(message) => (
                <Show when={message.id !== queued.id}>
                  <div
                    id={message.type === "user" ? "message-" + message.id : undefined}
                    data-timeline-row={message.type === "user" ? "UserMessage" : "AssistantPart"}
                    data-message-id={message.type === "user" ? message.id : "msg_005"}
                    style={{ height: message.type === "assistant" ? "1050px" : undefined }}
                  >
                    {"text" in message ? message.text : reply.content[0].text}
                  </div>
                </Show>
              )}
            </For>
            <div style={{ height: "420px" }} />
          </div>
        </div>
      </div>
    </main>
  )
}

web.render(() => <Timeline />, document.getElementById("app")!)
