/**
 * DSH 插件：Cursor Rules（宿主半边）
 *
 * 把 Cursor 在 `.cursor` 目录下的三类资产接入 DSH：
 *
 * 1. 规则（`.cursor/rules/**\/*.mdc`）：用户级 `~/.dsh/rules` 与 `~/.cursor/rules`（前者优先）
 *    + 项目根到会话 cwd 各层，解析 frontmatter 后按 Always / Auto Attached / Agent Requested /
 *    Manual 四类语义在 `agent/pre-step` 折进本轮批次。
 * 2. 技能（`.cursor/skills/<name>/SKILL.md`）：目录（name + description）随规则一起注入，
 *    正文由 `cursor_skill` 工具按需拉取。
 * 3. MCP（`.cursor/mcp.json`）：解析出 server 后按开关**真接入**为 DSH 的 MCP 客户端
 *    （临时挂载 `@deepseek-ai/dsh-mcp-client`），默认全部关闭，避免一上来就拉起 npx/uvx 进程。
 *
 * 三者共用一套面板接口：`ctx.webServer` 暴露 JSON 路由，浏览器半边渲染「规则 / MCP / 技能」三个页签。
 *
 * 参考实现：`@deepseek-ai/dsh-agent-instructions`（同为工作区指令注入器，
 * 本插件沿用其 source 自有、正文逐字、框标签转义、增量投递的约定）。
 *
 * @module dsh-cursor-toolkit
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_USER_MCP_FILES,
	DEFAULT_USER_RULE_DIRS,
	DEFAULT_USER_SKILL_DIRS,
	SOURCE_KIND,
	SKILL_FILE_NAME,
	collectMcpServers,
	collectRules,
	collectSkills,
	planInjection,
	planSkillCatalog,
	selectRules,
	splitFrontmatter,
} from './rules.js';

/** Cordis 插件名，用于 Loader 诊断。 */
export const name = 'dsh-cursor-toolkit';

/**
 * 本插件不依赖任何**必须**存在的服务：核心的规则注入只用到事件，
 * 因此 `inject` 保持为空，纯 headless 场景也能加载；
 * `webServer` / `sessions` 都是可选增强，分别用 `ctx.inject(['webServer'], …)`
 * 与惰性 `ctx.get('sessions')` 获取（前者必须有，否则冷启动会漏注册路由）。
 */
export const inject = [];

/** 传给工具的正文预览上限（字节）。 */
const PREVIEW_LIMIT = 4000;

/**
 * 插件代码版本，随 `GET <httpPath>/rules` 一起返回。
 *
 * 存在的意义：DSH 的 profile 只监听 patch 文件、不监听插件模块（`hmr.root` 为空），
 * 因此改了插件代码后无法靠热重载生效。响应里带版本号可以直接判断
 * 「当前进程跑的是哪一版代码」，避免再次出现「改完以为生效」的误判。
 */
const PLUGIN_VERSION = '2.0.2';

/** 插件配置。 */
export const Config = z.object({
	enabled: z.boolean().default(true),
	maxBytes: z.number().step(1).min(1024).default(DEFAULT_MAX_BYTES),
	includeUserRules: z.boolean().default(true),
	/**
	 * 用户级规则目录（按扫描顺序）。默认 `['~/.dsh/rules', '~/.cursor/rules']`：
	 * DSH 自有全局规则位 + Cursor 兼容位。两处同名文件是两条独立规则（用户级 id 含目录路径）。
	 */
	userRuleDirs: z.array(z.string()).default([...DEFAULT_USER_RULE_DIRS]),
	projectRootMarkers: z.array(z.string()).default(['.git']),
	/** 浏览器面板使用的 HTTP 前缀路由。 */
	httpPath: z.string().default('/cursor-toolkit'),
	/** 开关状态文件名，落在 `$DSH_HOME` 下。 */
	stateFile: z.string().default('cursor-toolkit.json'),
	/** 是否按「已触达文件」自动附加 globs 规则。 */
	trackTouches: z.boolean().default(true),
	/** 是否把 `.cursor/skills` 的技能目录注入上下文（正文仍由 `cursor_skill` 按需拉取）。 */
	enableSkills: z.boolean().default(true),
	/** 用户级技能目录。默认 `['~/.cursor/skills']`（`~/.dsh/skills` 是 DSH 自己的技能位，不重复扫描）。 */
	userSkillDirs: z.array(z.string()).default([...DEFAULT_USER_SKILL_DIRS]),
	/** 是否允许把 `.cursor/mcp.json` 里的 server 接入为 DSH MCP 客户端。 */
	enableMcp: z.boolean().default(true),
	/** 用户级 MCP 配置文件。默认 `['~/.cursor/mcp.json']`。 */
	userMcpFiles: z.array(z.string()).default([...DEFAULT_USER_MCP_FILES]),
	/** MCP server 启动超时（毫秒）。 */
	mcpStartupTimeoutMs: z.number().step(1).min(1000).default(30000),
	/** 技能目录注入的字节预算。 */
	skillCatalogBytes: z.number().step(1).min(512).default(8192),
});

