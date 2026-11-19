/**
 * 浏览器半边（`lib/client.js`）的接线测试。
 *
 * 这个文件是**手写**的客户端包（没有构建步骤），平台只在浏览器里执行它，
 * `node --check` 只能查语法、查不出「引用了不存在的标识符」这类问题
 * （2.0.0 就因此整块 UI 不出现：`apply()` 里 `inject` / `PANEL_ID` 未定义）。
 *
 * 所以这里用一个极小的 React 替身把组件树真跑一遍：
 * 支持 `useState` / `useEffect` / `useMemo` / `useCallback` / `useRef` 五种钩子、
 * 按调用顺序保存状态、effect 在渲染后执行、setState 触发重渲染（最多 5 轮），
 * `fetch` 换成返回固定快照的桩。断言的是「不抛错、树上出现预期文本、点页签能换到另一组内容」。
 *
 * 用法：
 *   node test/client.mjs
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// ── 快照桩：三类资产各给两条，覆盖开/关、stdio/http、就绪/失败 ──────────────

const snapshot = {
	version: '2.2.0',
	cwd: '/tmp/ws',
	projectRoot: '/tmp/ws',
	maxBytes: 131072,
	skillCatalogBytes: 8192,
	statePath: '/tmp/ws/state.json',
	warnings: [],
	features: { rules: true, mcp: true, skills: true },
	rules: [
		{
			id: '~/.dsh/rules/agent-behavior.mdc',
			displayPath: '~/.dsh/rules/agent-behavior.mdc',
			scope: 'user',
			type: 'always',
			alwaysApply: true,
			globs: [],
			description: '全局行为规范',
			bytes: 7279,
			enabled: true,
		},
		{
			id: '.cursor/rules/api.mdc',
			displayPath: '.cursor/rules/api.mdc',
			scope: 'project',
			type: 'auto',
			alwaysApply: false,
			globs: ['src/**/*.js'],
			description: '接口约定',
			bytes: 812,
			enabled: false,
		},
	],
	skills: [
		{
			id: 'skill:project:prd-skill',
			name: 'prd-skill',
			description: '写 PRD 时使用',
			scope: 'project',
			displayPath: '.cursor/skills/prd-skill/SKILL.md',
			bytes: 1024,
			files: ['README.md', 'phases'],
			license: 'MIT',
			enabled: true,
		},
		{
			id: 'skill:user:ui-skill',
			name: 'ui-skill',
			description: '生成静态原型',
			scope: 'user',
			displayPath: '~/.cursor/skills/ui-skill/SKILL.md',
			bytes: 2048,
			files: [],
			license: undefined,
			enabled: false,
		},
	],
	mcp: [
		{
			id: 'mcp:project:mysql',
			name: 'mysql',
			serverName: 'cursor_mysql',
			scope: 'project',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', 'mysql-mcp'],
			envKeys: ['MYSQL_URL'],
			headersKeys: [],
			url: '',
			displayPath: '.cursor/mcp.json',
			enabled: true,
			status: 'ready',
			reason: undefined,
		},
		{
			id: 'mcp:user:apifox',
			name: 'apifox文档',
			serverName: 'cursor_apifox',
			scope: 'user',
			transport: 'streamable-http',
			command: '',
			args: [],
			envKeys: [],
			headersKeys: ['Authorization'],
			url: 'https://example.invalid/mcp',
			displayPath: '~/.cursor/mcp.json',
			enabled: false,
			status: 'failed',
			reason: 'connect ECONNREFUSED',
		},
	],
};

// ── 极小 React 替身 ───────────────────────────────────────────────────────

const buckets = new Map();
const pendingEffects = [];
const seenElements = [];
let texts = [];
let bucket;
let sequence = 0;
let dirty = false;

/** 每轮渲染重置位置计数与待执行 effect。 */
function beginPass() {
	sequence = 0;
	pendingEffects.length = 0;
	seenElements.length = 0;
	texts = [];
}

/** 按「组件名 + 本轮访问序号」定位状态桶，保证多轮渲染之间状态可复用。 */
function enterComponent(name) {
	const key = `${name}#${String(sequence++)}`;
	let record = buckets.get(key);
	if (record === undefined) {
		record = { cells: [] };
		buckets.set(key, record);
	}
	record.index = 0;
	const outer = bucket;
	bucket = record;
	return outer;
}

