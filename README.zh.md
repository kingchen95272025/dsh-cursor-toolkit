# dsh-cursor-toolkit

> 把 Cursor 在 `.cursor` 下的三类资产接入 DeepSeek Harness：**规则**（`.cursor/rules/**/*.mdc`）、
> **技能**（`.cursor/skills/*/SKILL.md`）、**MCP**（`.cursor/mcp.json`），并在 Web GUI 提供「Cursor 资产」面板。

[English](README.md)

---

## 结论先行

- **一句话**：装上本插件后，DSH 会读你在 Cursor 里已经写好的规则、技能与 MCP 配置，不必重复维护两份。
- **规则语义完全对齐 Cursor**：`alwaysApply` / `globs` / `description` 三要素决定一条规则何时进入上下文，文件名不参与判断。
- **技能按需加载**：`SKILL.md` 的 `name` + `description` 进一次目录，正文等 Agent 需要时再调 `cursor_skill` 工具取，不把几万字技能全塞进上下文。
- **MCP 真接入**：`.cursor/mcp.json` 里声明的 server 会被解析成 DSH 的 MCP 客户端条目，**默认全部关闭**，打开开关才拉起进程。
- **两处 UI**：左栏导航的「Cursor 规则」行（占满主面板的整页，含规则 / MCP / 技能三个页签）与设置面板里的同名分节。
- **零第三方依赖**：frontmatter 解析、JSONC 解析与 glob 匹配都在插件内自实现，bundle 自洽运行，无构建步骤。

## 规则语义（与 Cursor 一致）

| 类型 | frontmatter | 何时进入 Agent 上下文 |
| --- | --- | --- |
| **Always** | `alwaysApply: true` | 会话开始即注入完整正文 |
| **Auto Attached** | `alwaysApply: false` + `globs: [...]` | 本会话「已触达文件」命中任一 glob 时追加 |
| **Agent Requested** | `alwaysApply: false` + `description` | 只登记进「按需目录」，Agent 判断相关时自行 `read` 该文件 |
| **Manual** | 其余 | 只登记进「按需目录」 |

其他约定：

- **来源与顺序**：用户级目录在前（默认 `~/.dsh/rules/**` 与 `~/.cursor/rules/**`，按 `userRuleDirs` 给定顺序扫描），项目根（由 `.git` 等 marker 判定）到会话 cwd 的各层 `.cursor/rules/**` 在后；项目层内部同名 id 以更具体（更靠后）的一份为准。
  > 用户级规则的 id 形如 `~/<相对 homedir 的路径>`，**目录名包含在 id 内**，因此 `~/.dsh/rules/x.mdc` 与 `~/.cursor/rules/x.mdc` 是两条独立规则、都会注入，**不存在跨目录覆盖**；`userRuleDirs` 只决定扫描顺序。
- **frontmatter 形态**：`globs` 支持 YAML 块列表、行内数组与 Cursor 的逗号分隔字符串；`alwaysApply` 支持布尔与 `"true"`/`"false"`。
- **增量投递**：首次投递完整基线；之后只在「规则集合或其内容发生变化」时投递增量（新增/更新规则正文，或规则退出的移除通知），避免把几百 KB 规则反复塞进历史。
- **预算**：单次注入不超过 `maxBytes`（默认 131072 字节）；超预算的规则被省略，并在注入内容里明确列出省略清单。
- **框边界**：规则正文里的 `</system-reminder>` 会被转义，仓库内容无法突破插件自有的 `<system-reminder>` 框。

## 技能（`.cursor/skills`）

Cursor 的技能是一个目录：

```
.cursor/skills/<skill-name>/
  SKILL.md        # frontmatter: name / description（可选 license）
  notes.md        # 其它附属文件，正文里可以用相对路径引用
  phases/…
```

本插件的处理：

- **只扫含 `SKILL.md` 的子目录**，`name` 缺省时用目录名，`description` 缺省时该技能仍然可见但目录行更短。
- **目录进上下文**：已启用的技能以 `- <name> — <description>` 的形式随规则一起注入同一段 `<system-reminder>`，并告诉模型「匹配到某项时先调 `cursor_skill` 拿全文」。
- **正文按需拉**：Agent 调 `cursor_skill({ name })` 工具时才读盘并返回 `SKILL.md` 的正文（去掉 frontmatter）与附属文件清单。
- **目录有指纹**：技能集合或描述变化时才重新投递，否则不重复占上下文。
- **来源与覆盖**：用户级 `~/.cursor/skills` 在前，项目根到 cwd 的各层 `.cursor/skills` 在后，同名技能以项目级为准。
- 不扫描 `~/.dsh/skills`——那是 DSH 自己的用户技能位，避免同一份技能被注册两次。

## MCP（`.cursor/mcp.json`）

