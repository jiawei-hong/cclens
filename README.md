# Claude Lens

Insights & search across your [Claude Code](https://claude.ai/code) sessions — no install required for end users.

## Features

- **One-click import** via folder picker (File System Access API) or drag & drop
- **Insights dashboard** — total sessions, projects, tool call counts, avg session depth
- **Daily & hourly activity charts** — see when you code and how busy each day was
- **Session depth stats** — avg duration, avg tool calls, avg turns, longest/deepest session
- **Top tools breakdown** — ranked bar chart of all tools used across sessions
- **Project tree** — sessions grouped by project with expand/collapse
- **Session viewer** — full conversation with markdown rendering, tool call inspector, slash command badges
- **Full-text search** — search across all turns with highlighted snippets

## Usage

### Option A: Use without installing anything

1. Open the hosted version at [claude-lens.vercel.app](https://claude-lens.vercel.app) _(coming soon)_
2. Click **Select .claude/projects folder** and pick `~/.claude/projects`
3. Done — all analysis runs in your browser, nothing is uploaded

### Option B: Run locally

**Requirements:** [Bun](https://bun.sh)

```bash
git clone https://github.com/your-username/claude-lens
cd claude-lens
bun install
bun run dev
```

Then open [http://localhost:3737](http://localhost:3737) and select your `~/.claude/projects` folder.

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

## License

MIT