function useState(initial) {
	const record = bucket;
	const index = record.index++;
	if (!(index in record.cells)) record.cells[index] = typeof initial === 'function' ? initial() : initial;
	const setState = (next) => {
		const value = typeof next === 'function' ? next(record.cells[index]) : next;
		if (Object.is(value, record.cells[index])) return;
		record.cells[index] = value;
		dirty = true;
	};
	return [record.cells[index], setState];
}

function sameDeps(previous, next) {
	if (previous === undefined || next === undefined || previous.length !== next.length) return false;
	return previous.every((value, index) => Object.is(value, next[index]));
}

function useEffect(factory, deps) {
	const record = bucket;
	const index = record.index++;
	const previous = record.cells[index];
	if (sameDeps(previous?.deps, deps)) return;
	record.cells[index] = { deps, cleanup: previous?.cleanup };
	pendingEffects.push({ record, index, factory });
}

function useMemo(factory, deps) {
	const record = bucket;
	const index = record.index++;
	const previous = record.cells[index];
	if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value;
	const value = factory();
	record.cells[index] = { deps, value };
	return value;
}

function useCallback(callback, deps) {
	return useMemo(() => callback, deps);
}

function useRef(initial) {
	const record = bucket;
	const index = record.index++;
	if (!(index in record.cells)) record.cells[index] = { current: initial };
	return record.cells[index];
}

const react = { useState, useEffect, useMemo, useCallback, useRef };

/** 渲染一个元素树：函数组件就地调用，宿主元素只收集文本与元素，不碰 DOM。 */
function renderTree(node) {
	if (node === null || node === undefined || node === false || node === true) return;
	if (Array.isArray(node)) {
		for (const item of node) renderTree(item);
		return;
	}
	if (typeof node === 'string' || typeof node === 'number') {
		texts.push(String(node));
		return;
	}
	if (typeof node !== 'object') return;
	const { type, props } = node;
	if (typeof type === 'function') {
		seenElements.push({ type, props: props ?? {} });
		const name = type.name === '' ? 'anonymous' : type.name;
		const outer = enterComponent(name);
		try {
			renderTree(type(props ?? {}));
		} catch (error) {
			throw new Error(`组件 ${name} 渲染失败：${error instanceof Error ? error.message : String(error)}`);
		} finally {
			bucket = outer;
		}
		return;
	}
	if (typeof type === 'string') {
		seenElements.push({ type, props: props ?? {} });
		renderTree((props ?? {}).children);
	}
}

/** 执行本轮收集到的 effect，并把返回的 cleanup 记回状态桶。 */
async function runEffects() {
	for (const { record, index, factory } of pendingEffects) {
		const cell = record.cells[index];
		if (typeof cell.cleanup === 'function') await cell.cleanup();
		const cleanup = await factory();
		if (typeof cleanup === 'function') cell.cleanup = cleanup;
	}
	await new Promise((resolve) => setImmediate(resolve));
}

/** 反复渲染直到没有 setState，返回本轮所有文本与元素。 */
async function render(component, props) {
	for (let pass = 0; pass < 5; pass += 1) {
		beginPass();
		dirty = false;
		renderTree({ type: component, props });
		await runEffects();
		if (!dirty) break;
	}
	return { text: texts.join(' | '), elements: seenElements.map((element) => ({ ...element })) };
}

// ── fetch 桩：读快照 / 读技能正文 / 切开关 ────────────────────────────────

const toggles = [];
globalThis.fetch = async (input, options = {}) => {
	const url = new URL(String(input), 'http://127.0.0.1');
	const respond = (payload) => ({ ok: true, status: 200, json: async () => payload });
	if ((options.method ?? 'GET') === 'POST') {
		const body = JSON.parse(String(options.body));
		toggles.push(body);
		const flip = (items) => items.map((item) => (item.id === body.id ? { ...item, enabled: body.enabled } : item));
		return respond({
			...snapshot,
			rules: body.kind === 'rule' ? flip(snapshot.rules) : snapshot.rules,
			skills: body.kind === 'skill' ? flip(snapshot.skills) : snapshot.skills,
			mcp: body.kind === 'mcp' ? flip(snapshot.mcp) : snapshot.mcp,
		});
	}
	if (url.pathname.endsWith('/skill')) {
		return respond({ skill: { ...snapshot.skills[0], body: 'SKILL-BODY' } });
	}
	return respond(snapshot);
};

