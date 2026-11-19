/**
 * 宿主半边（`lib/index.js`）的接线冒烟测试。
 *
 * `lib/index.js` 依赖 asar 内的平台包（`@deepseek-ai/dsh-llm` 等），普通 node 进程解析不到，
 * 因此这里用 `module.register` 装一层解析钩子，把这些私有依赖替换成最小桩，
 * 然后用一个假 Cordis 上下文跑完 `apply()`：路由、工具注册、开关落盘、MCP 挂载与注入时序。
 *
 * 它不验证平台行为（桩就是桩），只验证本插件自己的接线不崩、形状对。
 *
 * 用法：
 *   node test/host.mjs
 */

import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STUBS = {
	'@deepseek-ai/dsh-home-paths': 'export function resolveDshHome() { return process.env.DSH_STUB_HOME; }',
	'@deepseek-ai/dsh-llm': 'export function createUserMessage(input) { return { role: "user", ...input }; }',
	'@deepseek-ai/dsh-tools': 'export function defineTool(definition) { return definition; }',
	'@deepseek-ai/dsh-mcp-client': [
		'export const name = "dsh-mcp-client";',
		'export const inject = ["tools"];',
		'export function apply() {}',
		'export function Config(value) { return value; }',
		'export function connectionStatusOf() { return { current: () => ({ state: "ready" }), onChange: () => () => {} }; }',
	].join('\n'),
	'@deepseek-ai/schemastery': [
		'const chain = () => { const self = {};',
		'  for (const key of ["default", "step", "min", "max", "description", "optional"]) self[key] = () => (key === "default" ? chain() : self);',
		'  return self; };',
		'export default { boolean: chain, number: chain, string: chain, array: chain, object: () => chain() };',
	].join('\n'),
};

const HOOKS = `
const STUBS = ${JSON.stringify(STUBS)};
export function resolve(specifier, context, next) {
	if (Object.hasOwn(STUBS, specifier)) {
		return { url: 'data:text/javascript;charset=utf-8,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
	}
	return next(specifier, context);
}
`;

const root = await mkdtemp(join(tmpdir(), 'dsh-cursor-host-'));
process.env.DSH_STUB_HOME = join(root, 'home');
const workspace = join(root, 'repo');
await mkdir(join(workspace, '.git'), { recursive: true });
await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true });
await mkdir(join(workspace, '.cursor', 'skills', 'prd-skill'), { recursive: true });
await writeFile(join(workspace, '.cursor', 'rules', 'global.mdc'), '---\ndescription: 全局规范\nalwaysApply: true\n---\nGLOBAL-BODY\n');
await writeFile(join(workspace, '.cursor', 'rules', 'api.mdc'), '---\nglobs: src/**/*.js\nalwaysApply: false\n---\nAPI-BODY\n');
await writeFile(join(workspace, '.cursor', 'skills', 'prd-skill', 'SKILL.md'), '---\nname: prd-skill\ndescription: 写 PRD 时使用\n---\nPRD-BODY\n');
await writeFile(
	join(workspace, '.cursor', 'mcp.json'),
	'{ // JSONC\n  "mcpServers": { "mysql": { "command": "npx", "args": ["-y", "mysql-mcp"], "env": { "MYSQL_URL": "secret" } }, }\n}',
);

register(`data:text/javascript;charset=utf-8,${encodeURIComponent(HOOKS)}`);

const plugin = await import(pathToFileURL(new URL('../lib/index.js', import.meta.url).pathname).href);
assert.equal(typeof plugin.apply, 'function');
assert.notEqual(plugin.Config, undefined);

/** 假 Cordis 上下文：记录注册项，供断言使用。 */
function makeCtx() {
	const ctx = {
	logger: { warn() {}, info() {}, debug() {} },
	events: new Map(),
	effects: [],
	plugins: [],
	routes: [],
	tools: {
		list: [],
		register(definition) {
			this.list.push(definition);
			return () => {};
		},
	},
	webServer: {
		register(route) {
			ctx.routes.push(route);
			return () => {};
		},
	},
	get(name) {
		if (name === 'sessions') return { get: (id) => (id === 's1' ? { header: { cwd: workspace } } : undefined) };
		return undefined;
	},
	on(event, listener) {
		this.events.set(event, listener);
		return () => {};
	},
	effect(factory, label) {
		const cleanup = factory();
		this.effects.push({ label, cleanup });
		return cleanup;
	},
	inject(_dependencies, callback) {
		callback(this);
	},
	plugin(module, config) {
		this.plugins.push({ module, config });
		return { await: async () => {}, dispose: async () => {} };
	},
	};
	return ctx;
}

/** 轮询等待一个异步条件成立（apply() 里的清理是 fire-and-forget）。 */
async function waitFor(predicate, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return true;
		await new Promise((done) => setTimeout(done, 20));
	}
	return false;
}

