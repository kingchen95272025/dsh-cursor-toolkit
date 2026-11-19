/**
 * 内置「Cursor 模式」预设的形状校验。
 *
 * 预设是一份 YAML：装错一个包名、写漏一行工具、或者把旧版失效的配置项抄回来，
 * 表现都是「选了这个模式之后工具面少东西」这类安静的错误。这里对着 0.2.2-rc.5
 * 已验证的包清单做静态校验：行 id 唯一、包名可用、旧写法不再出现。
 *
 * 用法：
 *   node test/preset.mjs
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(join(root, relative), 'utf8');

let passed = 0;
const check = (label, fn) => {
	fn();
	passed += 1;
	console.log(`  ✓ ${label}`);
};

/** 0.2.2-rc.5 asar 里确实存在的插件包（逐个核过），预设只能引用这些。 */
const KNOWN_PACKAGES = new Set([
	'@deepseek-ai/dsh-agent-instructions',
	'@deepseek-ai/dsh-agent-preset',
	'@deepseek-ai/dsh-command-compact',
	'@deepseek-ai/dsh-command-goal',
	'@deepseek-ai/dsh-compaction-basic',
	'@deepseek-ai/dsh-compaction-tool-result-pruner',
	'@deepseek-ai/dsh-persona',
	'@deepseek-ai/dsh-plan-mode',
	'@deepseek-ai/dsh-plugin-manager/tools',
	'@deepseek-ai/dsh-plugin-market/tools',
	'@deepseek-ai/dsh-skill-filesystem',
	'@deepseek-ai/dsh-time-context',
	'@deepseek-ai/dsh-tool-ask-user',
	'@deepseek-ai/dsh-tool-bash',
	'@deepseek-ai/dsh-tool-fs',
	'@deepseek-ai/dsh-tool-fs-search',
	'@deepseek-ai/dsh-tool-goal',
	'@deepseek-ai/dsh-tool-jobs',
	'@deepseek-ai/dsh-tool-office',
	'@deepseek-ai/dsh-tool-present',
	'@deepseek-ai/dsh-tool-pwsh',
	'@deepseek-ai/dsh-tool-schedule',
	'@deepseek-ai/dsh-tool-skill',
	'@deepseek-ai/dsh-tool-subagent',
	'@deepseek-ai/dsh-tool-subagent-control',
	'@deepseek-ai/dsh-tool-todo',
	'@deepseek-ai/dsh-tool-web',
	'@deepseek-ai/dsh-tool-workflow',
	'@deepseek-ai/dsh-workflow-ptc',
]);

const preset = await read('presets/cursor.patch.yml');
const mainPatch = await read('cordis.patch.yml');
const hostSource = await read('lib/index.js');
const manifest = JSON.parse(await read('package.json'));
const presetLines = preset.split('\n');
const rowIds = [...preset.matchAll(/^\s*-\s+id:\s*([^\s#]+)\s*$/gm)].map((match) => match[1]);
const packageNames = [...preset.matchAll(/^\s*name:\s*'([^']+)'\s*$/gm)].map((match) => match[1]);

console.log('— 预设行 —');
check('顶层是一个 insert 行，行 id 与旧受管块不同', () => {
	assert.ok(presetLines.includes('- insert:'));
	assert.ok(rowIds.includes('preset-cursor-toolkit'));
	assert.ok(!rowIds.includes('preset-cursor'), '行 id 不能再用 preset-cursor（会与旧受管块同 id 冲突）');
});
check('声明为 agent-preset 插件，预设 id 仍是 cursor', () => {
	const start = presetLines.findIndex((line) => line.includes('id: preset-cursor-toolkit'));
	const head = presetLines.slice(start, start + 12).join('\n');
	assert.match(head, /name: '@deepseek-ai\/dsh-agent-preset'/);
	assert.match(head, /^\s+id: cursor$/m);
	assert.match(head, /name: Cursor 模式/);
	assert.match(head, /order: 5/);
});
check('行 id 全局唯一', () => {
	const seen = new Set();
	for (const id of rowIds) {
		assert.ok(!seen.has(id), `重复的行 id：${id}`);
		seen.add(id);
	}
});
check('引用的插件包都在 0.2.2-rc.5 清单内', () => {
	assert.ok(packageNames.length > 20, `只解析到 ${packageNames.length} 个包名`);
	for (const name of packageNames) assert.ok(KNOWN_PACKAGES.has(name), `未知包名：${name}`);
});
check('不再引用旧版失效的写法', () => {
	for (const legacy of ['list-agents', 'modelSelectionSettings', 'backgroundMode', 'maxDepth', 'dsh-tool-ralph', 'codex', 'claude-code']) {
		assert.ok(!preset.includes(legacy), `预设里还残留旧写法：${legacy}`);
	}
});
check('persona 说明 mdc 规则的按需加载纪律', () => {
	assert.match(preset, /\.cursor\/rules\/\*\*\/\*\.mdc/);
	assert.match(preset, /available on demand/);
});

console.log('— bundle 声明 —');
check('dsh.bundle.patch 是数组且包含预设文件', () => {
	assert.ok(Array.isArray(manifest.dsh.bundle.patch), 'patch 字段应为数组');
	assert.deepEqual(manifest.dsh.bundle.patch, ['./cordis.patch.yml', './presets/cursor.patch.yml']);
});
check('files 会带上 presets 目录', () => {
	assert.ok(manifest.files.includes('presets/*.patch.yml'));
});
check('主 patch 只插宿主插件行', () => {
	assert.match(mainPatch, /^\s+- id: dsh-cursor-toolkit$/m);
	assert.ok(!mainPatch.includes('agent-preset'));
});
check('PLUGIN_VERSION 与 package.json 版本一致', () => {
	const version = /const PLUGIN_VERSION = '([^']+)'/.exec(hostSource)?.[1];
	assert.equal(version, manifest.version);
});

console.log(`\n${passed} 项通过`);