// ── 载入客户端包并执行 apply ──────────────────────────────────────────────

const registered = new Map();
let dictionaries;

const ctx = {
	effect(factory) {
		return factory();
	},
	locale: {
		register(namespace, dicts) {
			dictionaries = dicts;
			return () => {};
		},
		bind() {
			return (key, vars) => {
				const template = dictionaries?.zh?.[key] ?? key;
				return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? `{${name}}`));
			};
		},
	},
	slots: {
		inject(_name, callback) {
			callback();
			return () => {};
		},
		register(config, component) {
			registered.set(config.name, { config, component });
			return () => {};
		},
	},
	inject(_dependencies, callback) {
		callback({ layout: { panelInfo: { getSnapshot: () => ({ activePanelId: undefined }) }, selectPanel() {} } });
		return () => {};
	},
};

let loaded;
globalThis.window = {
	__ModuleLoader__: {
		load(module) {
			loaded = module;
		},
	},
};

await import(pathToFileURL(new URL('../lib/client.js', import.meta.url).pathname).href);
assert.notEqual(loaded, undefined, '客户端包应以 window.__ModuleLoader__.load 注册自己');
assert.equal(loaded.id, 'dsh-cursor-toolkit');

const requireStub = (specifier) => {
	if (specifier === 'react') return react;
	if (specifier === 'react/jsx-runtime') {
		return {
			jsx: (type, props) => ({ type, props }),
			jsxs: (type, props) => ({ type, props }),
			Fragment: 'fragment',
		};
	}
	if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
		// 平台组件按「能透出可见文本」的方式桩起来：MarkdownText 等把正文放在
		// text / content 属性里，不是 children。
		const Stub = function Primitive(props) {
			return props?.children ?? props?.text ?? props?.content ?? null;
		};
		return new Proxy({}, { get: () => Stub });
	}
	throw new Error(`客户端包 require 了未预期的模块：${specifier}`);
};

const module = loaded.factory(requireStub);
assert.equal(typeof module.apply, 'function');
module.apply(ctx);

assert.deepEqual(module.inject, ['slots', 'locale', 'sessions']);
assert.deepEqual(
	[...registered.keys()].sort(),
	['main', 'settings.section', 'sidebar.panellist'],
	'应注册设置分节、左栏导航行与主面板三处 slot',
);
assert.equal(registered.get('main').config.key, 'cursor-toolkit');
assert.equal(registered.get('sidebar.panellist').config.id, 'cursor-toolkit');
assert.equal(registered.get('settings.section').config.id, 'cursor-toolkit');
assert.equal(registered.get('sidebar.panellist').config.order, 30);

// ── 渲染整页：规则页签 → 点 MCP 页签 → 点技能页签 ────────────────────────

const page = registered.get('main').component;
const firstPass = await render(page, { t: ctx.locale.bind('cursor-toolkit') });
assert.ok(firstPass.text.includes('agent-behavior.mdc'), '规则页签应列出规则文件');
assert.ok(firstPass.text.includes('始终生效'), '规则页签应给出规则类型标签');
assert.ok(firstPass.text.includes('/tmp/ws/state.json'), '页脚应显示状态文件位置');

/** 找到页签按钮（按 className 里的 dsrc-tab 定位）。 */
const tabButtons = (elements) => elements.filter((element) => element.type === 'button' && String(element.props.className ?? '').includes('dsrc-tab'));
const tabs = tabButtons(firstPass.elements);
assert.equal(tabs.length, 3, '应有规则 / MCP / 技能三个页签');

