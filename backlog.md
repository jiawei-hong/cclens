# Backlog
Stuff we've talked about but intentionally deferred. Reach for this list when
picking the next thing to do; keep it short — if something stays here for
months untouched, it probably doesn't matter.
Format: `- [ ] item — one-line context / why it was deferred`.
Move items up into "Next up" when ready to work on them; delete when shipped.
---
## 🎯 Next up (ordered)
- [ ] **Session comparison view**
  Select two sessions and diff their stats side-by-side: cost, tool breakdown,
  duration, cache rate, files touched. Useful for "did my workflow improve?"
- [ ] **Tool call deep-dive**
  Click a tool name in the Insights breakdown to open a filtered view of every
  call of that type across all sessions — input args, result, duration. Current
  cards show counts only.
## 🐛 Accuracy / correctness
- [ ] **Fast mode pricing not detected**
  Opus 4.6 fast mode is billed at 6× standard. No obvious signal in the
  session JSONL for fast-mode calls. Low priority until someone reports
  a cost anomaly; track via model ID if it ever changes.
- [ ] **Cache 5m vs 1h write ambiguity**
  `costOfUsage` assumes all cache writes are the 5m variant (1.25×).
  1h writes are 2×. The JSONL may not distinguish them — needs a closer
  look at the raw `usage` object.
## 🆕 New features
- [ ] **Diff viewer: side-by-side mode**
  Current `EditDiffView` is stacked (removed then added). Add a toggle for
  side-by-side. Easier to read for multi-line edits.
## 💡 Big bets
- [ ] **Live-tail / active-session monitoring**
  claude-view's killer feature: watch a session file for new turns and
  auto-refresh. FSA API supports persistent handles but polling needed.
  Significant re-architecture; warrants a dedicated branch.
- [ ] **Anonymized session export**
  Redact file paths, URLs, emails, usernames on export. No competitor
  does this — would make cclens the go-to for safely sharing session
  repros.
- [ ] **IndexedDB session cache**
  Persist parsed sessions via IndexedDB so the folder doesn't need to
  be re-selected every page load. Also enables instant load on repeat
  visits.
- [ ] **Virtualize long session / turn lists**
  `react-virtuoso` for >500-session installs. Currently fine, but will
  matter once someone has 10K+ sessions.
- [ ] **Session timeline scrubber**
  Replace the static timeline bar with an interactive scrubber — click a
  position to jump to that turn in the conversation. Needs accurate per-turn
  timestamps mapped to position.
## 🚫 Intentionally NOT doing
- **AI-powered summaries (Anthropic API integration)**
  Would require a user-provided API key, breaking the "pure browser,
  zero setup" promise. The target audience is "I want a dashboard, not
  another tool to configure".
- **Team / enterprise analytics**
  Anthropic ships this officially via the Claude Code Analytics API
  (Team / Enterprise plans). cclens stays focused on the individual
  developer's local files.
- **Mobile layout**
  Desktop-first by design — reading session transcripts on mobile is
  an anti-UX. Not worth the responsive styling cost.