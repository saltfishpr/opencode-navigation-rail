import { Plugin, Slot, Style } from "@opencode/plugin/gui"
import { Show } from "solid-js"
import { NavigationRail } from "./navigation-rail"
import css from "./navigation-rail.css?inline"

const en = {
  rail: "Conversation turns",
  earlier: "Earlier turns",
  later: "Later turns",
  load: "Load earlier turns",
  loading: "Loading earlier turns…",
  retry: "Could not load earlier turns. Try again",
  attachment: "Attachment",
  emptyPrompt: "User message",
  reply: "Reply",
}

const zh = {
  rail: "对话轮次",
  earlier: "更早的轮次",
  later: "更新的轮次",
  load: "加载更早的轮次",
  loading: "正在加载更早的轮次…",
  retry: "加载历史失败，点击重试",
  attachment: "附件",
  emptyPrompt: "用户消息",
  reply: "回复",
}

export type RailLabel = keyof typeof en

export default Plugin.define({
  i18n: { en, zh },
  setup(ctx) {
    ctx.add(Style, css)
    ctx.add(Slot, {
      at: "session.header",
      render: (input) => (
        <Show when={input.active && !input.session.pending && input.session.visit} keyed>
          <NavigationRail session={input.session} t={(key) => ctx.t(key)} />
        </Show>
      ),
    })
  },
})
