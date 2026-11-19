# dsh-cursor-toolkit

> Brings the three asset types Cursor keeps under `.cursor` into DeepSeek Harness: **rules**
> (`.cursor/rules/**/*.mdc`), **skills** (`.cursor/skills/*/SKILL.md`), and **MCP servers**
> (`.cursor/mcp.json`) — plus a **Cursor rules** panel in the Web GUI.

[中文说明](README.zh.md)

---

## What it does

- **Ships the Cursor agent preset.** The bundle declares the `cursor` preset itself, so installing it puts **Cursor 模式** in the new-session picker — no separate `dsh-cursor-mode` install. Apart from the persona, its tool plane is line-for-line the built-in standard mode.
- **Same rule semantics as Cursor.** A rule's frontmatter decides when it enters the context, not the file name.
- **Nothing to maintain twice.** Repositories (and `~/.cursor`) that already carry rules, skills, and MCP
  configuration work as-is; you do not paste them into prompts or declare the servers again.
- **Skills load on demand.** A skill's `name` and `description` are listed once in the context catalog; the
  body is fetched with the `cursor_skill` tool only when the agent needs it.
- **MCP servers really connect.** Servers declared in `.cursor/mcp.json` become DSH MCP clients, and every one
  of them is **off by default** — a process starts only after you flip its switch.
- **Two UI surfaces.** A row in the sidebar's global panel list opens a full-main-panel page with three tabs
  (Rules / MCP / Skills); Settings has a section with the same rule list.
- **Zero third-party dependencies.** Frontmatter parsing, JSONC parsing, and glob matching are implemented
  inside the package, so the bundle is self-contained and needs no build step.

## Rule types

| Type | Frontmatter | When it enters the agent context |
| --- | --- | --- |
| **Always** | `alwaysApply: true` | Injected in full at the start of a session |
| **Auto Attached** | `alwaysApply: false` + `globs: [...]` | Added when a file the agent has touched matches one of the globs |
| **Agent Requested** | `alwaysApply: false` + `description` | Listed in the on-demand catalog; the agent reads the file when it judges it relevant |
| **Manual** | neither key | Listed in the on-demand catalog only |

Other conventions:

- **Order.** User-level directories come first (`~/.dsh/rules/**` and `~/.cursor/rules/**` by default, in the order given by `userRuleDirs`), then `.cursor/rules/**` from the project root down to the session's working directory. Inside the project layers a more specific copy wins for the same id.
  > A user-level rule's id is `~/<path relative to the home directory>`, so the directory name is part of the id: `~/.dsh/rules/x.mdc` and `~/.cursor/rules/x.mdc` are two independent rules, both injected. `userRuleDirs` only sets the scan order; directories never override each other.
- **Frontmatter forms.** `globs` accepts a YAML block list, an inline array, or Cursor's comma-separated string; `alwaysApply` accepts a boolean or `"true"` / `"false"`.
- **Incremental delivery.** The first request carries a full baseline; later turns only carry a delta when the rule set or its content changes (new or updated bodies, and removal notices for rules that no longer apply). Hundreds of kilobytes of rules are not re-sent every turn.
- **Budget.** One injection never exceeds `maxBytes` (131072 bytes by default). Rules over budget are omitted, and the injected text names what was skipped.
- **Frame boundary.** A `</system-reminder>` inside a rule body is escaped, so repository content cannot break out of the plugin's own `<system-reminder>` frame.

## Skills (`.cursor/skills`)

A Cursor skill is a directory:

```
.cursor/skills/<skill-name>/
  SKILL.md        # frontmatter: name / description (optionally license)
  notes.md        # extra files, referable by relative path from the body
  phases/…
```

How this plugin handles them:

- **Only directories that contain `SKILL.md` are registered.** A missing `name` falls back to the directory
  name; a missing `description` still shows up, just with a shorter catalog line.