const ctx = makeCtx();

plugin.apply(ctx, {
	stateFile: join(root, 'state.json'),
	userRuleDirs: [],
	userSkillDirs: [],
	userMcpFiles: [],
});

assert.equal(ctx.routes.length, 1, '应注册一条面板路由');
assert.equal(ctx.routes[0].kind, 'prefix');
assert.equal(ctx.tools.list.length, 1, '应注册 cursor_skill 工具');
assert.equal(ctx.tools.list[0].name, 'cursor_skill');
assert.ok(ctx.events.has('agent/pre-step'));

/** 调一次面板路由，返回状态码与响应体。 */
const callOn = async (target, method, url, body) => {
	const chunk = body === undefined ? undefined : JSON.stringify(body);
	const request = {
		method,
		url,
		async *[Symbol.asyncIterator]() {
			if (chunk !== undefined) yield Buffer.from(chunk);
		},
	};
	let status = 0;
	let payload;
	const response = {
		writeHead(code) {
			status = code;
		},
		end(text) {
			payload = JSON.parse(text);
		},
	};
	await target.routes[0].handler(request, response);
	return { status, payload };
};

const call = (method, url, body) => callOn(ctx, method, url, body);

const snapshot = await call('GET', '/cursor-toolkit/rules?sessionId=s1');
assert.equal(snapshot.status, 200);
assert.equal(snapshot.payload.version, '2.1.0');
assert.deepEqual(snapshot.payload.rules.map((rule) => rule.id).sort(), ['.cursor/rules/api.mdc', '.cursor/rules/global.mdc']);
assert.equal(snapshot.payload.skills.length, 1);
assert.equal(snapshot.payload.mcp.length, 1);
assert.equal(snapshot.payload.mcp[0].enabled, false, 'MCP 默认关闭');
assert.equal(snapshot.payload.mcp[0].serverName, 'cursor_mysql');
assert.deepEqual(snapshot.payload.mcp[0].envKeys, ['MYSQL_URL']);
assert.equal(JSON.stringify(snapshot.payload.mcp[0]).includes('secret'), false, '凭据值不得出现在面板数据里');
assert.deepEqual(snapshot.payload.features, { rules: true, skills: true, mcp: true });

const skill = await call('GET', '/cursor-toolkit/skill?id=skill:project:prd-skill&sessionId=s1');
assert.equal(skill.status, 200);
assert.equal(skill.payload.skill.body.trim(), 'PRD-BODY');

const off = await call('POST', '/cursor-toolkit/toggle', { kind: 'skill', id: 'skill:project:prd-skill', enabled: false, sessionId: 's1' });
assert.equal(off.payload.skills[0].enabled, false);
assert.deepEqual(JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).skillsDisabled, ['skill:project:prd-skill']);

const on = await call('POST', '/cursor-toolkit/toggle', { kind: 'mcp', id: 'mcp:project:mysql', enabled: true, sessionId: 's1' });
assert.equal(on.payload.mcp[0].enabled, true);
assert.equal(on.payload.mcp[0].status, 'ready');
assert.equal(ctx.plugins.length, 1, '打开开关后才挂载 mcp-client');
assert.equal(ctx.plugins[0].config.serverName, 'cursor_mysql');
assert.equal(ctx.plugins[0].config.transport, 'stdio');

await call('POST', '/cursor-toolkit/toggle', { kind: 'skill', id: 'skill:project:prd-skill', enabled: true, sessionId: 's1' });

const preStep = ctx.events.get('agent/pre-step');
const history = [{ role: 'user', content: 'hi' }];
const first = await preStep(
	{ agent: { session: { id: 's1', header: { cwd: workspace } }, inbox: {} }, messages: history, signal: undefined },
	async () => ({ kind: 'enter', messages: [...history] }),
);
const injected = first.messages.at(-1);
assert.equal(injected.role, 'user');
assert.equal(injected.source.kind, 'cursor-toolkit');
const text = injected.content[0].text;
assert.ok(text.includes('GLOBAL-BODY'), '基线应包含 alwaysApply 规则正文');
assert.ok(text.includes('cursor_skill'), '应包含技能目录与按需加载提示');
assert.ok(text.includes('- prd-skill — 写 PRD 时使用'));
assert.equal(text.includes('PRD-BODY'), false, '技能正文不应预载');

const second = await preStep(
	{ agent: { session: { id: 's1', header: { cwd: workspace } }, inbox: {} }, messages: first.messages, signal: undefined },
	async () => ({ kind: 'enter', messages: [...first.messages] }),
);
assert.equal(second.messages.length, first.messages.length, '内容未变化时不应重复注入');

