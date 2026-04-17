# CC Lens

Insights & search across your [Claude Code](https://claude.ai/code) sessions — runs entirely in the browser, no install required.

## Features

- **One-click import** via folder picker (File System Access API) or drag & drop
- **Insights dashboard** — total sessions, projects, tool call counts, avg session depth
- **Daily & hourly activity charts + 14-week heatmap** — see when you code and how busy each day was
- **Session depth stats** — avg duration, avg tool calls, avg turns, longest/deepest session
- **Top tools breakdown** — ranked bar chart of all tools used across sessions
- **Cost & token panel** — version-aware pricing (Opus 4.5+ / 4.1, Haiku 4.5 / 3.5), per-model breakdown, daily cost curve, cache-hit rate
- **Cost by task type** — how much of your spend goes to coding vs. debugging vs. research vs. exploration vs. conversation (avg cost/session + share of total)
- **Context window hotspots** — surfaces sessions closest to the auto-compact threshold (200k standard, 1M for `[1m]` variants)
- **Tool error rate & slowest tool calls** — click a slow call to jump to the exact turn
- **Bash anti-pattern detector** — flags `grep`/`find`/`cat`/`ls` via Bash that should be using dedicated tools, with a copy-paste CLAUDE.md snippet
- **Skills & agents breakdown** — invocations per skill / subagent type, plus skill-gap suggestions when usage signals a missing skill
- **MCP server usage** — calls per server with top tools
- **Hot files** — files most frequently Edited/Written across sessions
- **Project tree** — sessions grouped by project with expand/collapse
- **Session viewer** — full conversation with markdown rendering, tool call inspector, slash command badges
- **Session timeline** — visual scrubber of tool calls along the session's duration
- **Edit diff view** — visualize `old_string` → `new_string` for every Edit tool call
- **Memory viewer** — browse `~/.claude/projects/<slug>/memory/` entries by type
- **Export session / insights report** — download any session as Markdown / HTML, or the full insights view as a Markdown report
- **Full-text search** — search across all turns with highlighted snippets

## Usage

### Option A: Use without installing anything

1. Open [cclens.dev](https://www.cclens.dev)
2. Click **Select .claude/projects folder** and pick `~/.claude/projects`
3. Done — all analysis runs in your browser, nothing is uploaded

### Option B: Run locally

**Requirements:** [Bun](https://bun.sh)

```bash
git clone https://github.com/jiawei-hong/cclens
cd cclens
bun install
bun run dev
```

Then open [http://localhost:3737](http://localhost:3737) and select your `~/.claude/projects` folder.

Other scripts:

```bash
bun test          # run the analyzer test suite
bun run typecheck # run TypeScript type checking
bun run build     # production build
```

## Where are my Claude Code sessions?

```
~/.claude/projects/
```

Each subfolder is a project; each `.jsonl` file is a session. You can open that folder quickly with:

```bash
open ~/.claude/projects
```

## Tech stack

- **Runtime:** [Bun](https://bun.sh) — serves the app and bundles TSX on the fly
- **UI:** React 19 + Tailwind CSS (CDN)
- **Parsing:** Client-side `.jsonl` parser using the File System Access API
- **Markdown:** [react-markdown](https://github.com/remarkjs/react-markdown)
- **No database, no backend analysis** — everything runs in the browser

## Privacy

All session data stays in your browser. The folder picker uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) — files are read locally and never uploaded to any server.

