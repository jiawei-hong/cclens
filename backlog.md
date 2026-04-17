# Backlog
Stuff we've talked about but intentionally deferred. Reach for this list when
picking the next thing to do; keep it short — if something stays here for
months untouched, it probably doesn't matter.
Format: `- [ ] item — one-line context / why it was deferred`.
Move items up into "Next up" when ready to work on them; delete when shipped.
---
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