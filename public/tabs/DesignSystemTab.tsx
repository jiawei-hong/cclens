import React, { useState } from 'react'
import { RiDownloadLine, RiAddLine, RiDeleteBinLine } from 'react-icons/ri'
import {
  Button, Card, Tab, TabGroup, Badge, Stat, StatStrip, EmptyState,
  radius, space, type as typeTokens, surface, accent, categoricalPalette, pickCategorical,
  type AccentTone,
} from '../lib/ds'

// ── Atoms-view helpers (used only on this page) ───────────────────────────────

function Swatch({ label, className, textClassName = '' }: { label: string; className: string; textClassName?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`h-12 ${className} ${radius.md} border border-gray-200 dark:border-gray-800`} />
      <span className={`text-[10px] font-mono text-gray-500 dark:text-gray-500 ${textClassName}`}>{label}</span>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <Card.Header title={title} subtitle={description} />
      {children}
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function DesignSystemTab() {
  const [tabValue, setTabValue] = useState<'overview' | 'cost' | 'efficiency'>('overview')
  const [subTabValue, setSubTabValue] = useState<'a' | 'b' | 'c'>('a')

  const accentTones: AccentTone[] = ['primary', 'success', 'warning', 'danger', 'neutral']
  const categoricalSamples = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Task', 'WebFetch']

  return (
    <div className={`flex flex-col ${space.sectionGap}`}>
      <div>
        <h1 className={typeTokens.title}>Design System</h1>
        <p className={`${typeTokens.body} mt-1`}>
          Visual reference for tokens and primitives in <code className="font-mono text-xs">public/lib/ds/</code>.
          Use this page to verify a token change cascades everywhere it should.
        </p>
      </div>

      {/* ── Tokens: Typography ── */}
      <Section title="Typography" description="Semantic text styles. Prefer these over raw text-xs / text-sm / text-lg classes.">
        <div className="flex flex-col gap-3">
          {([
            ['caption', 'THE SMALLEST LABEL — ALL CAPS'],
            ['label',   'A row label, a column header'],
            ['body',    'Body copy — the default for prose'],
            ['strong',  'Strong body — slightly heavier'],
            ['heading', 'Card heading'],
            ['title',   'Page title'],
            ['display', '12,345'],
            ['mono',    'src/parseCore.ts:46'],
          ] as const).map(([name, sample]) => (
            <div key={name} className="flex items-baseline gap-4">
              <code className="text-[10px] font-mono text-gray-400 dark:text-gray-600 w-16 shrink-0">{name}</code>
              <span className={typeTokens[name]}>{sample}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Tokens: Radius / Spacing ── */}
      <div className="grid grid-cols-2 gap-5">
        <Section title="Radius">
          <div className="flex items-end gap-3">
            {(['sm', 'md', 'lg', 'pill'] as const).map(r => (
              <div key={r} className="flex flex-col items-center gap-1">
                <div className={`w-16 h-16 bg-indigo-500 ${radius[r]}`} />
                <span className="text-[10px] font-mono text-gray-500 dark:text-gray-500">{r}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Surface">
          <div className="flex flex-col gap-2">
            <div className={`${surface.card} ${radius.md} p-3 text-xs`}>surface.card</div>
            <div className={`${surface.sunken} ${radius.md} p-3 text-xs font-mono`}>surface.sunken</div>
            <div className={`${surface.dialog} ${radius.md} p-3 text-xs`}>surface.dialog</div>
          </div>
        </Section>
      </div>

      {/* ── Tokens: Colors ── */}
      <Section title="Accent (semantic)" description="Status colors — pick by meaning. 3 variants per tone: solid, soft, text.">
        <div className="grid grid-cols-5 gap-4">
          {accentTones.map(tone => (
            <div key={tone} className="flex flex-col gap-2">
              <p className={typeTokens.caption}>{tone}</p>
              <Swatch label="solid" className={accent[tone].solid} />
              <Swatch label="soft"  className={accent[tone].soft} />
              <div className={`h-6 flex items-center justify-center ${radius.md} bg-gray-50 dark:bg-gray-950`}>
                <span className={`text-xs font-medium ${accent[tone].text}`}>text</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Categorical" description="Stable color map for data categories (tool names, task types). Hash-picked, deterministic.">
        <div className="grid grid-cols-8 gap-3">
          {categoricalPalette.map((p, i) => (
            <Swatch key={i} label={`[${i}]`} className={p.solid} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {categoricalSamples.map(name => {
            const p = pickCategorical(name)
            return (
              <span key={name} className={`${p.soft} text-xs font-mono px-2 py-0.5 rounded`}>{name}</span>
            )
          })}
        </div>
      </Section>

      {/* ── Buttons ── */}
      <Section title="Button" description="4 variants × 3 sizes. Always focus-ringed.">
        <div className="flex flex-col gap-3">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map(variant => (
            <div key={variant} className="flex items-center gap-2">
              <code className="text-[10px] font-mono text-gray-400 dark:text-gray-600 w-20 shrink-0">{variant}</code>
              <Button variant={variant} size="sm">Small</Button>
              <Button variant={variant} size="md">Medium</Button>
              <Button variant={variant} size="lg">Large</Button>
              <Button variant={variant} size="md" icon={<RiDownloadLine size={14} />}>Download</Button>
              <Button variant={variant} size="md" disabled>Disabled</Button>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Badges ── */}
      <Section title="Badge" description="Inline tone marker for row metadata.">
        <div className="flex items-center gap-2 flex-wrap">
          {accentTones.map(tone => (
            <Badge key={tone} tone={tone}>{tone}</Badge>
          ))}
          <span className="text-gray-300 dark:text-gray-700">·</span>
          <Badge tone="primary" size="sm">sm</Badge>
          <Badge tone="primary" size="md">md</Badge>
          <Badge tone="success"><RiAddLine size={10} /> with icon</Badge>
        </div>
      </Section>

      {/* ── Tabs ── */}
      <Section title="Tab" description="Solid variant = top nav; Subtle variant = sub-nav / section groups. Supports badges.">
        <div className="flex flex-col gap-4">
          <div>
            <p className={`${typeTokens.caption} mb-2`}>variant="solid"</p>
            <TabGroup value={tabValue} onChange={setTabValue} variant="solid">
              <Tab value="overview">Overview</Tab>
              <Tab value="cost">Cost</Tab>
              <Tab value="efficiency" badge={3}>Efficiency</Tab>
            </TabGroup>
          </div>
          <div>
            <p className={`${typeTokens.caption} mb-2`}>variant="subtle"</p>
            <TabGroup value={subTabValue} onChange={setSubTabValue} variant="subtle">
              <Tab value="a">Option A</Tab>
              <Tab value="b" badge={5}>Option B</Tab>
              <Tab value="c">Option C</Tab>
            </TabGroup>
          </div>
        </div>
      </Section>

      {/* ── Stat ── */}
      <Section title="Stat / StatStrip" description="Scannable numeric display. StatStrip handles the divider-separated row pattern.">
        <div className="flex flex-col gap-5">
          <StatStrip items={[
            { label: 'Sessions',    value: '1,204' },
            { label: 'Projects',    value: '12' },
            { label: 'Tool Calls',  value: '48,302' },
            { label: 'Avg Duration', value: '7m 32s' },
            { label: 'Est. Cost',   value: '$124.50' },
          ]} />
          <div className="grid grid-cols-3 gap-5">
            <Card><Stat label="Input" value="1.2M" sub="fresh tokens" /></Card>
            <Card><Stat label="Output" value="450K" sub="generated" /></Card>
            <Card><Stat label="Cache Hit Rate" value="78.4%" sub="980K / 1.25M" /></Card>
          </div>
        </div>
      </Section>

      {/* ── Card ── */}
      <Section title="Card" description="Base surface for all grouped content. Header renders title / subtitle / trailing actions.">
        <div className="grid grid-cols-2 gap-5">
          <Card>
            <Card.Header
              title="With actions"
              subtitle="Subtitle in smaller caption tone"
              actions={<Button size="sm" variant="ghost" icon={<RiDeleteBinLine size={12} />}>Delete</Button>}
            />
            <p className={typeTokens.body}>Card body content.</p>
          </Card>
          <Card padding="sm">
            <Card.Header title="Compact padding" />
            <p className={typeTokens.body}>Uses padding="sm" for denser lists.</p>
          </Card>
        </div>
      </Section>

      {/* ── EmptyState ── */}
      <Section title="EmptyState" description="Use when a section has no data. Supports an optional action.">
        <EmptyState
          title="No sessions match this filter"
          description="Try widening the date range or clearing the project filter."
          action={<Button variant="primary" size="sm">Clear filters</Button>}
        />
      </Section>

      {/* ── Focus ring ── */}
      <Section title="Focus" description="Tab through these with a keyboard to verify the shared focusRing is applied consistently.">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <TabGroup value={tabValue} onChange={setTabValue} variant="solid">
            <Tab value="overview">A</Tab>
            <Tab value="cost">B</Tab>
            <Tab value="efficiency">C</Tab>
          </TabGroup>
        </div>
      </Section>
    </div>
  )
}