Cursor 的 MCP 配置形如：

```jsonc
{
  // 允许注释与尾逗号，本插件按 JSONC 解析
  "mcpServers": {
    "mysql":     { "command": "npx", "args": ["-y", "mysql-mcp"], "env": { "MYSQL_URL": "…" } },
    "apifox文档": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } },
  },
}
```

- **两种传输**：有 `url` 即 `streamable-http`，否则按 `stdio`（`command` + `args` + `env` + 可选 `cwd`）。
- **默认全部关闭**：开关状态是白名单，只有你在面板里打开的 server 才会真去挂载 `@deepseek-ai/dsh-mcp-client`——避免装完插件就有一堆 `npx`/`uvx` 进程被拉起。
- **名字归一化**：DSH 的 `serverName` 只接受 `[A-Za-z0-9_-]{1,32}`，而 Cursor 允许中文名。插件会把名字归一化成 `cursor_<slug>`（展示仍用原名），重名自动加 `_2`、`_3`。
- **凭据不外泄**：面板只显示 `env`/`headers` 的**键名**，从不返回值；值只在启动子进程时使用。
- **运行态可见**：每条 server 有 `未连接 / 连接中 / 已连接 / 连接失败` 状态标签，失败会带原因。
- 卸载插件或关闭开关时，对应 MCP 客户端会被 `dispose`，子进程一并退出。

## 安装

在 DSH 插件市场搜索「Cursor 规则」安装 bundle；或在命令行从仓库安装：

```sh
dsh plugin add github:kingchen95272025/dsh-cursor-toolkit   # 非默认 profile 加 --profile <名称>
```

本包是标准 bundle：`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入 `dsh-cursor-toolkit` 行；宿主半边是包主入口，`dsh.client` 声明让 Web 端加载 `./client` 作为浏览器半边。无构建、无安装脚本。

> 从旧版手工安装迁移：先删掉 profile `cordis.patch.yml` 里手写的 `cursor-rules` 行，以及 `<profileDir>/node_modules/` 下的旧拷贝，否则规则会被注册两次。

## 配置

行内 `config`（每个键都可省略）：

```yaml
- insert:
    - id: dsh-cursor-toolkit
      name: dsh-cursor-toolkit
      config:
        enabled: true            # 总开关；false 时宿主半边完全不注册
        includeUserRules: true   # 是否加载用户级目录（规则与技能共用）
        userRuleDirs:            # 用户级规则目录（按扫描顺序）
          - ~/.dsh/rules         # DSH 自有全局规则位
          - ~/.cursor/rules      # Cursor 兼容位
        maxBytes: 131072         # 单次注入的字节预算
        trackTouches: true       # 是否按「已触达文件」自动附加 globs 规则
        projectRootMarkers:      # 项目根标记
          - .git
        httpPath: /cursor-toolkit  # 面板使用的 HTTP 前缀路由
        stateFile: cursor-toolkit.json  # 开关状态文件名，落在 $DSH_HOME 下
        enableSkills: true       # 是否扫描 .cursor/skills
        userSkillDirs:           # 用户级技能目录
          - ~/.cursor/skills
        skillCatalogBytes: 8192  # 技能目录的字节预算
        enableMcp: true          # 是否解析并允许挂载 .cursor/mcp.json 里的 server
        userMcpFiles:            # 用户级 MCP 配置
          - ~/.cursor/mcp.json
        mcpStartupTimeoutMs: 30000   # 单个 MCP server 的启动超时
```

> `config` 在 DSH 的 patch 语义里是**整体替换**而非深合并：覆写这一行时必须把要保留的键一并写出。

开关状态持久化在 `$DSH_HOME/cursor-toolkit.json`（v2）：

```json
{
  "version": 2,
  "disabled": [".cursor/rules/global.mdc"],
  "skillsDisabled": ["skill:project:prd-skill"],
  "mcpEnabled": ["mcp:project:mysql"]
}
```

`mcpEnabled` 是白名单：空数组表示一个 MCP server 都不连。旧版（v1，只有 `disabled`）的状态文件可直接读取；新文件还没生成时会回落到旧名 `$DSH_HOME/cursor-rules.json`，改名后开关不会丢。

## 使用

### 1. 自动遵守规则与技能目录（宿主半边）

无需任何手动操作。首个请求会把生效规则与技能目录作为一条 `<system-reminder>` 用户消息折进上下文，例如：

```markdown
<system-reminder>
The following Cursor rules (.cursor/rules) may be relevant to your work. Use them as guidance when applicable.
More specific rules take precedence over broader ones. They do not override system, developer, or direct user instructions.

Cursor rule: .cursor/rules/global.mdc (alwaysApply)

<规则正文>

The following Cursor rules are available on demand. Read the rule file when the task touches its area:

- .cursor/rules/consumer-conventions.mdc (auto: app/Domain/**/Console/Consumers/**/*.php)
- .cursor/rules/import-conventions.mdc (agent-requested) — 导入层规范…

The following Cursor skills (.cursor/skills) are available. When a task matches a skill description, call the cursor_skill tool with that skill name before starting the work.

- prd-skill — 写 PRD 时使用
- ui-skill — 设计界面时使用
</system-reminder>
```

当 Agent 通过 `read` / `write` / `edit` 触达到某个文件时，命中该文件 glob 的 Auto Attached 规则会在**下一步**以增量形式追加进来；规则退出时投递移除通知。技能目录只在集合或描述变化时重新投递。

### 2. 面板（浏览器半边）

- **左栏导航 → Cursor 规则**：`sidebar.panellist` 的行（同一 id 寻址 `main` 座位的整页），顶部三个页签：**规则 / MCP / 技能**。
- **规则页签**：类型标签、globs、描述与开关；点「查看」在该行下方就地展开完整正文（渲染 Markdown，再点「收起」收回）。
- **MCP 页签**：传输方式、命令/URL 概要、`env`/`header` 键名、运行态状态标签与开关。
- **技能页签**：`description`、路径、附属文件、体积与开关；「查看」同样就地展开 `SKILL.md` 正文。
- **设置面板 → Cursor 规则**：规则列表以分节形式复用（与左栏整页同一份实现）。
- 关闭某条资产后，它不再进入注入集合（规则与技能）或不再被挂载（MCP）。

## 验证

```sh
npm test            # 规则数据层 70 项断言 + 宿主接线 + 浏览器接线
npm run test:rules  # 只跑数据层：frontmatter、glob、发现、选择、注入计划、JSONC、MCP、技能目录、开关
npm run test:host   # 只跑宿主接线：路由、cursor_skill 工具、状态文件、MCP 挂载、注入时序
npm run test:client # 只跑浏览器接线：slot 注册、三个页签、渲染、展开、开关回调
```

测试自己在系统临时目录里搭 `.cursor` fixture（规则 / 技能 / MCP 各一组），因此在任何机器上都能跑通，不依赖真实仓库。

宿主半边（对着运行中的 profile）：

```sh
curl -s "http://127.0.0.1:<端口>/cursor-toolkit/rules?sessionId=<sessionId>" | head -c 400   # 规则
curl -s "http://127.0.0.1:<端口>/cursor-toolkit/mcp?sessionId=<sessionId>" | head -c 400     # MCP
curl -s "http://127.0.0.1:<端口>/cursor-toolkit/skill?id=skill:project:prd-skill" | head -c 400
```

返回 JSON 即挂载成功，`version` 字段是插件代码版本——**用它判断当前进程跑的是哪一版代码**。2.0.0 上这些路由返回 `200`。

`dsh web` 启动时会打印 URL（默认端口 19387），桌面版应用用的是另一个端口。

浏览器半边：桌面版 GUI 的页面源是自定义协议 `dsh-app://app`，`curl http://127.0.0.1:<端口>/` 只会返回
`401 dsh web authentication required`，**不能用 curl 判断浏览器半边是否加载**。可在「设置 → 插件管理」里
直接看这两处座位，或用平台暴露的实况槽位树（`cordis_inspect_query`，`provider: "Slots"`、`method: "listSubTree"`）核对：

```
input={"root": "settings.section"}   # 期望 {"id":"cursor-toolkit","order":30,"active":true}
input={"root": "sidebar.panellist"}   # 期望 {"id":"cursor-toolkit","order":30,"active":true}
input={"root": "main"}                # 期望注册了 "cursor-toolkit" 这个 key
```

路由注册用 `ctx.inject(['webServer'], …)` 而不是一次性 `ctx.get('webServer')`：冷启动时 `apply` 可能早于
`webServer` 就绪，一次性写法会静默跳过注册，表现为重启后 404。改动这段代码时请保留该写法。

## 实现结构