- **The catalog goes into the context.** Enabled skills are injected as `- <name> — <description>` lines in the
  same `<system-reminder>` block as the rules, together with an instruction to call `cursor_skill` first when a
  task matches one of them.
- **Bodies are pulled on demand.** Only when the agent calls `cursor_skill({ name })` does the plugin read
  `SKILL.md` and return the body (frontmatter stripped) plus the list of companion files.
- **The catalog is fingerprinted.** It is re-delivered only when the skill set or a description changes.
- **Sources and overrides.** `~/.cursor/skills` comes first, then `.cursor/skills` from the project root down to
  the working directory; a project-level skill overrides a user-level one with the same name.
- `~/.dsh/skills` is intentionally not scanned — that is DSH's own user skill location, and scanning it would
  register the same skill twice.

## MCP (`.cursor/mcp.json`)

Cursor's MCP configuration looks like this:

```jsonc
{
  // comments and trailing commas are allowed; this plugin parses JSONC
  "mcpServers": {
    "mysql":     { "command": "npx", "args": ["-y", "mysql-mcp"], "env": { "MYSQL_URL": "…" } },
    "api-docs":  { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

- **Two transports.** A `url` means `streamable-http`; anything else is `stdio` (`command` + `args` + `env`, plus
  an optional `cwd`).
- **Off by default.** Switch state is a whitelist: only servers you enable in the panel are actually mounted as
  `@deepseek-ai/dsh-mcp-client` instances, so installing the plugin never spawns a pile of `npx` / `uvx`
  processes.
- **Server names are normalised.** DSH's `serverName` only accepts `[A-Za-z0-9_-]{1,32}` while Cursor allows any
  name. Names are normalised to `cursor_<slug>` (the original name is still shown), and collisions get `_2`, `_3`.
- **Credentials stay out of the UI.** The panel shows only the `env` and `headers` **key names**, never their
  values; values are used solely to start the child process.
- **Runtime state is visible.** Each server shows `idle / connecting / ready / failed`, with the failure reason.
- Disabling a server or removing the bundle disposes the MCP client, which also terminates its child process.

## Install

From the DSH plugin market, search for **Cursor rules** and install the bundle.

From this repository:

```sh
dsh plugin add github:kingchen95272025/dsh-cursor-toolkit   # add --profile <name> for a non-default profile
```

The package is a bundle whose `dsh.bundle.patch` lists two patch files, applied in that order:

- `cordis.patch.yml` inserts the `dsh-cursor-toolkit` row. The host half is the package main entry; the `dsh.client`
  declaration makes the web app load `./client` for the browser half.
- `presets/cursor.patch.yml` inserts the **Cursor 模式** agent preset (next section).

Bundle patches are read from the package directory on every start and never copied into the profile, so **restart
DSH once after installing or upgrading**. No build step, no install script.

> Migrating from an older manual install? Remove the hand-written `cursor-rules` row from the profile's
> `cordis.patch.yml` and the copied directory under `<profileDir>/node_modules/` first, otherwise the
> rules are registered twice.
>
> Coming from the standalone `dsh-cursor-mode` bundle? Nothing to clean by hand: on start this plugin removes that
> `# >>> dsh-cursor-mode` managed block from the profile patch, after backing it up as
> `cordis.patch.yml.bak-dsh-cursor-mode`. When the block is already gone it does nothing (idempotent).

## Configuration

The row's `config` (every key is optional):