/**
 * 组装运行时配置（补默认值并以 `$DSH_HOME` 解析状态文件绝对路径）。
 * @param config - Loader 传入的配置。
 * @returns 归一化后的运行时配置。
 */
function resolveConfig(config) {
	const merged = {
		enabled: config?.enabled ?? true,
		maxBytes: config?.maxBytes ?? DEFAULT_MAX_BYTES,
		includeUserRules: config?.includeUserRules ?? true,
		userRuleDirs: config?.userRuleDirs ?? [...DEFAULT_USER_RULE_DIRS],
		projectRootMarkers: config?.projectRootMarkers ?? ['.git'],
		httpPath: config?.httpPath ?? '/cursor-toolkit',
		stateFile: config?.stateFile ?? 'cursor-toolkit.json',
		trackTouches: config?.trackTouches ?? true,
		enableSkills: config?.enableSkills ?? true,
		userSkillDirs: config?.userSkillDirs ?? [...DEFAULT_USER_SKILL_DIRS],
		enableMcp: config?.enableMcp ?? true,
		userMcpFiles: config?.userMcpFiles ?? [...DEFAULT_USER_MCP_FILES],
		mcpStartupTimeoutMs: config?.mcpStartupTimeoutMs ?? 30000,
		skillCatalogBytes: config?.skillCatalogBytes ?? 8192,
	};
	const statePath = isAbsolute(merged.stateFile) ? merged.stateFile : join(resolveDshHome(), merged.stateFile);
	return { ...merged, statePath };
}

/**
 * 判断一条消息是否由本插件投递。
 * @param message - 会话消息。
 * @returns 是本插件消息时为 true。
 */
function isCursorRulesMessage(message) {
	return typeof message?.source === 'object' && message.source !== null && message.source.kind === SOURCE_KIND;
}

/**
 * 从一组消息中取最后一条本插件消息携带的投递状态。
 * @param messages - 消息序列。
 * @returns `{ entries, catalogDigest, skillDigest }`，没有时返回 `undefined`。
 */
function lastDeliveryState(messages) {
	if (!Array.isArray(messages)) return undefined;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!isCursorRulesMessage(message)) continue;
		const entries = Array.isArray(message.source.entries) ? message.source.entries : [];
		return {
			entries,
			catalogDigest: message.source.catalogDigest,
			skillDigest: message.source.skillDigest,
		};
	}
	return undefined;
}

/**
 * 从任意值里取字符串数组（状态文件容错用）。
 * @param value - 待过滤的值。
 * @returns 只含字符串的数组。
 */
