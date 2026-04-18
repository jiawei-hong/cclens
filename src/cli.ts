#!/usr/bin/env bun
// cclens CLI — currently exposes a single command, `md`, which generates a
// personalized CLAUDE.md from the user's Claude Code sessions and prints it
// to stdout. Designed to be piped into a project's CLAUDE.md:
//
//   bun run cli md                 # rules from all sessions, global scope
//   bun run cli md --project cclens  # rules from sessions in one project
//   bun run cli md --cwd             # scope to the project matching $PWD
//   bun run cli md > CLAUDE.md       # write to the current project
//
// Kept deliberately thin: this file is a glue layer over loadAllSessions +
// the analyzer + generateProjectClaudeMd. Any heuristic changes live there.

import { basename } from 'node:path'
import { loadAllSessions } from './parser'
import { bashAntiPatterns, skillUsageStats, skillGaps } from './analyzer'
import { generateProjectClaudeMd } from './claudeMd'
import type { Session } from './types'

type MdArgs = { project?: string; cwd?: boolean }

function parseMdArgs(argv: string[]): MdArgs {
  const out: MdArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--project') {
      out.project = argv[++i]
    } else if (a === '--cwd') {
      out.cwd = true
    } else if (a && a.startsWith('--project=')) {
      out.project = a.slice('--project='.length)
    } else {
      die(`Unknown argument: ${a}`)
    }
  }
  return out
}

function die(msg: string): never {
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}

function filterByProject(sessions: Session[], project: string): Session[] {
  const lc = project.toLowerCase()
  return sessions.filter(s =>
    s.project.toLowerCase() === lc ||
    s.projectPath.toLowerCase().endsWith('/' + lc) ||
    s.projectPath.toLowerCase() === lc
  )
}

async function cmdMd(args: MdArgs) {
  const sessions = await loadAllSessions()
  if (sessions.length === 0) die('No sessions found under ~/.claude/projects.')

  let scoped = sessions
  let scopeLabel = 'all projects'
  const projectFilter = args.cwd ? basename(process.cwd()) : args.project
  if (projectFilter) {
    scoped = filterByProject(sessions, projectFilter)
    scopeLabel = `project "${projectFilter}"`
    if (scoped.length === 0) die(`No sessions matched ${scopeLabel}.`)
  }

  const antiPatterns = bashAntiPatterns(scoped)
  const usedSkills   = skillUsageStats(scoped)
  const gaps         = skillGaps(scoped, usedSkills)

  const md = generateProjectClaudeMd({ sessions: scoped, antiPatterns, skillGaps: gaps })
  process.stdout.write(md)
  process.stderr.write(`# generated from ${scoped.length} sessions · ${scopeLabel}\n`)
}

function usage(): never {
  process.stderr.write(
    `Usage: bun run cli <command> [options]\n\n` +
    `Commands:\n` +
    `  md                     Generate CLAUDE.md from all sessions (prints to stdout)\n` +
    `    --project <name>     Scope to sessions from one project (by directory name)\n` +
    `    --cwd                Scope to the project matching the current directory\n` +
    `\nExample:\n` +
    `  bun run cli md --cwd > CLAUDE.md\n`
  )
  process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)
if (!cmd || cmd === '-h' || cmd === '--help') usage()
if (cmd === 'md') await cmdMd(parseMdArgs(rest))
else usage()
