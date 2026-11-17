# opencode-navigation-rail

OpenCode Desktop 的对话轮次导航条。对话左侧的每条短线对应一条用户提问。悬停或用键盘聚焦可预览提问和已加载的回复摘要，点击可跳到提问开头。

## 安装

1. 解压项目到一个固定目录。下载包已包含 `dist/gui-experimental.cjs`，可以直接加载。
2. 把项目目录的 `file:` URL 加入全局 `~/.config/opencode/opencode.jsonc` 的 `plugins`。如果已有其他插件，把该 URL 追加到数组中。

   ```jsonc
   {
     "plugins": ["file:///Users/fish/plugins/opencode-navigation-rail"]
   }
   ```

   把示例路径换成自己的绝对路径。Windows 路径示例为 `file:///C:/Users/fish/plugins/opencode-navigation-rail`。
3. 重新打开 OpenCode Desktop，在 **Settings → Extensions → Plugins** 确认插件已启用。打开一个有多轮对话的会话，把正文列展开到至少 720 px。

## 使用

- 较深的短线标出正在阅读的轮次。短线按从旧到新的顺序显示。
- 顶部箭头浏览更早的轮次。需要历史提问时，插件单独分页读取提问摘要，预览期间保留正文的滚动位置。
- 用 Tab 进入导航条，↑ / ↓ 在当前页的短线之间移动，Home / End 跳到当前页的第一条或最后一条。按 Enter 或 Space 跳转，按 Esc 关闭预览。
- 正文列太窄，或会话确认只有一轮时，导航条自动隐藏。

## 开发

需要 Node.js 20.19+ 或 22.12+。从项目目录运行以下命令。

```sh
npm ci
npm run typecheck
npm run build
npm run dev
```

`npm run dev` 监听源码变化并重新构建插件。OpenCode Desktop 会重载本地插件的 GUI。运行浏览器回归测试前，使用 `npx playwright install chromium` 安装 Chromium，再运行 `npm test`。也可以用环境变量 `CHROMIUM_PATH` 指定本机的 Chromium 路径。

## 兼容性

目标版本为 OpenCode Desktop **v2.3.0**。插件使用 `@opencode/plugin/gui`、`./gui-experimental` 和官方 Vite preset 打包。左侧浮层、滚动高亮和消息锚点使用 Desktop v2.3.0 的内部 DOM 与 `#message-<id>` 路由。升级 Desktop 后，可用同一会话验证这三项交互。

[OpenCode GUI 插件规范](https://opencode.ai/docs/build/plugins/gui)
