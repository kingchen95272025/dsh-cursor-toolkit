/**
 * DSH 插件：Cursor 工具包（浏览器半边）
 *
 * 提供两处 UI：
 * 1. `sidebar.panellist` + `main` —— 左栏导航的「Cursor 工具包」行，点开占满主面板的整页；
 * 2. `settings.section`          —— 设置面板里的「Cursor 工具包」分节（复用同一个面板组件）。
 *
 * 数据全部来自宿主半边的 `/cursor-toolkit` 只读 JSON 接口（规则发现与解析都在宿主侧，
 * 浏览器不重复实现一套 mdc 解析）。
 *
 * 本文件是**手写**的客户端包（无构建步骤）：宿主按 `dsh.client` 声明把 `lib/client.js`
 * 原样投递给浏览器，因此这里直接使用 `window.__ModuleLoader__.load({ id, factory })`
 * 约定，并且只 `require` 平台内置模块（react / react-jsx-runtime / UI primitives）。
 *
 * @module dsh-cursor-toolkit/client
 */

window.__ModuleLoader__.load({
	id: "dsh-cursor-toolkit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { jsx, jsxs } = require("react/jsx-runtime");

		const {
			Button,
			MarkdownText,
			Switch,
			Tooltip,
			IconChecklistOutlineRegular,
			IconRefreshOutlineRegular,
		} = primitives;

		/** i18n 命名空间。 */
		const NS = "cursor-toolkit";
		/** 宿主半边注册的 HTTP 路由前缀，与 `Config.httpPath` 默认值一致。 */
		const ENDPOINT = "/cursor-toolkit";
		/** 左栏导航行、主面板 key、设置分节共用的稳定 id（三处必须一致）。 */
		const PANEL_ID = "cursor-toolkit";
		/** 客户端依赖：slot 注册 / i18n / 活动会话（用于取 cwd）。 */
		const inject = ["slots", "locale", "sessions"];

		const zh = {
			nav: "Cursor 工具包",
			title: "Cursor 工具包",
			subtitle: "把 .cursor 下的规则、技能与 MCP server 接进 Agent 上下文。",
			scopeUser: "用户级",
			scopeProject: "项目级",
			typeAlways: "始终生效",
			typeAuto: "自动附加",
			typeAgent: "按需获取",
			typeManual: "手动",
			enabled: "已启用",
			disabled: "已关闭",
			refresh: "刷新",
			loading: "正在读取规则…",
			empty: "没有发现 .cursor/rules/**/*.mdc 规则文件。",
			failed: "读取规则失败",
			retry: "重试",
			noSession: "当前没有打开的工作区，显示的是宿主进程目录下的规则。",
			pillAll: "共 {total} 条",
			pillOn: "生效 {enabled} 条",
			pillOff: "关闭 {off} 条",
			emptyHint: "在仓库里放 .cursor/rules/*.mdc，用 frontmatter 的 alwaysApply / globs / description 决定它何时进入上下文。",
			open: "查看",
			collapse: "收起",
			globs: "globs",
			bytes: "字节",
			statePath: "开关状态",
			toggleFailed: "切换失败",
			bodyFailed: "读取规则正文失败",
			omitted: "超出预算被省略",
			titleAssets: "Cursor 工具包",
			subtitleAssets: "把 .cursor 目录下的规则、技能与 MCP server 接进 DSH：规则与技能目录进上下文，MCP 打开开关后才接入。",
			tabRules: "规则",
			tabMcp: "MCP",
			tabSkills: "技能",
			pillMcpOn: "已连接 {on} 个",
			pillMcpOff: "关闭 {off} 个",
			pillSkillOn: "启用 {on} 个",
			skillFiles: "附属文件",
			mcpCommand: "命令",
			mcpEnv: "环境变量",
			mcpHeaders: "请求头",
			mcpStatusIdle: "未连接",
			mcpStatusConnecting: "连接中",
			mcpStatusReady: "已连接",
			mcpStatusFailed: "连接失败",
			mcpStatusDisabled: "已关闭",
			mcpProblemCommand: "缺少 command",
			mcpProblemUrl: "缺少 url",
			emptyMcp: "没有发现 .cursor/mcp.json 配置。",
			emptyMcpHint: "在仓库根或 ~/.cursor/mcp.json 里声明 mcpServers，打开开关即可接入为 MCP 客户端。",
			emptySkills: "没有发现 .cursor/skills/*/SKILL.md。",
			emptySkillsHint: "把技能放到 .cursor/skills/<name>/SKILL.md，它的 name 与 description 会随规则一起进上下文。",
			skillBodyFailed: "读取技能正文失败",
			mcpDisabledFeature: "MCP 接入已在插件配置里关闭（enableMcp: false）。",
			skillsDisabledFeature: "技能目录注入已在插件配置里关闭（enableSkills: false）。",
		};
		const en = {
			nav: "Cursor toolkit",
			title: "Cursor toolkit",
			subtitle: "Bring the rules, skills and MCP servers under .cursor into the agent context.",
			scopeUser: "User",
			scopeProject: "Project",
			typeAlways: "Always",
			typeAuto: "Auto attached",
			typeAgent: "Agent requested",
			typeManual: "Manual",
			enabled: "Enabled",
			disabled: "Disabled",
			refresh: "Refresh",
			loading: "Loading rules…",
			empty: "No .cursor/rules/**/*.mdc rule files were found.",
			failed: "Failed to load rules",
			retry: "Retry",
			noSession: "No workspace is open; showing rules under the host process directory.",
			pillAll: "{total} rules",
			pillOn: "{enabled} active",
			pillOff: "{off} off",
			emptyHint: "Add .cursor/rules/*.mdc files; the frontmatter alwaysApply / globs / description decides when each rule enters the context.",
			open: "View",
			collapse: "Collapse",
			globs: "globs",
			bytes: "bytes",
			statePath: "Toggle state",
			toggleFailed: "Toggle failed",
			bodyFailed: "Failed to load the rule body",
			omitted: "omitted by budget",
			titleAssets: "Cursor toolkit",
			subtitleAssets: "Bring the rules, skills and MCP servers under .cursor into DSH: rules and the skill catalog enter the context; an MCP server connects only after you switch it on.",
			tabRules: "Rules",
			tabMcp: "MCP",
			tabSkills: "Skills",
			pillMcpOn: "{on} connected",
			pillMcpOff: "{off} off",
			pillSkillOn: "{on} active",
			skillFiles: "Files",
			mcpCommand: "Command",
			mcpEnv: "Env",
			mcpHeaders: "Headers",
			mcpStatusIdle: "Not connected",
			mcpStatusConnecting: "Connecting",
			mcpStatusReady: "Connected",
			mcpStatusFailed: "Failed",
			mcpStatusDisabled: "Off",
			mcpProblemCommand: "missing command",
			mcpProblemUrl: "missing url",
			emptyMcp: "No .cursor/mcp.json config was found.",
			emptyMcpHint: "Declare mcpServers in the repo root or ~/.cursor/mcp.json, then switch a server on to connect it as an MCP client.",
			emptySkills: "No .cursor/skills/*/SKILL.md was found.",
			emptySkillsHint: "Put a skill at .cursor/skills/<name>/SKILL.md; its name and description join the context together with the rules.",
			skillBodyFailed: "Failed to load the skill body",
			mcpDisabledFeature: "MCP is disabled in the plugin config (enableMcp: false).",
			skillsDisabledFeature: "Skill catalog injection is disabled in the plugin config (enableSkills: false).",
		};

		/**
		 * 把 `{placeholder}` 形式的模板替换成实际值。
		 * @param template - 模板文本。
		 * @param values - 占位符取值。
		 * @returns 替换后的文本。
		 */
		function format(template, values) {
			return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
		}

		/**
		 * 选取主视图正在展示的会话 id。
		 *
		 * 与 `dsh-client-ui-cordis` 的 CordisPanel 同一取法，保证设置面板与侧边栏按钮
		 * 指向同一个工作区会话。
		 *
		 * @param state - sessions store 快照。
		 * @returns 会话 id；没有时返回 undefined。
		 */
		function currentSessionIdOf(state) {
			for (const row of Object.values(state?.byId ?? {})) {
				if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id;
			}
			return undefined;
		}

		/**
		 * 解析规则接口地址。
		 *
		 * 额外的查询参数（例如 `id`）必须一起交给 `URLSearchParams`：
		 * 没有会话时 `sessionId` / `cwd` 都缺省，URL 里就没有 `?`，
		 * 手写 `&id=` 会拼出 `/cursor-toolkit/rule&id=…` 这种坏路径。
		 *
		 * @param path - 子路径，例如 `rules`。
		 * @param sessionId - 会话 id。
		 * @param cwd - 会话工作目录。
		 * @param extra - 额外查询参数。
		 * @returns 完整请求 URL。
		 */
		function endpointUrl(path, sessionId, cwd, extra) {
			const search = new URLSearchParams();
			if (sessionId !== undefined) search.set("sessionId", sessionId);
			if (cwd !== undefined) search.set("cwd", cwd);
			for (const [key, value] of Object.entries(extra ?? {})) {
				if (value !== undefined) search.set(key, String(value));
			}
			const query = search.toString();
			return `${ENDPOINT}/${path}${query.length > 0 ? `?${query}` : ""}`;
		}

		/**
		 * 读取规则快照。
		 * @param sessionId - 会话 id。
		 * @param cwd - 会话工作目录。
		 * @param signal - 中止信号。
		 * @returns 宿主返回的快照。
		 */
		async function fetchSnapshot(sessionId, cwd, signal) {
			const response = await fetch(endpointUrl("rules", sessionId, cwd), { signal });
			if (!response.ok) throw new Error(`cursor-toolkit: HTTP ${String(response.status)}`);
			return response.json();
		}

		/**
		 * 读取单条规则正文。
		 * @param id - 规则 id（展示用相对路径）。
		 * @param sessionId - 会话 id。
		 * @param cwd - 会话工作目录。
		 * @param signal - 中止信号。
		 * @returns 规则对象（含 body）。
		 */
		async function fetchRule(id, sessionId, cwd, signal) {
			const response = await fetch(endpointUrl("rule", sessionId, cwd, { id }), { signal });
			if (!response.ok) throw new Error(`cursor-toolkit: HTTP ${String(response.status)}`);
			return (await response.json()).rule;
		}

		/**
		 * 读取单条技能的正文。
		 * @param id - 技能 id。
		 * @param sessionId - 会话 id。
		 * @param cwd - 会话工作目录。
		 * @param signal - 中止信号。
		 * @returns 技能对象（含 body）。
		 */
		async function fetchSkill(id, sessionId, cwd, signal) {
			const response = await fetch(endpointUrl("skill", sessionId, cwd, { id }), { signal });
			if (!response.ok) throw new Error(`cursor-toolkit: HTTP ${String(response.status)}`);
			return (await response.json()).skill;
		}

		/**
		 * 切换某一类资产的开关。
		 * @param kind - `rule` / `skill` / `mcp`。
		 * @param id - 资产 id。
		 * @param enabled - 目标状态。
		 * @param sessionId - 会话 id。
		 * @param cwd - 会话工作目录。
		 * @returns 宿主返回的最新快照。
		 */
		async function postToggle(kind, id, enabled, sessionId, cwd) {
			const response = await fetch(endpointUrl("toggle", undefined, undefined), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ kind, id, enabled, sessionId, cwd }),
			});
			if (!response.ok) throw new Error(`cursor-toolkit: HTTP ${String(response.status)}`);
			return response.json();
		}

		/**
		 * 面板数据钩子：加载快照（规则 / MCP / 技能一次取全）、切换开关、按需读取正文。
		 * @param sessionId - 会话 id。
		 * @param cwd - 会话工作目录。
		 * @returns 快照状态与操作函数。
		 */
		function useSnapshot(sessionId, cwd) {
			const [state, setState] = react.useState({ status: "loading" });
			const [busy, setBusy] = react.useState(() => new Set());
			const [failure, setFailure] = react.useState();

			const reload = react.useCallback(
				async (signal) => {
					try {
						const snapshot = await fetchSnapshot(sessionId, cwd, signal);
						if (signal?.aborted) return;
						setState({ status: "ready", snapshot });
						setFailure(undefined);
					} catch (error) {
						if (signal?.aborted || error?.name === "AbortError") return;
						setFailure(error instanceof Error ? error.message : String(error));
						setState({ status: "failed" });
					}
				},
				[sessionId, cwd],
			);

			react.useEffect(() => {
				const controller = new AbortController();
				setState({ status: "loading" });
				reload(controller.signal);
				return () => {
					controller.abort();
				};
			}, [reload]);

			const toggle = react.useCallback(
				async (kind, item) => {
					setBusy((previous) => new Set(previous).add(item.id));
					try {
						const snapshot = await postToggle(kind, item.id, !item.enabled, sessionId, cwd);
						setState({ status: "ready", snapshot });
						setFailure(undefined);
					} catch (error) {
						setFailure(error instanceof Error ? error.message : String(error));
					} finally {
						setBusy((previous) => {
							const next = new Set(previous);
							next.delete(item.id);
							return next;
						});
					}
				},
				[sessionId, cwd],
			);

			return { state, failure, busy, reload, toggle };
		}

		/** 注入到 <head> 的样式表元素 id：全局样式只需一份，卸载时按 id 摘掉。 */
		const STYLE_ID = "dsh-cursor-toolkit-style";

		/** 类名前缀：所有选择器都带它，避免与平台和其它插件的样式互相污染。 */
		const CLS = "dsrc";

		/**
		 * 页面样式表。
		 *
		 * 颜色、圆角一律取平台设计 token（都带兜底值），因此明暗主题下都成立；
		 * hover / transition 这类伪类行内样式表达不了，必须走样式表。
		 */
		const STYLE_TEXT = `
.${CLS}-page{box-sizing:border-box;height:100%;overflow-y:auto;padding:calc(var(--dsh-frame-top-clearance,0px) + 28px) 32px 48px;}
.${CLS}-pageInner{display:flex;flex-direction:column;width:100%;max-width:920px;margin:0 auto;}
.${CLS}-panel{display:flex;flex-direction:column;min-height:0;}

.${CLS}-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:1px solid var(--dsw-alias-border-l1,#00000014);}
.${CLS}-title{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary,#111);}
.${CLS}-subtitle{margin:6px 0 0;max-width:62ch;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary,#666);}
.${CLS}-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.${CLS}-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 10px;border-radius:999px;font-size:11px;line-height:22px;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-layer-2,#f5f5f5);border:.5px solid var(--dsw-alias-border-l1,#00000014);}
.${CLS}-pill-strong{color:var(--dsw-alias-label-primary,#111);}
.${CLS}-headActions{display:flex;align-items:center;gap:8px;flex-shrink:0;padding-top:2px;}

.${CLS}-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;background:var(--dsw-alias-label-tertiary,#999);}
.${CLS}-dot-on{background:var(--dsw-alias-state-success-primary,#2fa84f);}
.${CLS}-dot-always{background:var(--dsw-alias-brand-primary,#2f6fed);}
.${CLS}-dot-auto{background:var(--dsw-alias-state-success-primary,#2fa84f);}
.${CLS}-dot-agent{background:var(--dsw-alias-state-warn-primary,#c8871a);}

.${CLS}-group{display:flex;flex-direction:column;gap:10px;margin-top:26px;}
.${CLS}-groupHead{display:flex;align-items:center;gap:10px;}
.${CLS}-groupTitle{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#999);}
.${CLS}-groupCount{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums;}
.${CLS}-groupRule{flex:1;height:1px;background:var(--dsw-alias-border-l1,#00000014);}
.${CLS}-list{display:flex;flex-direction:column;gap:8px;}

.${CLS}-row{display:flex;flex-direction:column;align-items:stretch;gap:0;padding:12px 14px;border-radius:var(--dsw-radius-lg,14px);border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l3,#0000001f));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1,#fff));transition:background .12s ease,border-color .12s ease;}
.${CLS}-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,#f5f5f5));border-color:var(--dsw-alias-border-l2,#00000024);}
.${CLS}-rowTop{display:flex;align-items:center;gap:14px;}
.${CLS}-row-off{opacity:.6;}
.${CLS}-rowMain{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1;}
.${CLS}-rowName{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.${CLS}-rowTitle{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#111);}
.${CLS}-type{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:6px;font-size:11px;line-height:20px;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-layer-2,#f5f5f5);border:.5px solid var(--dsw-alias-border-l1,#00000014);}
.${CLS}-rowSize{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums;}
.${CLS}-rowPath{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.${CLS}-rowText{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#666);}
.${CLS}-rowActions{display:flex;align-items:center;gap:10px;flex-shrink:0;}

.${CLS}-note{margin:16px 0 0;padding:10px 12px;border-radius:var(--dsw-radius-md,10px);font-size:12px;line-height:1.6;background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:var(--dsw-alias-label-secondary,#666);}
.${CLS}-note-warn{background:var(--dsw-alias-state-warn-tertiary,#fff7e6);color:var(--dsw-alias-state-warn-label,#8a5a00);}
.${CLS}-note-error{background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:var(--dsw-alias-state-error-primary,#d92d20);}
.${CLS}-empty{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:26px;padding:56px 24px;border-radius:var(--dsw-radius-lg,14px);border:1px dashed var(--dsw-alias-border-l2,#00000024);text-align:center;color:var(--dsw-alias-label-tertiary,#999);}
.${CLS}-emptyTitle{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary,#666);}
.${CLS}-emptyHint{margin:0;max-width:46ch;font-size:12px;line-height:1.65;}
.${CLS}-foot{margin:24px 0 0;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l1,#00000014);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);word-break:break-all;}
.${CLS}-body{margin-top:12px;padding-top:12px;border-top:1px dashed var(--dsw-alias-border-l1,#00000014);max-height:min(56vh,520px);overflow-y:auto;font-size:13px;line-height:1.75;}

.${CLS}-tabs{display:flex;align-items:center;gap:4px;margin:18px 0 0;padding:3px;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-2,#f5f5f5);align-self:flex-start;}
.${CLS}-tab{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border:0;border-radius:calc(var(--dsw-radius-md,10px) - 3px);background:transparent;font-size:12.5px;line-height:28px;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;transition:background .12s ease,color .12s ease;}
.${CLS}-tab:hover{color:var(--dsw-alias-label-primary,#111);}
.${CLS}-tabOn{background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-shadow-lv1,0 1px 2px #00000014);}
.${CLS}-tabCount{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums;}
.${CLS}-tabOn .${CLS}-tabCount{color:var(--dsw-alias-label-secondary,#666);}

.${CLS}-status{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:6px;font-size:11px;line-height:20px;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-layer-2,#f5f5f5);border:.5px solid var(--dsw-alias-border-l1,#00000014);}
.${CLS}-status-ready{color:var(--dsw-alias-state-success-label,#1c7a37);background:var(--dsw-alias-state-success-tertiary,#eaf7ee);border-color:transparent;}
.${CLS}-status-connecting{color:var(--dsw-alias-state-warn-label,#8a5a00);background:var(--dsw-alias-state-warn-tertiary,#fff7e6);border-color:transparent;}
.${CLS}-status-failed{color:var(--dsw-alias-state-error-primary,#d92d20);border-color:transparent;}
.${CLS}-rowMeta{font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.${CLS}-panel + .${CLS}-panel{margin-top:20px;}
`;

		/**
		 * 把样式表挂到 <head>（幂等）。
		 * @returns 卸载函数：移除本插件插入的那个 style 元素。
		 */
		function mountStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.getElementById(STYLE_ID) !== null) return () => {};
			const element = document.createElement("style");
			element.id = STYLE_ID;
			element.textContent = STYLE_TEXT;
			document.head.appendChild(element);
			return () => {
				element.remove();
			};
		}

		/**
		 * 把字节数格式化成紧凑的展示文本。
		 * @param bytes - 字节数。
		 * @returns 形如 `972 B` / `12.3 KB` 的文本。
		 */
		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
			return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
		}

		/**
		 * 规则类型标签：圆点区分四类语义，文字用标签样式（平台 `Tag` 不能带前置圆点，
		 * 但两者视觉规格一致，故本处自绘）。
		 * @param type - 规则类型。
		 * @param t - 本地化函数。
		 * @returns 标签元素。
		 */
		function TypeTag({ type, t }) {
			const tone = type === "always" || type === "auto" || type === "agent" ? type : "manual";
			const key = `type${tone[0].toUpperCase()}${tone.slice(1)}`;
			return jsxs("span", {
				className: `${CLS}-type`,
				children: [jsx("span", { className: `${CLS}-dot ${CLS}-dot-${tone}` }), t(key)],
			});
		}

		/**
		 * 单条规则行；点击「查看」在原地向下展开正文，不打断浏览位置。
		 * @param props - 行属性。
		 * @returns 行元素。
		 */
		function RuleRow({ rule, busy, expanded, sessionId, cwd, t, onToggle, onOpen }) {
			const globs = rule.globs.length > 0 ? `${t("globs")} ${rule.globs.join(", ")}` : undefined;
			return jsxs("div", {
				className: rule.enabled ? `${CLS}-row` : `${CLS}-row ${CLS}-row-off`,
				children: [
					jsxs("div", {
						className: `${CLS}-rowTop`,
						children: [
							jsxs("div", {
								className: `${CLS}-rowMain`,
								children: [
									jsxs("div", {
										className: `${CLS}-rowName`,
										children: [
											jsx("span", { className: `${CLS}-rowTitle`, children: rule.title }),
											jsx(TypeTag, { type: rule.type, t }),
											jsx("span", { className: `${CLS}-rowSize`, children: formatBytes(rule.bytes) }),
										],
									}),
									jsx("span", { className: `${CLS}-rowPath`, title: rule.path, children: rule.displayPath }),
									globs === undefined ? null : jsx("span", { className: `${CLS}-rowPath`, title: globs, children: globs }),
									rule.description.length > 0 ? jsx("span", { className: `${CLS}-rowText`, children: rule.description }) : null,
								],
							}),
							jsxs("div", {
								className: `${CLS}-rowActions`,
								children: [
									jsx(Button, {
										variant: "ghost",
										onClick: () => onOpen(rule),
										children: expanded ? t("collapse") : t("open"),
									}),
									jsx(Switch, {
										checked: rule.enabled,
										disabled: busy,
										label: rule.enabled ? t("enabled") : t("disabled"),
										onChange: () => onToggle(rule),
									}),
								],
							}),
						],
					}),
					expanded ? jsx(RuleBody, { rule, sessionId, cwd, t }) : null,
				],
			});
		}

		/**
		 * 规则正文（行内展开区）。挂载即按需拉取一次全文，卸载时中断请求。
		 * @param props - 正文属性。
		 * @returns 正文元素。
		 */
		function RuleBody({ rule, sessionId, cwd, t }) {
			const [body, setBody] = react.useState();
			const [failure, setFailure] = react.useState();
			react.useEffect(() => {
				const controller = new AbortController();
				setBody(undefined);
				setFailure(undefined);
				fetchRule(rule.id, sessionId, cwd, controller.signal)
					.then((full) => {
						if (!controller.signal.aborted) setBody(full.body);
					})
					.catch((error) => {
						if (controller.signal.aborted || error?.name === "AbortError") return;
						setFailure(error instanceof Error ? error.message : String(error));
					});
				return () => {
					controller.abort();
				};
			}, [rule.id, sessionId, cwd]);
			return jsxs("div", {
				className: `${CLS}-body`,
				children: [
					failure === undefined ? null : jsx("p", { className: `${CLS}-note ${CLS}-note-error`, children: `${t("bodyFailed")}: ${failure}` }),
					body === undefined
						? failure === undefined
							? jsx("p", { className: `${CLS}-note`, children: t("loading") })
							: null
						: jsx(MarkdownText, { text: body }),
				],
			});
		}

		/**
		 * 统计胶囊行。
		 * @param props - `items` 为 `{ key, className, dot, text }` 数组。
		 * @returns 胶囊行元素。
		 */
		function Pills({ items }) {
			return jsx("div", {
				className: `${CLS}-stats`,
				children: items.map((pill) =>
					jsxs(
						"span",
						{
							className: pill.className,
							children: [
								pill.dot === undefined ? null : jsx("span", { className: `${CLS}-dot ${pill.dot}` }),
								pill.text,
							],
						},
						pill.key,
					),
				),
			});
		}

		/**
		 * 面板头：标题 + 副标题 + 刷新按钮（整页与设置分节共用）。
		 * @param props - 头属性。
		 * @returns 头元素。
		 */
		function PanelHead({ t, title, subtitle, onRefresh }) {
			return jsxs("div", {
				className: `${CLS}-head`,
				children: [
					jsxs("div", {
						children: [
							jsx("h1", { className: `${CLS}-title`, children: title }),
							jsx("p", { className: `${CLS}-subtitle`, children: subtitle }),
						],
					}),
					jsx("div", {
						className: `${CLS}-headActions`,
						children: jsx(Tooltip, {
							label: t("refresh"),
							side: "bottom",
							children: jsx(Button, {
								variant: "ghost",
								onClick: () => {
									onRefresh();
								},
								children: jsx(IconRefreshOutlineRegular, { size: 14 }),
							}),
						}),
					}),
				],
			});
		}

		/**
		 * 页签条：规则 / MCP / 技能。
		 * @param props - 页签属性。
		 * @returns 页签条元素。
		 */
		function TabsBar({ tab, counts, onChange, t }) {
			const items = [
				{ id: "rules", label: t("tabRules"), count: counts.rules },
				{ id: "mcp", label: t("tabMcp"), count: counts.mcp },
				{ id: "skills", label: t("tabSkills"), count: counts.skills },
			];
			return jsx("div", {
				className: `${CLS}-tabs`,
				role: "tablist",
				children: items.map((item) =>
					jsxs(
						"button",
						{
							type: "button",
							role: "tab",
							"aria-selected": tab === item.id,
							className: tab === item.id ? `${CLS}-tab ${CLS}-tabOn` : `${CLS}-tab`,
							onClick: () => onChange(item.id),
							children: [item.label, jsx("span", { className: `${CLS}-tabCount`, children: String(item.count) })],
						},
						item.id,
					),
				),
			});
		}

		/**
		 * 空态卡片。
		 * @param props - 空态属性。
		 * @returns 空态元素。
		 */
		function EmptyState({ title, hint }) {
			return jsxs("div", {
				className: `${CLS}-empty`,
				children: [
					jsx(IconChecklistOutlineRegular, { size: 20 }),
					jsx("p", { className: `${CLS}-emptyTitle`, children: title }),
					hint === undefined ? null : jsx("p", { className: `${CLS}-emptyHint`, children: hint }),
				],
			});
		}

		/**
		 * 按作用域分组（用户级在前），组内按名称排序。
		 * @param items - 待分组的条目。
		 * @returns `[scope, items]` 数组。
		 */
		function groupByScope(items) {
			const order = ["user", "project"];
			const byScope = new Map();
			for (const item of items) {
				const bucket = byScope.get(item.scope) ?? [];
				bucket.push(item);
				byScope.set(item.scope, bucket);
			}
			for (const bucket of byScope.values()) bucket.sort((left, right) => left.name.localeCompare(right.name));
			return order.filter((scope) => byScope.has(scope)).map((scope) => [scope, byScope.get(scope)]);
		}

		/**
		 * 规则页签内容（整页的规则页签与设置分节共用）。
		 * @param props - 内容属性。
		 * @returns 规则列表元素。
		 */
		function RulesBody({ snapshot, loading, sessionId, cwd, t, busy, toggle }) {
			const [opened, setOpened] = react.useState();
			const rules = snapshot?.rules ?? [];
			const enabledCount = rules.filter((rule) => rule.enabled).length;
			const groups = react.useMemo(() => {
				const order = ["always", "auto", "agent", "manual"];
				const byScope = new Map();
				for (const rule of rules) {
					const bucket = byScope.get(rule.scope) ?? [];
					bucket.push(rule);
					byScope.set(rule.scope, bucket);
				}
				for (const bucket of byScope.values()) {
					bucket.sort((left, right) => order.indexOf(left.type) - order.indexOf(right.type) || left.title.localeCompare(right.title));
				}
				return [...byScope.entries()];
			}, [rules]);

			const reveal = (rule) => {
				setOpened((current) => (current?.id === rule.id ? undefined : rule));
			};

			const statPills = [
				{ key: "pillAll", className: `${CLS}-pill ${CLS}-pill-strong`, text: format(t("pillAll"), { total: rules.length }) },
				{ key: "pillOn", className: `${CLS}-pill`, dot: `${CLS}-dot-on`, text: format(t("pillOn"), { enabled: enabledCount }) },
			];
			if (rules.length > enabledCount) {
				statPills.push({ key: "pillOff", className: `${CLS}-pill`, dot: `${CLS}-dot`, text: format(t("pillOff"), { off: rules.length - enabledCount }) });
			}

			if (rules.length === 0) {
				return jsx(EmptyState, {
					title: loading ? t("loading") : t("empty"),
					hint: loading ? undefined : t("emptyHint"),
				});
			}
			return jsxs("div", {
				className: `${CLS}-panel`,
				children: [
					jsx(Pills, { items: statPills }),
					groups.map(([scope, bucket]) =>
						jsxs(
							"section",
							{
								className: `${CLS}-group`,
								children: [
									jsxs("div", {
										className: `${CLS}-groupHead`,
										children: [
											jsx("span", { className: `${CLS}-groupTitle`, children: scope === "user" ? t("scopeUser") : t("scopeProject") }),
											jsx("span", { className: `${CLS}-groupCount`, children: String(bucket.length) }),
											jsx("span", { className: `${CLS}-groupRule` }),
										],
									}),
									jsx("div", {
										className: `${CLS}-list`,
										children: bucket.map((rule) =>
											jsx(
												RuleRow,
												{
													rule,
													busy: busy.has(rule.id),
													t,
													onToggle: (item) => toggle("rule", item),
													expanded: opened?.id === rule.id,
													sessionId,
													cwd,
													onOpen: reveal,
												},
												rule.id,
											),
										),
									}),
								],
							},
							scope,
						),
					),
				],
			});
		}

		/**
		 * 技能正文（行内展开区）。
		 * @param props - 正文属性。
		 * @returns 正文元素。
		 */
		function SkillBody({ skill, sessionId, cwd, t }) {
			const [body, setBody] = react.useState();
			const [failure, setFailure] = react.useState();
			react.useEffect(() => {
				const controller = new AbortController();
				setBody(undefined);
				setFailure(undefined);
				fetchSkill(skill.id, sessionId, cwd, controller.signal)
					.then((full) => {
						if (!controller.signal.aborted) setBody(full.body);
					})
					.catch((error) => {
						if (controller.signal.aborted || error?.name === "AbortError") return;
						setFailure(error instanceof Error ? error.message : String(error));
					});
				return () => {
					controller.abort();
				};
			}, [skill.id, sessionId, cwd]);
			return jsxs("div", {
				className: `${CLS}-body`,
				children: [
					failure === undefined ? null : jsx("p", { className: `${CLS}-note ${CLS}-note-error`, children: `${t("skillBodyFailed")}: ${failure}` }),
					body === undefined
						? failure === undefined
							? jsx("p", { className: `${CLS}-note`, children: t("loading") })
							: null
						: jsx(MarkdownText, { text: body }),
				],
			});
		}

		/**
		 * 单条技能行。
		 * @param props - 行属性。
		 * @returns 行元素。
		 */
		function SkillRow({ skill, busy, expanded, sessionId, cwd, t, onToggle, onOpen }) {
			return jsxs("div", {
				className: skill.enabled ? `${CLS}-row` : `${CLS}-row ${CLS}-row-off`,
				children: [
					jsxs("div", {
						className: `${CLS}-rowTop`,
						children: [
							jsxs("div", {
								className: `${CLS}-rowMain`,
								children: [
									jsxs("div", {
										className: `${CLS}-rowName`,
										children: [
											jsx("span", { className: `${CLS}-rowTitle`, children: skill.name }),
											skill.license === "" ? null : jsx("span", { className: `${CLS}-type`, children: skill.license }),
											jsx("span", { className: `${CLS}-rowSize`, children: formatBytes(skill.bytes) }),
										],
									}),
									jsx("span", { className: `${CLS}-rowPath`, title: skill.displayPath, children: skill.displayPath }),
									skill.description === "" ? null : jsx("span", { className: `${CLS}-rowText`, children: skill.description }),
									skill.files.length === 0
										? null
										: jsx("span", {
												className: `${CLS}-rowMeta`,
												title: skill.files.join(", "),
												children: `${t("skillFiles")}: ${skill.files.join(", ")}`,
											}),
								],
							}),
							jsxs("div", {
								className: `${CLS}-rowActions`,
								children: [
									jsx(Button, {
										variant: "ghost",
										onClick: () => onOpen(skill),
										children: expanded ? t("collapse") : t("open"),
									}),
									jsx(Switch, {
										checked: skill.enabled,
										disabled: busy,
										label: skill.enabled ? t("enabled") : t("disabled"),
										onChange: () => onToggle(skill),
									}),
								],
							}),
						],
					}),
					expanded ? jsx(SkillBody, { skill, sessionId, cwd, t }) : null,
				],
			});
		}

		/**
		 * 技能页签内容。
		 * @param props - 内容属性。
		 * @returns 技能列表元素。
		 */
		function SkillsBody({ snapshot, loading, sessionId, cwd, t, busy, toggle, enabledFeature }) {
			const [opened, setOpened] = react.useState();
			const skills = snapshot?.skills ?? [];
			const enabledCount = skills.filter((skill) => skill.enabled).length;
			if (enabledFeature === false) {
				return jsx("p", { className: `${CLS}-note ${CLS}-note-warn`, children: t("skillsDisabledFeature") });
			}
			if (skills.length === 0) {
				return jsx(EmptyState, {
					title: loading ? t("loading") : t("emptySkills"),
					hint: loading ? undefined : t("emptySkillsHint"),
				});
			}
			const reveal = (skill) => {
				setOpened((current) => (current?.id === skill.id ? undefined : skill));
			};
			const pills = [
				{ key: "pillAll", className: `${CLS}-pill ${CLS}-pill-strong`, text: format(t("pillAll"), { total: skills.length }) },
				{ key: "pillOn", className: `${CLS}-pill`, dot: `${CLS}-dot-on`, text: format(t("pillSkillOn"), { on: enabledCount }) },
			];
			return jsxs("div", {
				className: `${CLS}-panel`,
				children: [
					jsx(Pills, { items: pills }),
					groupByScope(skills).map(([scope, bucket]) =>
						jsxs(
							"section",
							{
								className: `${CLS}-group`,
								children: [
									jsxs("div", {
										className: `${CLS}-groupHead`,
										children: [
											jsx("span", { className: `${CLS}-groupTitle`, children: scope === "user" ? t("scopeUser") : t("scopeProject") }),
											jsx("span", { className: `${CLS}-groupCount`, children: String(bucket.length) }),
											jsx("span", { className: `${CLS}-groupRule` }),
										],
									}),
									jsx("div", {
										className: `${CLS}-list`,
										children: bucket.map((skill) =>
											jsx(
												SkillRow,
												{
													skill,
													busy: busy.has(skill.id),
													t,
													onToggle: (item) => toggle("skill", item),
													expanded: opened?.id === skill.id,
													sessionId,
													cwd,
													onOpen: reveal,
												},
												skill.id,
											),
										),
									}),
								],
							},
							scope,
						),
					),
				],
			});
		}

		/**
		 * 把运行时状态映射成展示用的文案键与色调。
		 * @param server - MCP server。
		 * @returns `{ key, tone }`。
		 */
		function mcpStatusOf(server) {
			if (server.problem !== undefined) return { key: "mcpStatusFailed", tone: "failed" };
			if (!server.enabled) return { key: "mcpStatusDisabled", tone: "" };
			if (server.status === "ready") return { key: "mcpStatusReady", tone: "ready" };
			if (server.status === "connecting") return { key: "mcpStatusConnecting", tone: "connecting" };
			if (server.status === "failed") return { key: "mcpStatusFailed", tone: "failed" };
			return { key: "mcpStatusIdle", tone: "" };
		}

		/**
		 * 单条 MCP server 行。
		 * @param props - 行属性。
		 * @returns 行元素。
		 */
		function McpRow({ server, busy, t, onToggle }) {
			const status = mcpStatusOf(server);
			const target = server.transport === "stdio" ? `${server.command} ${server.args.join(" ")}`.trim() : server.url;
			const details = [];
			if (server.envKeys.length > 0) details.push(`${t("mcpEnv")}: ${server.envKeys.join(", ")}`);
			if (server.headersKeys.length > 0) details.push(`${t("mcpHeaders")}: ${server.headersKeys.join(", ")}`);
			return jsxs("div", {
				className: server.enabled ? `${CLS}-row` : `${CLS}-row ${CLS}-row-off`,
				children: [
					jsxs("div", {
						className: `${CLS}-rowTop`,
						children: [
							jsxs("div", {
								className: `${CLS}-rowMain`,
								children: [
									jsxs("div", {
										className: `${CLS}-rowName`,
										children: [
											jsx("span", { className: `${CLS}-rowTitle`, children: server.name }),
											jsx("span", { className: `${CLS}-type`, children: server.transport }),
											jsx("span", {
												className: status.tone === "" ? `${CLS}-status` : `${CLS}-status ${CLS}-status-${status.tone}`,
												children: t(status.key),
											}),
										],
									}),
									jsx("span", { className: `${CLS}-rowPath`, title: server.displayPath, children: server.displayPath }),
									jsx("span", { className: `${CLS}-rowPath`, title: target, children: target }),
									server.problem === undefined ? null : jsx("span", { className: `${CLS}-rowText`, children: t(server.problem === "missing command" ? "mcpProblemCommand" : "mcpProblemUrl") }),
									server.reason === undefined ? null : jsx("span", { className: `${CLS}-rowMeta`, children: server.reason }),
									details.length === 0 ? null : jsx("span", { className: `${CLS}-rowMeta`, children: details.join(" · ") }),
									jsx("span", { className: `${CLS}-rowMeta`, children: server.serverName }),
								],
							}),
							jsx("div", {
								className: `${CLS}-rowActions`,
								children: jsx(Switch, {
									checked: server.enabled,
									disabled: busy,
									label: server.enabled ? t("enabled") : t("disabled"),
									onChange: () => onToggle(server),
								}),
							}),
						],
					}),
				],
			});
		}

		/**
		 * MCP 页签内容。
		 * @param props - 内容属性。
		 * @returns MCP server 列表元素。
		 */
		function McpBody({ snapshot, loading, t, busy, toggle, enabledFeature }) {
			const servers = snapshot?.mcp ?? [];
			const connected = servers.filter((server) => server.enabled && server.status === "ready").length;
			if (enabledFeature === false) {
				return jsx("p", { className: `${CLS}-note ${CLS}-note-warn`, children: t("mcpDisabledFeature") });
			}
			if (servers.length === 0) {
				return jsx(EmptyState, {
					title: loading ? t("loading") : t("emptyMcp"),
					hint: loading ? undefined : t("emptyMcpHint"),
				});
			}
			const offCount = servers.filter((server) => !server.enabled).length;
			const pills = [
				{ key: "pillAll", className: `${CLS}-pill ${CLS}-pill-strong`, text: format(t("pillAll"), { total: servers.length }) },
				{ key: "pillOn", className: `${CLS}-pill`, dot: `${CLS}-dot-on`, text: format(t("pillMcpOn"), { on: connected }) },
			];
			if (offCount > 0) {
				pills.push({ key: "pillOff", className: `${CLS}-pill`, dot: `${CLS}-dot`, text: format(t("pillMcpOff"), { off: offCount }) });
			}
			return jsxs("div", {
				className: `${CLS}-panel`,
				children: [
					jsx(Pills, { items: pills }),
					jsx("div", {
						className: `${CLS}-list ${CLS}-group`,
						children: servers.map((server) =>
							jsx(
								McpRow,
								{
									server,
									busy: busy.has(server.id),
									t,
									onToggle: (item) => toggle("mcp", item),
								},
								server.id,
							),
						),
					}),
				],
			});
		}

		/**
		 * 设置分节里的规则视图（只有规则，不含页签）。
		 * @param props - 面板属性。
		 * @returns 面板元素。
		 */
		function RulesPanel({ sessionId, cwd, t }) {
			const { state, failure, busy, reload, toggle } = useSnapshot(sessionId, cwd);
			return jsxs("div", {
				className: `${CLS}-panel`,
				children: [
					jsx(PanelHead, { t, title: t("title"), subtitle: t("subtitle"), onRefresh: () => reload() }),
					failure === undefined ? null : jsx("p", { className: `${CLS}-note ${CLS}-note-error`, children: `${t("failed")}: ${failure}` }),
					jsx(RulesBody, {
						snapshot: state.snapshot,
						loading: state.status === "loading",
						sessionId,
						cwd,
						t,
						busy,
						toggle,
					}),
				],
			});
		}

		/**
		 * 设置面板中的「Cursor 工具包」分节。
		 * @param props - 组合后的 slot props。
		 * @returns 分节元素。
		 */
		function CursorRulesSection(props) {
			const { useSessions, t } = props;
			const sessionId = useSessions(currentSessionIdOf);
			const cwd = useSessions((state) => (sessionId === undefined ? undefined : state.byId[sessionId]?.cwd));
			return jsx(RulesPanel, { sessionId, cwd, t });
		}

		/**
		 * 左栏导航行的图标（`sidebar.panellist` 的注册组件）。
		 * @param owner - 侧边栏传入的尺寸信息，缺省按 16 绘制。
		 * @returns 图标元素。
		 */
		function CursorRulesIcon(owner) {
			return jsx(IconChecklistOutlineRegular, { size: owner?.size ?? 16 });
		}

		/**
		 * 左栏导航打开的整页：标题 + 三个页签（规则 / MCP / 技能）。
		 *
		 * 页面宿主只提供全局 hook，取不到 `useSessions` 时退化为「用户级资产 + 宿主进程目录」，
		 * 由页面自己显示 `noSession` 提示，不阻断整页渲染。
		 *
		 * @param props - 组合后的 slot props。
		 * @returns 页面元素。
		 */
		function CursorRulesPage(props) {
			const { t } = props;
			const useSessionsHook = typeof props.useSessions === "function" ? props.useSessions : undefined;
			const sessionId = useSessionsHook === undefined ? undefined : useSessionsHook(currentSessionIdOf);
			const cwd =
				useSessionsHook === undefined
					? undefined
					: useSessionsHook((state) => (sessionId === undefined ? undefined : state.byId[sessionId]?.cwd));
			const { state, failure, busy, reload, toggle } = useSnapshot(sessionId, cwd);
			const [tab, setTab] = react.useState("rules");
			const snapshot = state.snapshot;
			const loading = state.status === "loading";
			const counts = {
				rules: snapshot?.rules.length ?? 0,
				mcp: snapshot?.mcp.length ?? 0,
				skills: snapshot?.skills.length ?? 0,
			};
			const features = snapshot?.features ?? { rules: true, mcp: true, skills: true };
			const shared = { snapshot, loading, sessionId, cwd, t, busy, toggle };
			return jsxs("div", {
				className: `${CLS}-page`,
				children: jsxs("div", {
					className: `${CLS}-pageInner`,
					children: [
						jsx(PanelHead, {
							t,
							title: t("titleAssets"),
							subtitle: t("subtitleAssets"),
							onRefresh: () => {
								reload();
							},
						}),
						sessionId === undefined
							? jsx("p", { className: `${CLS}-note ${CLS}-note-warn`, children: t("noSession") })
							: null,
						failure === undefined ? null : jsx("p", { className: `${CLS}-note ${CLS}-note-error`, children: `${t("failed")}: ${failure}` }),
						jsx(TabsBar, { tab, counts, onChange: setTab, t }),
						tab === "rules"
							? jsx(RulesBody, shared)
							: tab === "mcp"
								? jsx(McpBody, { ...shared, enabledFeature: features.mcp })
								: jsx(SkillsBody, { ...shared, enabledFeature: features.skills }),
						snapshot === undefined ? null : jsx("p", { className: `${CLS}-foot`, children: `${t("statePath")}: ${snapshot.statePath}` }),
					],
				}),
			});
		}

		function apply(ctx) {
			ctx.effect(() => mountStyles(), "cursor-toolkit: styles");
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "cursor-toolkit: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: PANEL_ID,
						order: 30,
						label: () => ctx.locale.bind(NS)("nav"),
						locale: NS,
					},
					CursorRulesSection,
				),
			);
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 30,
						label: () => ctx.locale.bind(NS)("nav"),
						locale: NS,
					},
					CursorRulesIcon,
				),
			);
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
						locale: NS,
						inject: () => ({ t }),
					},
					CursorRulesPage,
				),
			);
			ctx.inject(["layout"], (scoped) => {
				const layout = scoped.layout;
				ctx.effect(
					() => () => {
						if (layout?.panelInfo?.getSnapshot?.().activePanelId === PANEL_ID) layout.selectPanel(null);
					},
					"cursor-toolkit: sidebar panel cleanup",
				);
			});
			void t;
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