tabs[1].props.onClick();
const mcpPass = await render(page, { t: ctx.locale.bind('cursor-toolkit') });
assert.ok(mcpPass.text.includes('cursor_mysql'), 'MCP 页签应显示归一化后的 server 名');
assert.ok(mcpPass.text.includes('MYSQL_URL'), 'MCP 页签应显示 env 键名');
assert.equal(mcpPass.text.includes('secret'), false);

const skillTabs = tabButtons(mcpPass.elements);
skillTabs[2].props.onClick();
const skillPass = await render(page, { t: ctx.locale.bind('cursor-toolkit') });
assert.ok(skillPass.text.includes('prd-skill'), '技能页签应列出技能名');
assert.ok(skillPass.text.includes('写 PRD 时使用'), '技能页签应显示描述');
const openButton = skillPass.elements.find(
	(element) => typeof element.props.onClick === 'function' && String(element.props.children ?? '') === '查看',
);
assert.notEqual(openButton, undefined, '技能行应有「查看」按钮');
openButton.props.onClick();
const bodyPass = await render(page, { t: ctx.locale.bind('cursor-toolkit') });
assert.ok(bodyPass.text.includes('SKILL-BODY'), '技能正文应就地展开');

// ── 设置分节与左栏图标也要能渲染 ─────────────────────────────────────────

const section = registered.get('settings.section').component;
const useSessionsStub = (selector) => selector({ byId: { s1: { cwd: '/tmp/ws' } }, current: 's1' }) ?? 's1';
const sectionPass = await render(section, { t: ctx.locale.bind('cursor-toolkit'), useSessions: useSessionsStub });
assert.ok(sectionPass.text.includes('agent-behavior.mdc'), '设置分节应复用同一个面板');

const icon = registered.get('sidebar.panellist').component;
const iconPass = await render(icon, { size: 16 });
assert.ok(
	iconPass.elements.some((element) => element.props.size === 16),
	'导航行应把侧边栏给的尺寸透给图标',
);

// ── 关掉开关会打到宿主接口 ───────────────────────────────────────────────

assert.equal(toggles.length, 0, '渲染过程不应自行切换开关');
const switched = await render(page, { t: ctx.locale.bind('cursor-toolkit') });
const switches = switched.elements.filter((element) => typeof element.props.onChange === 'function' && 'checked' in element.props);
assert.ok(switches.length > 0, '规则 / MCP / 技能行都应带开关');
switches[0].props.onChange(!snapshot.mcp[0].enabled);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(toggles.length, 1, '切换开关应打一次 toggle 接口');
assert.equal(toggles[0].kind, 'skill', '技能页签上的开关应带上 kind=skill');
assert.equal(toggles[0].id, 'skill:user:ui-skill');

// ── 静态一致性：词条键与样式类不能悬空 ───────────────────────────────────

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const dictionaryKeys = (language) => {
	const start = source.indexOf(`const ${language} = {`);
	const end = source.indexOf('\n\t\t};', start);
	return new Set([...source.slice(start, end).matchAll(/^\t\t\t([A-Za-z_$][\w$]*):/gm)].map((match) => match[1]));
};
const zhKeys = dictionaryKeys('zh');
const enKeys = dictionaryKeys('en');
for (const match of source.matchAll(/\bt\(\s*"([^"]+)"/g)) {
	assert.ok(zhKeys.has(match[1]), `zh 词典缺词条：${match[1]}`);
	assert.ok(enKeys.has(match[1]), `en 词典缺词条：${match[1]}`);
}
const styleStart = source.indexOf('const STYLE_TEXT = `');
const styleText = source.slice(styleStart, source.indexOf('`;', styleStart));
const styled = new Set([...styleText.matchAll(/\$\{CLS\}-([\w-]+)/g)].map((match) => match[1]));
for (const match of source.matchAll(/\$\{CLS\}-([\w-]+)/g)) {
	// `${CLS}-dot-${tone}` 这类动态后缀只能校验到前缀，跳过。
	if (match[1].endsWith('-')) continue;
	assert.ok(styled.has(match[1]), `样式表缺类：dsrc-${match[1]}`);
}

console.log('浏览器半边接线通过：三处 slot 注册 / 三个页签 / 规则·MCP·技能渲染 / 就地展开 / 开关回调 / 词条与样式类无悬空。');