| 文件 | 职责 |
| --- | --- |
| `lib/rules.js` | 资产引擎（纯逻辑、零依赖）：frontmatter 解析、JSONC 解析、glob 编译与匹配、规则/技能/MCP 发现、四类规则选择、增量注入计划、技能目录计划 |
| `lib/index.js` | 宿主半边（Cordis 插件）：`agent/pre-step` 合并注入、`cursor_skill` 工具、MCP 客户端的挂载/卸载与状态、`tools/result` 与 `fs/observed` 触达采集、`ctx.webServer` 上的面板 JSON 接口、开关状态持久化 |
| `lib/client.js` | 浏览器半边（手写、无构建）：`window.__ModuleLoader__.load({ id, factory })`，注册 `sidebar.panellist` 行、配套的 `main` 整页（三页签）与 `settings.section` 分节 |
| `cordis.patch.yml` | bundle patch：插入 `dsh-cursor-toolkit` 行 |
| `locale/{en,zh}.json` | Plugin Manager 的标题、描述与详情文档 |
| `test/smoke.mjs` | 自带 fixture 的可移植冒烟测试（70 项断言） |
| `test/host.mjs` | 宿主接线测试：把平台包换成桩，再驱动 `apply()`，验证路由 / `cursor_skill` / 开关 / MCP 挂载 / 注入时序 |
| `test/client.mjs` | 浏览器接线测试：用极小 React 替身真渲染组件树，验证 slot 注册 / 三页签 / 展开 / 开关回调与词条、样式类一致性 |

### 宿主侧注入时序

```
agent/pre-step (waterfall)
   └─ next() 拿到本轮 entering 批次 decision
      ├─ collectRules(cwd)                # 用户级 + 项目级 .mdc 发现与解析
      ├─ selectRules(rules, touched)      # Always / Auto Attached / 按需目录
      ├─ planInjection(previous)          # 与上次投递状态做差 → 增量
      ├─ collectSkills(cwd) + planSkillCatalog(previous.skillDigest)
      └─ 把两段文本合成一条 createUserMessage(...) 插到最后一条「被认领消息」之后

cwd 变化 / 开关切到 MCP
   └─ scheduleMcp(cwd) 串行执行 → ctx.plugin(McpClient, config) 多退少补
```

`source` 使用插件自有的 `kind: 'cursor-toolkit'`，并携带 `entries`（全量 id+指纹）、`catalogDigest`、`skillDigest`，因此：

- **会话恢复**时可从历史消息重建「已投递状态」，不会重复注入；
- **压缩（compaction）**后历史里不再有本插件消息时，会重新投递完整基线；
- 同一轮内 `pre-step` 重复执行时，内存态兜底抑制重复投递。

## 已知取舍

- **触达来源**是 `read`/`write`/`edit` 的 `file_path` 与 `fs/observed` 的 `displayPath`，不解析任意 shell 命令的副作用——和 `dsh-agent-instructions` 的取舍一致。
- **Auto Attached 依赖「已触达」而非「将要修改」**：Cursor 也会参考你在对话里 @ 的文件，本插件只用文件系统触达信号，因此附加时机略保守（下一步而非同一步）。
- **技能正文不预载**：只投 name + description。技能正文头部若有强制约束，Agent 必须先调 `cursor_skill` 才能看到——这是为了让长技能不常驻上下文而做的交换。
- **MCP 默认不连**：装完插件不会自动拉起任何子进程；面板里逐个打开才会挂载。MCP 的凭据值读取自 `.cursor/mcp.json` 的明文（与 Cursor 相同），插件不在日志或接口里输出它们。
- **MCP 名字归一化**：`serverName` 只能 ASCII，因此中文名在 DSH 侧表现为 `cursor_<slug>`；若两个不同原名归一化后撞车，会自动加序号，面板仍显示原名。
- **面板接口无鉴权**：桌面版 web shell 本身要求 `dsh web` token（`GET /` 返回 401），但本插件注册的是 `webServer` 的**命名前缀路由**，会在 token 闸门之前命中，因此该接口对本机任何进程开放。暴露面已压到最小——接口只读 `.cursor` 下的规则/技能/MCP 配置，不接受任意路径读取，且不返回凭据值；`webServer` 默认仅绑定 `127.0.0.1`。如需彻底关闭，把 `config.enabled` 设为 `false` 或卸载插件。
- **插件模块不热重载**：`dsh-base` 给 `hmr` 的配置是 `root: []`，即 profile 只监听 `cordis.patch.yml` / `package.json`，不监听插件模块；默认 `ignored` 又含 `**/node_modules`。因此改 **patch/config** 会自动热挂载，改 **`lib/*.js`** 必须重启 DSH（Node 的 ESM 模块缓存会让「重挂载」复用旧模块实例）。判断依据就是响应里的 `version` 字段。

## 参考实现

- `@deepseek-ai/dsh-agent-instructions` —— 同为工作区指令注入器，本插件沿用其「source 自有 + 正文逐字 + 框标签转义 + 增量投递」约定。
- `@deepseek-ai/dsh-mcp-client` / `@deepseek-ai/dsh-mcp-manager` —— MCP 客户端的配置形态与「挂载 → 订阅状态 → dispose」生命周期照抄其实现。
- `@deepseek-ai/dsh-client-ui-skill` / `@deepseek-ai/dsh-client-ui-cordis` —— 客户端半边手写 bundle、`ctx.slots.inject` 座位注册与侧边栏入口的范例。

## 许可

MIT