```yaml
- insert:
    - id: dsh-cursor-toolkit
      name: dsh-cursor-toolkit
      config:
        enabled: true            # master switch; false registers nothing
        includeUserRules: true   # load user-level directories (rules and skills)
        userRuleDirs:            # scanned in this order
          - ~/.dsh/rules         # DSH's own global rules
          - ~/.cursor/rules      # Cursor-compatible location
        maxBytes: 131072         # per-injection byte budget
        trackTouches: true       # auto-attach glob rules on file touches
        projectRootMarkers:      # markers used to find the project root
          - .git
        httpPath: /cursor-toolkit  # HTTP prefix used by the panel
        stateFile: cursor-toolkit.json  # switch state file under $DSH_HOME
        enableSkills: true       # scan .cursor/skills
        userSkillDirs:           # user-level skill directories
          - ~/.cursor/skills
        skillCatalogBytes: 8192  # byte budget for the skill catalog
        migrateLegacyPreset: true   # strip the old dsh-cursor-mode managed block on start (idempotent, backed up)
        enableMcp: true          # parse .cursor/mcp.json and allow mounting servers
        userMcpFiles:            # user-level MCP configuration
          - ~/.cursor/mcp.json
        mcpStartupTimeoutMs: 30000   # startup timeout per MCP server
```

> In DSH patch semantics `config` **replaces** the whole object instead of deep-merging: an override must
> restate every key it wants to keep.

Switch state lives in `$DSH_HOME/cursor-toolkit.json` (v2):

```json
{
  "version": 2,
  "disabled": [".cursor/rules/global.mdc"],
  "skillsDisabled": ["skill:project:prd-skill"],
  "mcpEnabled": ["mcp:project:mysql"]
}
```

`mcpEnabled` is a whitelist: an empty array connects no MCP server at all. A v1 file (only `disabled`) is read
without migration. If the file is missing, the old name `$DSH_HOME/cursor-rules.json` is read instead, so switches
survive the rename from `dsh-cursor-rules`.

## The built-in Cursor 模式

A DSH session "mode" is just an agent preset: one `@deepseek-ai/dsh-agent-preset` row whose `config.plugins` lists the
plugins that mode mounts and the persona it runs. This bundle ships exactly that in
`presets/cursor.patch.yml`, so the mode appears in the new-session picker as soon as the plugin is installed.

- **The preset id stays `cursor`**, the same one the standalone mode used, so session records and settings that
  reference it keep working.
- **The tool plane is the standard mode.** Except for the `persona` row, all 32 plugin rows match the built-in
  standard mode of 0.2.2-rc.5 in order and configuration, and `test/preset.mjs` guards that. To add a tool, override
  this row by id in the profile patch instead of editing the package.
- **The persona does one job**: it states how `.cursor/rules/**/*.mdc` gets loaded — rules already in context are
  obeyed verbatim; a rule marked "available on demand" must be `read` before editing that area and re-read when the
  task moves; project rules and direct user instructions win. Discovering and delivering the rules themselves is the
  host half's job, independent of which mode is selected.
- **The row id is `preset-cursor-toolkit`**, deliberately not the old `preset-cursor`: the loader throws
  `entry ... already exists in the target tree` for two inserts sharing an id, so a different id is what lets a machine
  that still carries the old managed block boot at all. That block is removed after start by
  `config.migrateLegacyPreset`.

The baseline is `dsh-web-app/presets/standard.patch.yml` from 0.2.2-rc.5. When upstream changes the standard mode, this
preset does **not** follow automatically: pull a fresh `standard.patch.yml` out of the asar, diff it structurally, and
change only the persona plus metadata (`id`/`name`/`description`/`order`) — and update the package list inside
`test/preset.mjs`.

## Using the panel

- **Sidebar panel entry** — `sidebar.panellist` row addressing the `main` seat; the page has three tabs:
  **Rules / MCP / Skills**.
- **Rules tab** — type tag, globs, description, and switch per rule. **View** expands the full body inline right
  under its row (Markdown, collapsible), so the list position is kept.
- **MCP tab** — transport, command or URL summary, `env` / `header` key names, runtime status, and switch.
- **Skills tab** — description, path, companion files, size, and switch; **View** expands the `SKILL.md` body
  the same way.
- **Settings → Cursor rules** — the rule list as a settings section (same implementation as the page).
- Turning an asset off removes it from the injected set (rules and skills) or disposes it (MCP).

## How injection works