// ── 改名后的状态文件兼容：旧文件名 cursor-rules.json 仍要被读到 ──────────
await mkdir(join(root, 'home'), { recursive: true });
await writeFile(
	join(root, 'home', 'cursor-rules.json'),
	JSON.stringify({ version: 2, disabled: ['.cursor/rules/global.mdc'], skillsDisabled: ['skill:project:prd-skill'], mcpEnabled: [] }),
);
const legacyCtx = makeCtx();
plugin.apply(legacyCtx, { stateFile: 'cursor-toolkit.json', userRuleDirs: [], userSkillDirs: [], userMcpFiles: [] });
const migrated = await callOn(legacyCtx, 'GET', '/cursor-toolkit/rules?sessionId=s1');
assert.equal(migrated.status, 200);
assert.equal(
	migrated.payload.rules.find((rule) => rule.id === '.cursor/rules/global.mdc').enabled,
	false,
	'旧 cursor-rules.json 里的关闭状态要继承下来',
);
assert.equal(migrated.payload.skills[0].enabled, false, '旧文件里的技能开关也要继承');
assert.equal(migrated.payload.statePath, join(root, 'home', 'cursor-toolkit.json'));
for (const entry of legacyCtx.effects) if (typeof entry.cleanup === 'function') await entry.cleanup();

// ── 旧 dsh-cursor-mode 受管块：摘掉 + 备份 + 幂等 ──────────────────────────
const legacyPatch = join(root, 'profile', 'cordis.patch.yml');
await mkdir(dirname(legacyPatch), { recursive: true });
await writeFile(
	legacyPatch,
	[
		'# profile patch',
		'- insert:',
		'    - id: keep-me',
		'      name: keep-me',
		'',
		'# >>> dsh-cursor-mode (managed block) >>>',
		'- insert:',
		'    - id: preset-cursor',
		"      name: '@deepseek-ai/dsh-agent-preset'",
		'# <<< dsh-cursor-mode <<<',
		'',
		'# tail comment',
		'',
	].join('\n'),
);
const migratedOnce = await plugin.migrateLegacyPreset(legacyPatch);
assert.equal(migratedOnce.migrated, true, '带标记的受管块应被移除');
const cleanedPatch = await readFile(legacyPatch, 'utf8');
assert.ok(cleanedPatch.includes('id: keep-me'), '受管块之外的配置行要原样保留');
assert.ok(cleanedPatch.includes('# tail comment'), '块后面的注释也要保留');
assert.ok(!cleanedPatch.includes('preset-cursor'), '旧预设行必须消失');
assert.ok(cleanedPatch.includes('# profile patch'));
assert.ok((await readFile(migratedOnce.backupPath, 'utf8')).includes('preset-cursor'), '备份里应留着移除前的内容');
const migratedAgain = await plugin.migrateLegacyPreset(legacyPatch);
assert.equal(migratedAgain.migrated, false, '第二次调用应当无事可做');
assert.equal(migratedAgain.reason, 'absent');

// 没有标记、只剩手写的 preset-cursor 行：只报信号，不动文件（YAML 结构不明）
const barePatch = join(root, 'profile', 'bare.patch.yml');
await writeFile(barePatch, '- insert:\n    - id: preset-cursor\n      name: x\n');
const bareResult = await plugin.migrateLegacyPreset(barePatch);
assert.equal(bareResult.migrated, false);
assert.equal(bareResult.reason, 'unmarked-row');
assert.ok((await readFile(barePatch, 'utf8')).includes('preset-cursor'), '手写行不能被自动删除');

// 走一遍 apply()：profileContext 指向带受管块的补丁时，启动即自动清理
const migratePatch = join(root, 'profile', 'auto.patch.yml');
await writeFile(
	migratePatch,
	['# >>> dsh-cursor-mode (managed block) >>>', '- insert:', '    - id: preset-cursor', '# <<< dsh-cursor-mode <<<', ''].join('\n'),
);
const autoCtx = makeCtx();
autoCtx.profileContext = { patchPath: migratePatch };
plugin.apply(autoCtx, { stateFile: join(root, 'state-auto.json'), userRuleDirs: [], userSkillDirs: [], userMcpFiles: [] });
assert.ok(await waitFor(async () => !(await readFile(migratePatch, 'utf8')).includes('preset-cursor')), 'apply() 应自动清掉旧受管块');
for (const entry of autoCtx.effects) if (typeof entry.cleanup === 'function') await entry.cleanup();


for (const entry of ctx.effects) if (typeof entry.cleanup === 'function') await entry.cleanup();
await rm(root, { recursive: true, force: true });

console.log('宿主半边接线通过：路由 / cursor_skill 工具 / 开关落盘 / MCP 挂载 / 注入与去重 / 旧受管块迁移。');
