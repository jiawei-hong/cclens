import React from 'react'
import Markdown from 'react-markdown'
import { RiFileCodeLine } from 'react-icons/ri'
import { SiTypescript, SiJavascript, SiPython, SiRust, SiGo, SiRuby, SiPhp, SiSwift, SiKotlin, SiCplusplus, SiC, SiHtml5, SiCss, SiMarkdown, SiJson, SiYaml, SiShell, SiReact, SiVuedotjs, SiSvelte, SiDart, SiScala, SiElixir, SiHaskell, SiLua, SiDocker, SiPrisma } from 'react-icons/si'

export function MarkdownText({ children }: { children: string }) {
  return (
    <Markdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-3 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-gray-800 dark:text-gray-200 mt-3 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-2 mb-1">{children}</h3>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          return isBlock
            ? <code className="block bg-gray-50 dark:bg-gray-950 text-emerald-700 dark:text-emerald-300 rounded-lg px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre my-2">{children}</code>
            : <code className="bg-gray-100 dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
        },
        pre: ({ children }) => <>{children}</>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-gray-700 dark:text-gray-300">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-gray-700 dark:text-gray-300">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-700 dark:text-gray-300">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-300 dark:border-gray-600 pl-3 italic text-gray-600 dark:text-gray-400 my-2">{children}</blockquote>
        ),
        hr: () => <hr className="border-gray-300 dark:border-gray-700 my-3" />,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">{children}</a>
        ),
      }}
    >
      {children}
    </Markdown>
  )
}

const EXT_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  ts:     { icon: SiTypescript,  color: 'text-blue-500' },
  tsx:    { icon: SiReact,       color: 'text-cyan-400' },
  js:     { icon: SiJavascript,  color: 'text-yellow-400' },
  jsx:    { icon: SiReact,       color: 'text-cyan-400' },
  mjs:    { icon: SiJavascript,  color: 'text-yellow-400' },
  cjs:    { icon: SiJavascript,  color: 'text-yellow-400' },
  py:     { icon: SiPython,      color: 'text-blue-400' },
  rs:     { icon: SiRust,        color: 'text-orange-500' },
  go:     { icon: SiGo,          color: 'text-cyan-500' },
  rb:     { icon: SiRuby,        color: 'text-red-500' },
  php:    { icon: SiPhp,         color: 'text-indigo-400' },
  swift:  { icon: SiSwift,       color: 'text-orange-400' },
  kt:     { icon: SiKotlin,      color: 'text-purple-400' },
  kts:    { icon: SiKotlin,      color: 'text-purple-400' },
  cpp:    { icon: SiCplusplus,   color: 'text-blue-600' },
  cc:     { icon: SiCplusplus,   color: 'text-blue-600' },
  c:      { icon: SiC,           color: 'text-blue-500' },
  h:      { icon: SiC,           color: 'text-blue-400' },
  html:   { icon: SiHtml5,       color: 'text-orange-500' },
  css:    { icon: SiCss,         color: 'text-blue-400' },
  scss:   { icon: SiCss,         color: 'text-pink-400' },
  sass:   { icon: SiCss,         color: 'text-pink-400' },
  md:     { icon: SiMarkdown,    color: 'text-gray-500' },
  mdx:    { icon: SiMarkdown,    color: 'text-gray-500' },
  json:   { icon: SiJson,        color: 'text-yellow-500' },
  yaml:   { icon: SiYaml,        color: 'text-red-400' },
  yml:    { icon: SiYaml,        color: 'text-red-400' },
  sh:     { icon: SiShell,       color: 'text-green-400' },
  bash:   { icon: SiShell,       color: 'text-green-400' },
  zsh:    { icon: SiShell,       color: 'text-green-400' },
  vue:    { icon: SiVuedotjs,    color: 'text-emerald-400' },
  svelte: { icon: SiSvelte,      color: 'text-orange-500' },
  dart:   { icon: SiDart,        color: 'text-cyan-500' },
  scala:  { icon: SiScala,       color: 'text-red-500' },
  ex:     { icon: SiElixir,      color: 'text-purple-500' },
  exs:    { icon: SiElixir,      color: 'text-purple-500' },
  hs:     { icon: SiHaskell,     color: 'text-purple-400' },
  lua:    { icon: SiLua,         color: 'text-blue-400' },
  prisma: { icon: SiPrisma,      color: 'text-teal-400' },
  dockerfile: { icon: SiDocker,  color: 'text-blue-400' },
}

export function FileIcon({ path, size = 14 }: { path: string; size?: number }) {
  const name = path.split('/').pop() ?? ''
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : name.toLowerCase()
  const match = EXT_ICONS[ext]
  if (!match) return <RiFileCodeLine size={size} className="text-gray-400 dark:text-gray-600" />
  const Icon = match.icon
  return <Icon size={size} className={match.color} />
}

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span className="
        absolute bottom-full left-1/2 -translate-x-1/2 mb-3
        bg-white dark:bg-gray-950 border border-gray-300/60 dark:border-gray-700/60
        rounded-xl px-3 py-2.5 shadow-2xl
        opacity-0 -translate-y-1
        group-hover:opacity-100 group-hover:translate-y-0
        transition-all duration-150 delay-100
        pointer-events-none z-30 whitespace-nowrap
      ">
        {content}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-300/60 dark:border-t-gray-700/60" />
      </span>
    </span>
  )
}