```
agent/pre-step (waterfall)
   └─ next() returns this turn's entering batch decision
      ├─ collectRules(cwd)                # discover and parse user + project .mdc files
      ├─ selectRules(rules, touched)      # always / auto attached / on-demand catalog
      ├─ planInjection(previous)          # diff against the last delivered state
      ├─ collectSkills(cwd) + planSkillCatalog(previous.skillDigest)
      └─ merge both texts into one createUserMessage(...) after the last claimed message

cwd change / MCP switch toggled
   └─ scheduleMcp(cwd) runs serially → ctx.plugin(McpClient, config), adding and removing instances
```

Injected messages carry the plugin's own `kind: 'cursor-toolkit'` source plus `entries` (every id with its
fingerprint), a `catalogDigest`, and a `skillDigest`, so that:

- **Resuming a session** rebuilds the delivered state from history and does not inject twice;
- **After compaction**, when the plugin's messages are gone from history, the full baseline is delivered again;
- Repeated `pre-step` runs in one turn are suppressed by in-memory state.

## Verify

```sh
npm test            # rules data layer + host wiring + client wiring (see below)
npm run test:rules  # data layer only: frontmatter, glob, discovery, selection, injection, JSONC, MCP, skill catalog, switches
npm run test:host   # host wiring only: routes, cursor_skill tool, state file, MCP mount, injection timing
npm run test:client # client wiring only: slot registration, three tabs, rendering, expand, switch callbacks
```

The test builds its own `.cursor` fixture (rules, skills, and MCP) in the system temp directory, so it passes on
any machine.

Host half, against a running profile:

```sh
curl -s "http://127.0.0.1:<port>/cursor-toolkit/rules?sessionId=<sessionId>" | head -c 400   # rules
curl -s "http://127.0.0.1:<port>/cursor-toolkit/mcp?sessionId=<sessionId>" | head -c 400     # MCP
curl -s "http://127.0.0.1:<port>/cursor-toolkit/skill?id=skill:project:prd-skill" | head -c 400
```

The `version` field in the response is the plugin code version — use it to tell which build the running
process loaded. These routes answer `200` on 2.0.0.

`dsh web` prints its URL on start (default port 19387); the desktop app picks another port.

Browser half — the desktop GUI is served from the custom protocol `dsh-app://app`, and
`curl http://127.0.0.1:<port>/` answers `401 dsh web authentication required`, so a plain `curl` cannot tell
whether the browser half loaded. Check the slots in Settings → Plugin Manager, or read the live slot tree
where the platform exposes one (`cordis_inspect_query` with `provider: "Slots"`, `method: "listSubTree"`):

```
input={"root": "settings.section"}    # expect {"id":"cursor-toolkit","order":30,"active":true}
input={"root": "sidebar.panellist"}    # expect {"id":"cursor-toolkit","order":30,"active":true}
input={"root": "main"}                 # expect a "cursor-toolkit" key registered
```

Registration uses `ctx.inject(['webServer'], …)` rather than a one-shot `ctx.get('webServer')`: on a cold
start `apply` can run before `webServer` is ready, and the one-shot form silently skipped route
registration, which showed up as a 404 after a restart. Keep that form if you change the code.

## Known trade-offs

- **The preset follows upstream by hand.** The Cursor 模式 row list is a copy of the 0.2.2-rc.5 standard mode, not a
  runtime inheritance: zero drift and a clean diff, but upstream additions never arrive by themselves, so each DSH
  upgrade needs one manual pass. On an older DSH that lacks some of those packages the preset shows up as broken in
  the log while rule injection keeps working.
- **Touch sources** are the `file_path` of `read` / `write` / `edit` plus the `displayPath` of `fs/observed`.
  Side effects of arbitrary shell commands are not parsed — the same trade-off `dsh-agent-instructions` makes.
- **Auto Attached follows what has been touched, not what is about to be edited.** Cursor also considers files
  you mention in the conversation; this plugin only uses filesystem touch signals, so attachment arrives one
  step later.