function stringArray(value) {
	return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/** 空状态（v1 只有 `disabled` 一个列表，读取时补默认值即可向后兼容）。 */
const EMPTY_STATE = { disabled: [], skillsDisabled: [], mcpEnabled: [] };

/**
 * 旧版本（叫 dsh-cursor-rules 时）使用的状态文件名，读到新文件时一并兼容。
 * 只列出默认路径的映射：自定义 `stateFile` 的用户没有历史包袱。
 */
const LEGACY_STATE_PATHS = new Map([['cursor-toolkit.json', 'cursor-rules.json']]);

/**
 * 读取开关状态文件。
 *
 * 先读当前文件名，读不到再回落到旧文件名，这样改名不会把用户已有的开关状态丢掉。
 *
 * @param statePath - 状态文件绝对路径。
 * @returns `{ disabled, skillsDisabled, mcpEnabled }`；文件缺失或损坏时返回空状态。
 */
async function readState(statePath) {
	const legacyName = LEGACY_STATE_PATHS.get(basename(statePath));
	const candidates = legacyName === undefined ? [statePath] : [statePath, join(dirname(statePath), legacyName)];
	for (const candidate of candidates) {
		try {
			return normalizeState(JSON.parse(await readFile(candidate, 'utf8')));
		} catch {
			// 换下一个候选
		}
	}
	return { ...EMPTY_STATE };
}

/**
 * 把磁盘上的状态规整成内存形态（缺字段补默认值，v1 文件也能读）。
 * @param parsed - `JSON.parse` 的结果。
 * @returns `{ disabled, skillsDisabled, mcpEnabled }`。
 */
function normalizeState(parsed) {
	return {
		disabled: stringArray(parsed?.disabled),
		skillsDisabled: stringArray(parsed?.skillsDisabled),
		// MCP 是白名单语义：默认空 = 全部关闭，只有显式打开过的 server 才会被接入。
		mcpEnabled: stringArray(parsed?.mcpEnabled),
	};
}

/**
 * 原子写入开关状态文件。
 * @param statePath - 状态文件绝对路径。
 * @param state - 待写入状态。
 * @returns 写入完成的 Promise。
 */
async function writeState(statePath, state) {
	await mkdir(dirname(statePath), { recursive: true });
	const temporary = `${statePath}.${process.pid}.tmp`;
	const payload = {
		version: 2,
		disabled: [...state.disabled].sort(),
		skillsDisabled: [...state.skillsDisabled].sort(),
		mcpEnabled: [...state.mcpEnabled].sort(),
	};
	await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
	await rename(temporary, statePath);
}

/**
 * 读取请求正文。
 * @param request - node:http 请求。
 * @param limitBytes - 正文上限。
 * @returns 正文文本。
 */
async function readRequestBody(request, limitBytes = 65536) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > limitBytes) throw new Error('request body too large');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/**
 * 写出一个 JSON 响应。
 * @param response - node:http 响应。
 * @param status - HTTP 状态码。
 * @param payload - 可 JSON 序列化的载荷。
 * @returns 无。
 */
function sendJson(response, status, payload) {
	const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': String(body.length),
		'cache-control': 'no-store',
	});
	response.end(body);
}

/**
 * 为面板准备一条规则的传输形态（列表里不带完整正文，只带预览）。
 * @param rule - 完整规则。
 * @param includeBody - 是否包含完整正文。
 * @returns 面向前端的规则对象。
 */
function rulePayload(rule, includeBody) {
	const base = {
		id: rule.id,
		displayPath: rule.displayPath,
		path: rule.path,
		scope: rule.scope,
		title: rule.title,
		description: rule.description,
		globs: rule.globs,
		alwaysApply: rule.alwaysApply,
		type: rule.type,
		bytes: rule.bytes,
		mtimeMs: rule.mtimeMs,
		enabled: rule.enabled,
	};
	if (includeBody) return { ...base, body: rule.body };
	return {
		...base,
		preview: rule.body.length > PREVIEW_LIMIT ? `${rule.body.slice(0, PREVIEW_LIMIT)}…` : rule.body,
		truncated: rule.body.length > PREVIEW_LIMIT,
	};
}

/**
 * 为面板准备一条技能的传输形态（正文按需另取）。
 * @param skill - 完整技能。
 * @returns 面向前端的技能对象。
 */
function skillPayload(skill) {
	return {
		id: skill.id,
		name: skill.name,
		description: skill.description,
		scope: skill.scope,
		displayPath: skill.displayPath,
		license: skill.license,
		bytes: skill.bytes,
		files: skill.files,
		enabled: skill.enabled,
	};
}

/**
 * 为面板准备一条 MCP server 的传输形态。
 * **不返回任何 env/header 的值**，只给键名与「是否已配置」。
 * @param server - 完整 server。
 * @param status - 运行时连接状态。
 * @returns 面向前端的 server 对象。
 */
function mcpPayload(server, status) {
	return {
		id: server.id,
		name: server.name,
		serverName: server.serverName,
		scope: server.scope,
		transport: server.transport,
		command: server.command,
		args: server.args,
		cwd: server.cwd,
		url: server.url,
		envKeys: server.envKeys,
		headersKeys: server.headersKeys,
		displayPath: server.displayPath,
		problem: server.problem,
		enabled: server.enabled,
		status: status?.state ?? 'idle',
		reason: status?.reason,
	};
}

