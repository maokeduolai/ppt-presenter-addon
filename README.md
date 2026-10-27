# HTML Presenter Addon

为 **Reveal.js** 演示稿添加演讲者控制台与独立投影窗口。插件使用静态 JavaScript 和 CSS，播放时无需 npm、构建或在线服务；可通过 `file://` 双击打开，也可使用 HTTP 服务。

保留当前页、逐页缩略图、分步与黑屏双向同步、时钟、可暂停的计时器、备注字号调整、投影窗口重连。备注语言不限，无需准备备注也能正常放映。

## 快速体验

直接打开 `examples/index.html`，点击右上角 **演讲者模式**。允许弹窗，将新窗口拖到投影屏幕，在投影窗口点击全屏或按 F。当前窗口变为控制台。

- ← / → / 空格：使用 Reveal.js 原有翻页、分步行为。
- B：使用 Reveal.js 原有黑屏行为，双窗口同步。
- 点击缩略图：跳到对应页面，并回到该页第一个分步之前。
- 开始计时、暂停、继续、清零：手动控制；打开控制台不会自动开始。
- 结束演示：关闭投影窗口，恢复普通页面，保留当前页和分步；计时暂停。
- 投影窗口关闭后可重新打开；刷新投影窗口会恢复当前页和分步。

`examples/external-notes.html` 演示显式初始化、英文界面和外部备注。示例所需 Reveal.js 5.1.0 已随仓库附带，无网络请求依赖。

也可以运行 `npm start` 或 `python3 -m http.server 8000 --bind 127.0.0.1`，再访问 <http://127.0.0.1:8000/examples/>。

## 接入已有 Reveal.js 演示稿

复制 `presenter-addon/` 到 PPT 旁边。在原来的 Reveal.js 初始化代码之后加入：

```html
<script>
  // 将你原有的 Reveal 实例暴露出来，不要重复创建演示稿。
  window.deck = myExistingRevealInstance;
</script>
<script src="presenter-addon/presenter.js"></script>
```

插件自动加载同目录的 CSS，并等待 `window.deck.isReady()`（最多约 10 秒）。不需要额外的 `config.js`。配置可写在插件引用之前：

```html
<script>
  window.HTMLPresenterConfig = {
    deckGlobal: 'deck',
    locale: 'zh-CN',
    defaultFontSize: 22,
    hideElements: ['#my-deck-toolbar']
  };
</script>
<script src="presenter-addon/presenter.js"></script>
```

如实例名称不同、使用模块或希望自己管理初始化，使用显式方式：

```html
<script>window.HTMLPresenterConfig = { autoStart: false };</script>
<script src="presenter-addon/presenter.js"></script>
<script>
  myExistingRevealInstance.initialize().then(() => {
    return HTMLPresenter.init(myExistingRevealInstance, { locale: 'en' });
  });
</script>
```

若实例已初始化，直接调用 `HTMLPresenter.init(instance, options)`。此代码必须在投影窗口中也执行；不要仅在主窗口初始化插件。`init()` 返回 Promise，重复调用复用首次初始化，不用于切换实例或更新配置。每个 HTML 文档支持一个 Reveal 实例。

## 备注

### 页面内备注（推荐）

使用 Reveal.js 原生约定，每个实际页面中放置一个 `<aside class="notes">`：

```html
<section id="opening">
  <h2>Opening</h2>
  <aside class="notes">
    <p>任意语言的讲稿。Notes in any language.</p>
    <ul><li>需要强调的要点</li><li>下一步提示</li></ul>
  </aside>
</section>
```

支持段落、强调、列表、引用、代码、标题和普通 HTTP/HTTPS/mailto 链接。只复制基本格式，忽略脚本、事件处理器、自定义样式、交互组件和嵌入内容。原始 Markdown 不会由本插件解析；若使用 Reveal Markdown 插件，应在其处理完成之后初始化演讲者插件。

### 外部备注（可选）

新建数据文件，例如 `my-notes.js`：

```js
window.HTMLPresenterNotes = {
  slides: [
    { id: 'opening', title: 'Opening', text: '第一段。\n\nSecond paragraph.' },
    { id: 'ending', text: 'Thank you.' }
  ]
};
```

设置 `notesFile: 'my-notes.js'`。路径**相对于 PPT HTML 文档**，支持 `../`；通过 `<script>` 加载，兼容离线文件，不使用 `fetch`。请仅引用可信的脚本文件。

也可以直接配置 `notes: [...]` 或 `notes: {slides: [...]}`。数组元素可为字符串或 `{id?, title?, text}` 对象。显式 `notes` 优先于 `notesGlobal` 中的数据。外部内容按纯文本展示，不解析 HTML 或 Markdown。

- 带 `id` 的条目按页面 `<section id="…">` 精确匹配，适合调整顺序或只给部分页面写备注；页面 ID 应唯一。
- 不带 `id` 的条目按 `deck.getSlides()` 顺序对应（包含垂直页面，不含包裹它们的分组）。中间缺项请用 `null` 占位。
- 找到 `text`（包括空字符串）时使用外部内容，否则回退到页面内备注；最后显示“本页暂无备注”。不要求备注条目数等于页数。
- 文件加载失败会提示并回退到页面内备注，不阻断插件。旧版双语数据需要迁移为 `text`，不会继续识别 `english/chinese/stageDirections`。