- **Skill bodies are not preloaded.** Only `name` and `description` go into the context. A skill whose body
  starts with hard constraints is invisible until the agent calls `cursor_skill` — the price of keeping long
  skills out of the standing context.
- **MCP stays disconnected by default.** Installing the plugin spawns nothing; a server is mounted only after
  you enable it. Credentials come from the plain-text `.cursor/mcp.json` (as in Cursor) and are never logged or
  returned by the panel routes.
- **MCP names are normalised.** `serverName` is ASCII-only, so a non-ASCII Cursor name appears as
  `cursor_<slug>` on the DSH side; colliding slugs get a numeric suffix while the panel keeps the original name.
- **The panel endpoint has no authentication.** Desktop's web shell requires the `dsh web` token, but this
  plugin registers a named prefix route on `webServer`, which is matched before the token gate, so any local
  process can read it. The exposure is kept minimal: the endpoint only reads rules, skills, and MCP
  configuration under `.cursor`, never arbitrary paths, and never returns credential values; `webServer` binds
  `127.0.0.1` by default. Set `config.enabled` to `false` or remove the bundle to close it entirely.
- **Plugin modules are not hot-reloaded.** `dsh-base` sets `hmr.root` to `[]`: the profile watches
  `cordis.patch.yml` and `package.json`, not plugin modules, and the default `ignored` list contains
  `**/node_modules`. So changing **patch or config** remounts automatically, while changing **`lib/*.js`**
  needs a DSH restart (Node's ESM cache would otherwise reuse the old module instance). The `version` field
  is how you confirm which build is live.

## Structure

| File | Responsibility |
| --- | --- |
| `lib/rules.js` | Asset engine (pure logic, no dependencies): frontmatter parsing, JSONC parsing, glob compilation and matching, rule/skill/MCP discovery, four-type selection, incremental injection planning, skill catalog planning |
| `lib/index.js` | Host half (Cordis plugin): merged `agent/pre-step` injection, the `cursor_skill` tool, MCP client mounting and status, `tools/result` and `fs/observed` touch collection, panel JSON routes on `ctx.webServer`, switch persistence |
| `lib/client.js` | Browser half (hand-written, no build): `window.__ModuleLoader__.load({ id, factory })`, registering the `sidebar.panellist` row, the matching `main` page (three tabs), and the `settings.section` seat |
| `cordis.patch.yml` | Bundle patch: inserts the `dsh-cursor-toolkit` row |
| `presets/cursor.patch.yml` | Bundle patch: inserts the `preset-cursor-toolkit` row — the Cursor 模式 agent preset (Cursor persona plus the standard mode's tool plane) |
| `locale/{en,zh}.json` | Plugin Manager title, description, and detail document |
| `test/smoke.mjs` | Portable smoke test (70 assertions) over a self-built fixture |
| `test/host.mjs` | Host wiring test: stubs the platform packages, then drives `apply()` — routes, `cursor_skill`, toggles, MCP mount, injection, legacy-block migration |
| `test/preset.mjs` | Preset shape check: unique row ids, every package on the rc.5 list, no retired settings, `PLUGIN_VERSION` matching package.json |
| `test/client.mjs` | Client wiring test: a tiny React stand-in renders the real component tree — slots, tabs, expand, switches, dictionary/CSS consistency |

## Credits

- `@deepseek-ai/dsh-agent-instructions` — a workspace instruction injector; this plugin follows its
  conventions (own `source`, verbatim bodies, escaped frame tags, incremental delivery).
- `@deepseek-ai/dsh-mcp-client` and `@deepseek-ai/dsh-mcp-manager` — the MCP client configuration shape and the
  mount → subscribe → dispose lifecycle are modelled on their implementation.
- `@deepseek-ai/dsh-client-ui-skill` and `@deepseek-ai/dsh-client-ui-cordis` — examples of hand-written
  client bundles, `ctx.slots.inject` seat registration, and sidebar panel entries.

## License

[MIT](LICENSE)