/**
 * 取错误消息文本。
 * @param error - 任意错误。
 * @returns 消息字符串。
 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 取会话的工作目录（缺失时退回进程 cwd）。
 * @param session - 宿主会话对象。
 * @returns 绝对工作目录。
 */
function cwdOfSession(session) {
	const cwd = session?.header?.cwd;
	return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd();
}

/**
 * 插件主体：注册上下文注入、文件触达采集与面板 HTTP 接口。
 * @param ctx - Cordis 上下文。
 * @param config - 插件配置。
 * @returns 无。
 */
export function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	if (!resolved.enabled) return;

	/** 每个会话已触达的文件路径（globs 规则自动附加的依据）。 */
	const touchedBySession = new WeakMap();
	/** 每个会话最近一次投递状态，用于同一轮内的重复抑制。 */
	const deliveredBySession = new WeakMap();
	/** 开关状态的内存缓存，避免每次请求都读盘。 */
	let stateCache;
	let stateLoading;

	/**
	 * 取得开关状态（带进程内缓存）。
	 * @returns 状态对象。
	 */
	const state = async () => {
		if (stateCache !== undefined) return stateCache;
		stateLoading ??= readState(resolved.statePath).then((loaded) => {
			stateCache = loaded;
			stateLoading = undefined;
			return loaded;
		});
		return stateLoading;
	};

	/**
	 * 以当前 cwd 收集规则全集。
	 * @param cwd - 会话工作目录。
	 * @param signal - 中止信号。
	 * @returns 收集结果。
	 */
	const gather = async (cwd, signal) => {
		const { disabled } = await state();
		return collectRules({
			cwd,
			projectRootMarkers: resolved.projectRootMarkers,
			includeUserRules: resolved.includeUserRules,
			userRuleDirs: resolved.userRuleDirs,
			disabled,
			signal,
		});
	};

	/**
	 * 以当前 cwd 收集技能全集（开关状态来自 `skillsDisabled`）。
	 * @param cwd - 会话工作目录。
	 * @param signal - 中止信号。
	 * @param projectRoot - 已知项目根，避免重复探测。
	 * @returns 收集结果。
	 */
	const gatherSkills = async (cwd, signal, projectRoot) => {
		const { skillsDisabled } = await state();
		return collectSkills({
			cwd,
			projectRoot,
			projectRootMarkers: resolved.projectRootMarkers,
			includeUser: resolved.includeUserRules,
			userDirs: resolved.userSkillDirs,
			disabled: skillsDisabled,
			signal,
		});
	};

	/**
	 * 以当前 cwd 收集 MCP server（`mcpEnabled` 是白名单：不在名单里即视为关闭）。
	 * @param cwd - 会话工作目录。
	 * @param signal - 中止信号。
	 * @param projectRoot - 已知项目根。
	 * @returns 收集结果，`servers[].enabled` 已按白名单重算。
	 */
	const gatherMcp = async (cwd, signal, projectRoot) => {
		const { mcpEnabled } = await state();
		const allow = new Set(mcpEnabled);
		const gathered = await collectMcpServers({
			cwd,
			projectRoot,
			projectRootMarkers: resolved.projectRootMarkers,
			includeUser: resolved.includeUserRules,
			userFiles: resolved.userMcpFiles,
			signal,
		});
		return {
			...gathered,
			servers: gathered.servers.map((server) => ({
				...server,
				enabled: server.problem === undefined && allow.has(server.id),
			})),
		};
	};

	/** 记录一次文件触达（read / write / edit 与 fs/observed 两条来源）。 */
	const recordTouch = (session, path) => {
		if (!resolved.trackTouches || session === undefined || typeof path !== 'string' || path.length === 0) return;
		let bucket = touchedBySession.get(session);
		if (bucket === undefined) {
			bucket = new Set();
			touchedBySession.set(session, bucket);
		}
		bucket.add(path);
	};

	if (resolved.trackTouches) {
		ctx.on('tools/result', (exec, result) => {
			if (result?.isError) return;
			const tool = exec?.name;
			if (tool !== 'read' && tool !== 'write' && tool !== 'edit') return;
			const filePath = exec?.arguments?.file_path;
			if (typeof filePath !== 'string') return;
			recordTouch(exec.agent?.session, filePath.trim());
		});
		ctx.on('fs/observed', (target, _observation, actor) => {
			const session = actor?.agent?.session;
			const displayPath = target?.displayPath;
			recordTouch(session, typeof displayPath === 'string' ? displayPath : undefined);
		});
	}

	// ── MCP 运行时：按开关临时挂载 `@deepseek-ai/dsh-mcp-client` ──────────────
	// MCP 是「工作区级」资产，但工具注册表是全局的：同一时刻只跟随最近活跃会话的
	// 工作目录，cwd 变化时重算一次（多开不同仓库时以最后一次对话为准）。
	/** 已挂载的 mcp-client 实例：id → { handle, detach }。 */
	const mcpRecords = new Map();
	/** 运行时连接状态：id → { state, reason }。 */
	const mcpStatuses = new Map();
	let mcpQueue = Promise.resolve();
	let mcpCwd;
	let mcpClientModule;

	/** 懒加载 mcp-client：加载失败只影响 MCP 页签，不拖垮整个插件。 */
	const loadMcpClient = async () => {
		mcpClientModule ??= await import('@deepseek-ai/dsh-mcp-client');
		return mcpClientModule;
	};

	/** 把 mcp-client 的状态单元同步到本地缓存。 */
	const publishStatus = (id, cell) => {
		try {
			const current = cell.current();
			mcpStatuses.set(id, { state: current?.state ?? 'connecting', reason: current?.reason ?? current?.error?.message });
		} catch {
			/* 状态单元不可读时保留上一次的快照 */
		}
	};

	/**
	 * 挂载一个 MCP server。
	 * @param server - `gatherMcp` 给出的 server。
	 * @returns 挂载完成的 Promise。
	 */
	const mountServer = async (server) => {
		let McpClient;
		try {
			McpClient = await loadMcpClient();
		} catch (error) {
			mcpStatuses.set(server.id, { state: 'failed', reason: `mcp-client unavailable: ${messageOf(error)}` });
			return;
		}
		const clientConfig = {
			transport: server.transport,
			serverName: server.serverName,
			failOnStartupError: false,
			expandTemplates: true,
			startupTimeoutMs: resolved.mcpStartupTimeoutMs,
		};
		if (server.transport === 'stdio') {
			clientConfig.command = server.command;
			clientConfig.args = server.args;
			clientConfig.env = server.env;
			if (server.cwd !== '') clientConfig.cwd = server.cwd;
		} else {
			clientConfig.url = server.url;
			clientConfig.headers = server.headers;
		}
		let handle;
		try {
			handle = ctx.plugin(McpClient, clientConfig);
		} catch (error) {
			mcpStatuses.set(server.id, { state: 'failed', reason: messageOf(error) });
			return;
		}
		const record = { id: server.id, handle, detach: undefined };
		mcpRecords.set(server.id, record);
		mcpStatuses.set(server.id, { state: 'connecting' });
		try {
			await handle.await();
			const cell = McpClient.connectionStatusOf?.(handle);
			if (cell !== undefined) {
				record.detach = cell.onChange?.(() => publishStatus(server.id, cell));
				publishStatus(server.id, cell);
			} else {
				mcpStatuses.set(server.id, { state: 'ready' });
			}
		} catch (error) {
			mcpStatuses.set(server.id, { state: 'failed', reason: messageOf(error) });
		}
	};

	/**
	 * 卸载一个已挂载的 server。
	 * @param record - 运行时记录。
	 * @returns 卸载完成的 Promise。
	 */
	const disposeRecord = async (record) => {
		try {
			record.detach?.();
		} catch {
			/* ignore */
		}
		try {
			await record.handle?.dispose();
		} catch (error) {
			ctx.logger.warn('cursor-toolkit: failed to dispose MCP server: %o', error);
		}
	};

	/**
	 * 对齐「该挂的」与「已挂的」：多退少补。
	 * @param cwd - 会话工作目录。
	 * @returns 对齐完成的 Promise。
	 */
	const syncMcp = async (cwd) => {
		if (!resolved.enableMcp) return;
		const absolute = resolve(cwd);
		const gathered = await gatherMcp(absolute, undefined);
		const wanted = new Map(
			gathered.servers.filter((server) => server.enabled).map((server) => [server.id, server]),
		);
		for (const [id, record] of [...mcpRecords]) {
			if (wanted.has(id)) continue;
			mcpRecords.delete(id);
			mcpStatuses.delete(id);
			await disposeRecord(record);
		}
		for (const [id, server] of wanted) {
			if (mcpRecords.has(id)) continue;
			await mountServer(server);
		}
		mcpCwd = absolute;
	};

	/**
	 * 串行排队一次 MCP 对齐（避免并发挂载同名 server 撞名）。
	 * @param cwd - 会话工作目录。
	 * @returns 队列尾部 Promise。
	 */
	const scheduleMcp = (cwd) => {
		mcpQueue = mcpQueue
			.then(() => syncMcp(cwd))
			.catch((error) => {
				ctx.logger.warn('cursor-toolkit: MCP sync failed: %o', error);
			});
		return mcpQueue;
	};

	ctx.effect(
		() => () => {
			for (const record of mcpRecords.values()) void disposeRecord(record);
			mcpRecords.clear();
			mcpStatuses.clear();
		},
		'cursor-toolkit: dispose MCP clients',
	);

	// ── 按需加载技能正文的工具 ────────────────────────────────────────────────
	ctx.inject(['tools'], (toolsCtx) => {
		toolsCtx.effect(() => {
			const disposer = toolsCtx.tools.register(
				defineTool({
					name: 'cursor_skill',
					description:
						'Load the full instructions of a Cursor skill (a SKILL.md under .cursor/skills). The skills available in the current workspace are listed in a system reminder with their names and descriptions; when a task matches one of them, call this tool with that skill name before starting the work, and follow the returned instructions.',
					parameters: {
						name: {
							type: 'string',
							required: true,
							description: 'Skill name exactly as listed in the available-skills reminder.',
						},
					},
					output: {
						schema: {
							type: 'object',
							additionalProperties: false,
							properties: {
								name: { type: 'string', required: true, description: 'Skill name.' },
								displayPath: { type: 'string', required: true, description: 'Skill file path shown to the user.' },
								files: {
									type: 'array',
									required: true,
									description: 'Supporting file names found next to SKILL.md.',
									items: { type: 'string' },
								},
								body: { type: 'string', required: true, description: 'Full skill instructions (SKILL.md without frontmatter).' },
							},
						},
					},
					execute: async (args, exec) => {
						exec.signal.throwIfAborted();
						const session = exec.agent?.session;
						const cwd = cwdOfSession(session);
						const gathered = await gather(cwd, exec.signal);
						const skillsResult = await gatherSkills(cwd, exec.signal, gathered.projectRoot);
						const wanted = String(args.name ?? '')
							.trim()
							.toLowerCase();
						const found = skillsResult.skills.find(
							(skill) => skill.name.toLowerCase() === wanted || skill.id.toLowerCase() === wanted,
						);
						if (found === undefined) {
							const available = skillsResult.skills.filter((skill) => skill.enabled).map((skill) => skill.name);
							throw new Error(
								`unknown Cursor skill "${args.name}". Available skills: ${available.length > 0 ? available.join(', ') : '(none)'}`,
							);
						}
						const text = await readFile(found.path, 'utf8');
						const { body } = splitFrontmatter(text);
						return { name: found.name, displayPath: found.displayPath, files: found.files, body };
					},
					render: (args, value) => [
						{ type: 'text', text: `Loaded Cursor skill "${value.name}" (${value.displayPath}).` },
					],
				}),
			);
			return () => {
				if (typeof disposer === 'function') disposer();
			};
		}, 'cursor-toolkit: cursor_skill tool');
	});

	ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
		const decision = await next();
		if (decision.kind === 'reject') return decision;
		const session = agent?.session;
		if (session === undefined) return decision;
		const cwd = cwdOfSession(session);
		if (resolved.enableMcp && mcpCwd !== resolve(cwd)) void scheduleMcp(cwd);
		const touched = resolved.trackTouches ? [...(touchedBySession.get(session) ?? [])] : [];
		const gathered = await gather(cwd, signal);
		signal?.throwIfAborted();
		const selection = selectRules(gathered.rules, touched, gathered.projectRoot);
		const previous = lastDeliveryState(decision.messages) ?? lastDeliveryState(agent.inbox?.nextStep) ?? deliveredBySession.get(session);
		const plan = planInjection({ selection, previous, maxBytes: resolved.maxBytes });

		let skillPlan = null;
		if (resolved.enableSkills) {
			const skillsResult = await gatherSkills(cwd, signal, gathered.projectRoot);
			signal?.throwIfAborted();
			skillPlan = planSkillCatalog({
				skills: skillsResult.skills,
				previousDigest: previous?.skillDigest,
				maxBytes: resolved.skillCatalogBytes,
			});
		}

		if (plan === null && skillPlan === null) return decision;
		const lastClaimedIndex = decision.messages.findLastIndex((message) => messages.includes(message));
		if (lastClaimedIndex < 0) return decision;
		const parts = [];
		if (plan !== null) parts.push(plan.text);
		if (skillPlan !== null) parts.push(skillPlan.text);
		const entries = plan?.entries ?? previous?.entries ?? [];
		const catalogDigest = plan?.catalogDigest ?? previous?.catalogDigest;
		const skillDigest = skillPlan?.digest ?? previous?.skillDigest;
		deliveredBySession.set(session, { entries, catalogDigest, skillDigest });
		const injected = createUserMessage({
			content: [{ type: 'text', text: parts.join('\n\n') }],
			source: {
				kind: SOURCE_KIND,
				form: plan !== null && skillPlan !== null ? 'mixed' : plan !== null ? 'rules' : 'skills',
				baseline: previous === undefined,
				entries,
				catalogDigest,
				skillDigest,
				changes: plan?.changes ?? [],
			},
		});
		return { ...decision, messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, injected) };
	});

	/**
	 * 解析请求对应的会话工作目录：优先宿主会话头，其次客户端上报，最后进程 cwd。
	 * @param sessionId - 查询参数里的会话 id。
	 * @param fallbackCwd - 查询参数里的 cwd。
	 * @returns 绝对工作目录。
	 */
	const cwdOf = (sessionId, fallbackCwd) => {
		if (typeof sessionId === 'string' && sessionId.length > 0) {
			try {
				const session = ctx.get('sessions')?.get(sessionId);
				const cwd = session?.header?.cwd;
				if (typeof cwd === 'string' && cwd.length > 0) return cwd;
			} catch {
				/* 会话不存在时退回客户端上报值 */
			}
		}
		if (typeof fallbackCwd === 'string' && fallbackCwd.length > 0 && isAbsolute(fallbackCwd)) return fallbackCwd;
		return process.cwd();
	};

	/**
	 * 组装面板快照：规则 / 技能 / MCP 一次取全，前端三个页签共用一次请求。
	 * @param cwd - 会话工作目录。
	 * @returns 快照对象。
	 */
	const snapshot = async (cwd) => {
		const absolute = resolve(cwd);
		const gathered = await gather(absolute, undefined);
		const skillsResult = resolved.enableSkills
			? await gatherSkills(absolute, undefined, gathered.projectRoot)
			: { skills: [], warnings: [] };
		const mcpResult = resolved.enableMcp
			? await gatherMcp(absolute, undefined, gathered.projectRoot)
			: { servers: [], warnings: [] };
		return {
			version: PLUGIN_VERSION,
			cwd: gathered.cwd,
			projectRoot: gathered.projectRoot,
			warnings: [...gathered.warnings, ...skillsResult.warnings, ...mcpResult.warnings],
			rules: gathered.rules.map((rule) => rulePayload(rule, false)),
			skills: skillsResult.skills.map(skillPayload),
			mcp: mcpResult.servers.map((server) => mcpPayload(server, mcpStatuses.get(server.id))),
			features: { rules: true, skills: resolved.enableSkills, mcp: resolved.enableMcp },
			statePath: resolved.statePath,
			maxBytes: resolved.maxBytes,
			skillCatalogBytes: resolved.skillCatalogBytes,
		};
	};

	/**
	 * 切换某一类资产的开关并落盘。
	 * @param kind - `rule` / `skill` / `mcp`。
	 * @param id - 资产 id。
	 * @param enabled - 目标开关状态。
	 * @returns 更新后的状态。
	 */
	const applyToggle = async (kind, id, enabled) => {
		const current = await state();
		const next = {
			disabled: new Set(current.disabled),
			skillsDisabled: new Set(current.skillsDisabled),
			mcpEnabled: new Set(current.mcpEnabled),
		};
		if (kind === 'mcp') {
			if (enabled) next.mcpEnabled.add(id);
			else next.mcpEnabled.delete(id);
		} else {
			const target = kind === 'skill' ? next.skillsDisabled : next.disabled;
			if (enabled) target.delete(id);
			else target.add(id);
		}
		stateCache = {
			disabled: [...next.disabled],
			skillsDisabled: [...next.skillsDisabled],
			mcpEnabled: [...next.mcpEnabled],
		};
		await writeState(resolved.statePath, stateCache);
		return stateCache;
	};

	const handler = async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://localhost');
		const route = url.pathname.slice(resolved.httpPath.length).replace(/^\/+/, '');
		try {
			if (request.method === 'GET' && (route === '' || route === 'rules')) {
				const cwd = cwdOf(url.searchParams.get('sessionId') ?? undefined, url.searchParams.get('cwd') ?? undefined);
				sendJson(response, 200, await snapshot(cwd));
				return;
			}
			if (request.method === 'GET' && route === 'rule') {
				const cwd = cwdOf(url.searchParams.get('sessionId') ?? undefined, url.searchParams.get('cwd') ?? undefined);
				const id = url.searchParams.get('id');
				const gathered = await gather(resolve(cwd), undefined);
				const found = gathered.rules.find((rule) => rule.id === id);
				if (found === undefined) {
					sendJson(response, 404, { error: 'unknown rule', id });
					return;
				}
				sendJson(response, 200, { rule: rulePayload(found, true) });
				return;
			}
			if (request.method === 'GET' && route === 'skill') {
				const cwd = cwdOf(url.searchParams.get('sessionId') ?? undefined, url.searchParams.get('cwd') ?? undefined);
				const id = url.searchParams.get('id');
				const gathered = await gatherSkills(resolve(cwd), undefined);
				const found = gathered.skills.find((skill) => skill.id === id);
				if (found === undefined) {
					sendJson(response, 404, { error: 'unknown skill', id });
					return;
				}
				const text = await readFile(found.path, 'utf8');
				const { body } = splitFrontmatter(text);
				sendJson(response, 200, { skill: { ...skillPayload(found), body } });
				return;
			}
			if (request.method === 'GET' && route === 'mcp') {
				const cwd = cwdOf(url.searchParams.get('sessionId') ?? undefined, url.searchParams.get('cwd') ?? undefined);
				const id = url.searchParams.get('id');
				const gathered = await gatherMcp(resolve(cwd), undefined);
				const found = gathered.servers.find((server) => server.id === id);
				if (found === undefined) {
					sendJson(response, 404, { error: 'unknown mcp server', id });
					return;
				}
				sendJson(response, 200, { server: mcpPayload(found, mcpStatuses.get(found.id)) });
				return;
			}
			if (request.method === 'POST' && route === 'toggle') {
				const body = JSON.parse((await readRequestBody(request)) || '{}');
				const id = body?.id;
				if (typeof id !== 'string' || id.length === 0) {
					sendJson(response, 400, { error: 'id is required' });
					return;
				}
				const kind = body?.kind === 'skill' || body?.kind === 'mcp' ? body.kind : 'rule';
				const enabled = body?.enabled !== false;
				await applyToggle(kind, id, enabled);
				const cwd = cwdOf(body?.sessionId ?? undefined, body?.cwd ?? undefined);
				if (kind === 'mcp' && resolved.enableMcp) await scheduleMcp(cwd);
				sendJson(response, 200, await snapshot(cwd));
				return;
			}
			sendJson(response, 404, { error: 'not found', route });
		} catch (error) {
			ctx.logger.warn('cursor-toolkit request failed: %o', error);
			sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	};
	// ── 浏览器面板使用的只读 JSON 接口 ────────────────────────────────────────
	// 注册放在 apply 末尾：`ctx.inject` 的回调可能在本函数体执行完之前就同步触发（webServer 已就绪时），
	// 若注册语句写在 `handler` 定义之前会踩到 TDZ。
	// `webServer` 是可选增强，但**必须**用 `ctx.inject` 等待它，不能一次性 `ctx.get`：
	// 冷启动时本插件的 apply 可能早于 webServer 就绪（`inject = []` 不阻塞），
	// 一次性读取会拿到 undefined 并静默跳过注册；热插拔时又恰好已经就绪，
	// 从而出现「热装能用、重启后 404」的假象。`ctx.inject` 会在服务可用时注册，
	// 并在 webServer 被替换后自动重新注册（DSH 的 webServer 生命周期允许被替换）。
	ctx.inject(['webServer'], (webCtx) => {
		webCtx.effect(
			() =>
				webCtx.webServer.register({
					kind: 'prefix',
					path: resolved.httpPath,
					handler,
				}),
			'cursor-toolkit: http route',
		);
	});
}