### 从 Markdown 提取（可选）

工具只识别连续页码标题，不按语言拆分正文，也不提取“时间”“舞台提示”等专用字段。正文作为纯文本保留，Markdown 标记会直接显示。支持标题 `## Slide 1 | Title` 或 `## 第 01 页｜标题`。代码围栏中的相似标题视为正文。

```bash
python3 tools/extract_notes.py --source examples/notes.md --output examples/generated-notes.js
```

然后设置 `notesFile: 'generated-notes.js'`。该工具只写指定输出，不改写源讲稿或 PPT；只需 Python 3 标准库。生成结果按页顺序匹配，增删页面后需要重新生成。若需完整富文本，使用页面内 HTML 备注。

## 配置与 API

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `autoStart` | `true` | 自动等待全局 Reveal 实例；显式初始化时设为 `false` |
| `deckGlobal` | `'deck'` | `window` 上的实例名称；显式传入实例时忽略 |
| `locale` | `'zh-CN'` | `zh*` 使用中文界面，其他有效 locale 使用英文；同时设置时钟格式 |
| `defaultFontSize` | `22` | 首次使用的备注字号，范围 14–40px |
| `hideElements` | `[]` | 演示期间隐藏的宿主元素 CSS 选择器；退出恢复原 hidden 值 |
| `notes` | `null` | 直接传入备注数组或 `{slides:[]}` |
| `notesFile` | `null` | 可选备注 JS 文件，相对于 HTML 文档 |
| `notesGlobal` | `'HTMLPresenterNotes'` | 外部脚本写入的全局变量名称 |

`HTMLPresenter.init(instance, options)` 初始化；`HTMLPresenter.enter()` 进入模式（返回是否打开成功）；`HTMLPresenter.exit()` 结束演示；`HTMLPresenter.active` 读取是否在演讲者模式；`HTMLPresenter.version` 读取版本。初始化完成后才能调用 `enter()`；该调用应在用户点击中同步执行，以符合浏览器弹窗策略。

备注字号按 HTML 路径保存在浏览器中，退出或刷新后保留。浏览器禁用存储时仍可使用。备注、缩略图在初始化/进入控制台时读取，不提供运行中动态编辑 API。

## 兼容范围与限制

- 本版针对 Reveal.js，随附并验证的版本为 **5.1.0**。其他 Reveal 版本需要自行验证；其他 HTML 幻灯片引擎需要另写适配器。引擎操作集中在 `presenter.js` 的 `revealAdapter()`。
- 使用现代桌面浏览器；自动化测试使用 Chromium。其他浏览器与多屏硬件的表现需实际验证。依赖 ResizeObserver、IntersectionObserver、postMessage 等浏览器 API。
- 浏览器需要允许弹窗；投影窗口内点击或按 F 触发全屏。网页无法保证自动选择显示器，浏览器仍可使用 Esc 退出全屏。
- 投影窗口会重新打开同一 HTML；所有页面初始化必须能重复执行。页面不能通过 COOP 等策略切断 `window.opener`，也不能使用禁止弹窗通信的 sandbox。
- 同步页面、分步和 Reveal 黑屏状态；不同窗口的媒体播放进度、交互组件内部状态、计时器和自定义应用状态不在同步范围内。
- 页面在控制台/投影中会移动到新的容器；请把幻灯片样式写在 `.reveal`、页面 class 等稳定选择器下。依赖宿主祖先选择器、运行中绘制的 canvas、脚本驱动组件、背景属性和嵌入媒体，缩略图可能无法完整还原。缩略图采用禁止脚本的静态 iframe，进入可见区域时再加载，展示所有分步内容。
- 插件保留文档原有背景；控制台在进入时复制幻灯片祖先的背景层，避免透明页面露出控制台的深色底。幻灯片自身和 Reveal 的逐页背景仍在这些背景层之上。
- 不会替宿主关闭已有模态对话框，也不重写宿主键盘配置；进入前请关闭宿主对话框。若宿主快捷键会打开对话框，应在自己的处理器中检查 `HTMLPresenter.active`。
- `?print-pdf` 跳过插件；原演讲项目和构建器不需要随本仓库分发。

## 开发与验证

播放不需要安装依赖。仅在开发时运行：

```bash
npm ci
npx playwright install chromium
npm test
npm run test:converter
```

浏览器测试覆盖 HTTP/`file://`、透明页面的实际背景像素、背景叠加与逐页背景、翻页与分步双向同步、垂直页、黑屏、投影刷新重连、计时器、退出恢复、缺失备注与弹窗拦截。Python 测试检查讲稿内容保留、页码校验和代码围栏处理。

目录：`presenter-addon/` 可直接复制；`examples/` 提供离线示例；`tools/` 为可选讲稿工具；`tests/` 和 npm 依赖仅用于开发。发布前可先审阅差异、检查许可证、运行上述测试，再建立 GitHub 仓库并添加 remote。

## 许可证

插件采用 [MIT](LICENSE) 协议。示例附带的 Reveal.js 版权归其作者所有，保留其 [MIT 许可证](examples/vendor/LICENSE-reveal.txt)。
