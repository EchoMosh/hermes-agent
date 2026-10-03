/* eslint-disable no-restricted-imports -- This bundled pane reuses hermes-bots' native live-screen viewer. */

import { Badge, Button, Codicon, EmptyState, GlyphSpinner, ScrollArea, useValue } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'

import { $botMeta } from '../hermes-bots/data'
import { displayName } from '../hermes-bots/labels'
import { botRosterMeta } from '../hermes-bots/routing'
import { BotScreenPane } from '../hermes-bots/screen-pane'
import { $screenState, screenStateFor } from '../hermes-bots/screen-state'
import type { RosterRow } from '../hermes-bots/types'

import { computerTarget, mergeComputerFeed, requestComputerFeed } from './api'
import { $computerRevealEpoch } from './auto-reveal'
import type { ComputerFeed, ComputerHelper, ComputerPlan, ComputerStep, ComputerStepKind } from './types'

type ActivityTab = 'activity' | 'code' | 'helpers' | 'search' | 'terminal'

const ACTIVITY_TABS = [
  { id: 'activity', label: 'Activity' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'code', label: 'Code' },
  { id: 'search', label: 'Search' },
  { id: 'helpers', label: 'Helpers' }
] as const

const STEP_ICON: Record<ComputerStepKind, string> = {
  ask: 'question',
  browser: 'globe',
  code: 'code',
  delegate: 'organization',
  memory: 'database',
  other: 'tools',
  plan: 'tasklist',
  search: 'search',
  terminal: 'terminal'
}

const POLL_MS = 2_000

function computerFeedError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)

  return /unknown method:?\s*computer\.feed/i.test(message)
    ? 'Restart the Hermes backend to enable the Computer activity timeline. The live screen can still be viewed above when this bot has a display.'
    : message
}

function useComputerFeed(bot: RosterRow) {
  const target = useMemo(() => computerTarget(bot), [bot])
  const [feed, setFeed] = useState<ComputerFeed | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(Boolean(target))

  useEffect(() => {
    setFeed(null)
    setError(null)
    setLoading(Boolean(target))

    if (!target) {
      return
    }

    let cancelled = false
    let cursor = 0
    let timer: number | null = null

    const poll = async () => {
      try {
        const next = await requestComputerFeed(target, { after: cursor })

        if (cancelled) {
          return
        }

        cursor = next.cursor
        setFeed(previous => mergeComputerFeed(previous, next))
        setError(null)
      } catch (cause) {
        if (!cancelled) {
          setError(computerFeedError(cause))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          timer = window.setTimeout(() => void poll(), POLL_MS)
        }
      }
    }

    void poll()

    return () => {
      cancelled = true

      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
    // The key contains the connection, target profile and canonical session;
    // roster polling may replace the row object without changing that identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key])

  return { error, feed, loading, target }
}

function shortTime(value: null | number) {
  if (!value) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(value * 1000)
}

function sessionStatus(feed: ComputerFeed) {
  if (feed.session.status === 'running') {
    return 'Working now'
  }

  if (feed.session.status === 'ended') {
    return 'Finished'
  }

  return 'Waiting'
}

export function computerIsActive(feed: ComputerFeed | null, liveScreen: boolean): boolean {
  return (
    liveScreen ||
    feed?.session.status === 'running' ||
    Boolean(feed?.steps.some(step => step.status === 'running')) ||
    Boolean(feed?.helpers.some(helper => helper.status === 'running'))
  )
}

function LiveScreenFrame({ bot }: { bot: RosterRow }) {
  const allScreens = useValue($screenState)
  const screen = screenStateFor(allScreens, bot)
  const status = screen?.status ?? null
  const [controlsExpanded, setControlsExpanded] = useState(false)
  const live = Boolean(status?.supported && status.installed && status.running)
  const probing = !screen || (!screen.unavailable && !status)
  const collapsed = Boolean(screen?.unavailable || (status && !live))
  const canOpenControls = Boolean(status?.supported && (!status.installed || !status.running))

  let stateLabel = probing ? 'Connecting' : live ? 'Live now' : 'Unavailable'
  let stateDescription = 'Checking this bot’s current display stream.'

  if (screen?.unavailable) {
    stateDescription = 'Live screen is unavailable on this bot’s backend.'
  } else if (status && !status.supported) {
    stateLabel = 'Unsupported'
    stateDescription = 'This bot’s host does not support a live display.'
  } else if (status && !status.installed) {
    stateLabel = 'Setup needed'
    stateDescription = 'Screen support is available but has not been installed.'
  } else if (status && !status.running) {
    stateLabel = 'Stopped'
    stateDescription = status.blocker || 'The live display is not running.'
  } else if (live) {
    stateDescription = 'Always current. The activity timeline below changes step details only.'
  }

  if (collapsed && !controlsExpanded) {
    return (
      <section className="border-y border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="device-desktop" />
          <span className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">Live screen</span>
          <Badge className="text-xs" variant="muted">
            {stateLabel}
          </Badge>
          <span className="grow" />
          {canOpenControls ? (
            <Button onClick={() => setControlsExpanded(true)} size="sm" variant="ghost">
              Screen controls
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-4 text-(--ui-text-secondary)">{stateDescription}</p>
      </section>
    )
  }

  return (
    <section aria-label="Current live screen" className="shrink-0 border-y border-(--ui-stroke-tertiary)">
      <div className="flex items-center gap-2 bg-(--ui-bg-secondary) px-3 py-2">
        <Codicon className="text-(--ui-text-secondary)" name="device-desktop" />
        <span className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">Live screen</span>
        <Badge className="text-xs" variant={live ? 'success' : 'muted'}>
          {stateLabel}
        </Badge>
        <span className="min-w-0 grow truncate text-xs text-(--ui-text-secondary)">{stateDescription}</span>
        {collapsed && controlsExpanded ? (
          <Button onClick={() => setControlsExpanded(false)} size="sm" variant="ghost">
            Collapse
          </Button>
        ) : null}
      </div>
      <div className="h-56 min-h-0 bg-black/90">
        <BotScreenPane bot={bot} />
      </div>
    </section>
  )
}

export function StepTimeline({
  onSelect,
  selectedId,
  steps
}: {
  onSelect: (step: ComputerStep) => void
  selectedId: null | string
  steps: ComputerStep[]
}) {
  if (!steps.length) {
    return (
      <section className="border-b border-(--ui-stroke-tertiary) px-3 py-3">
        <div className="flex items-center gap-2 text-[0.8125rem] font-semibold text-(--ui-text-primary)">
          <Codicon name="history" /> Activity timeline
        </div>
        <p className="mt-1 text-xs leading-4 text-(--ui-text-secondary)">
          Steps will appear here as this Bot Chat uses tools.
        </p>
      </section>
    )
  }

  const explicitIndex = selectedId ? steps.findIndex(step => step.id === selectedId) : -1
  const index = explicitIndex >= 0 ? explicitIndex : steps.length - 1
  const selected = steps[index]
  const latest = index === steps.length - 1

  return (
    <section className="border-b border-(--ui-stroke-tertiary) px-3 py-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-[0.8125rem] font-semibold text-(--ui-text-primary)">
          <Codicon name="history" /> Activity timeline
        </div>
        <Badge className="text-xs" variant={latest ? 'success' : 'muted'}>
          {latest ? 'Latest step' : 'Earlier step'}
        </Badge>
        <span className="grow" />
        <span className="text-xs tabular-nums text-(--ui-text-secondary)">
          {index + 1} of {steps.length}
        </span>
      </div>
      <input
        aria-label="Activity timeline"
        className="mt-2 block w-full accent-(--ui-accent)"
        max={steps.length - 1}
        min={0}
        onChange={event => onSelect(steps[Number(event.currentTarget.value)])}
        step={1}
        type="range"
        value={index}
      />
      <div className="mt-1 flex items-center gap-2 text-xs text-(--ui-text-secondary)">
        <span className="truncate">{shortTime(selected.ts) || 'First step'}</span>
        <span className="grow" />
        <span>Changes step details only · screen stays live</span>
      </div>
    </section>
  )
}

function StepDetail({ step }: { step: ComputerStep | null }) {
  if (!step) {
    return (
      <section aria-label="Selected step detail" className="px-3 py-3">
        <h3 className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">Current step</h3>
        <p className="mt-1 text-xs leading-4 text-(--ui-text-secondary)">Waiting for this Bot Chat to use a tool.</p>
      </section>
    )
  }

  const statusIcon = step.status === 'running' ? 'loading' : step.status === 'error' ? 'error' : 'check'

  return (
    <section aria-label="Selected step detail" className="px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">Step detail</span>
        <Badge className="text-xs" variant="muted">
          {step.kind}
        </Badge>
        <Codicon
          className={step.status === 'error' ? 'text-destructive' : 'text-(--ui-text-secondary)'}
          name={statusIcon}
        />
        <span className="grow" />
        <span className="text-xs tabular-nums text-(--ui-text-secondary)">{shortTime(step.ts)}</span>
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-(--ui-bg-tertiary)">
          <Codicon className="text-(--ui-text-secondary)" name={STEP_ICON[step.kind]} />
        </div>
        <div className="min-w-0 grow">
          <h4 className="text-[0.8125rem] font-medium leading-5 text-(--ui-text-primary)">{step.title}</h4>
          {step.preview ? (
            <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-(--ui-bg-secondary) p-2 font-mono text-xs leading-4 text-(--ui-text-secondary)">
              {step.preview}
            </pre>
          ) : null}
          {step.error ? <p className="mt-1 text-xs leading-4 text-destructive">{step.error}</p> : null}
        </div>
      </div>
    </section>
  )
}

function PlanChecklist({ plan }: { plan: ComputerPlan }) {
  const progress = plan.total ? `${Math.round((plan.done / plan.total) * 100)}%` : '0%'

  return (
    <section className="border-t border-(--ui-stroke-tertiary) px-3 py-3">
      <div className="flex items-center gap-2">
        <Codicon className="text-(--ui-text-secondary)" name="tasklist" />
        <span className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">Plan</span>
        <span className="grow" />
        <span className="text-xs tabular-nums text-(--ui-text-secondary)">
          {plan.done}/{plan.total}
        </span>
      </div>
      {plan.goal ? <p className="mt-1.5 text-[0.8125rem] leading-5 text-(--ui-text-primary)">{plan.goal}</p> : null}
      <div
        aria-label={`${progress} complete`}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--ui-bg-tertiary)"
      >
        <div className="h-full bg-(--ui-accent)" style={{ width: progress }} />
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {plan.steps.map(step => {
          const active = step.id === plan.current || step.status === 'in_progress'
          const done = step.status === 'completed'

          return (
            <div className="flex min-w-0 items-start gap-2 rounded px-1 py-1 text-xs" key={step.id}>
              <Codicon
                className={active ? 'text-(--ui-accent)' : 'text-(--ui-text-secondary)'}
                name={done ? 'check' : active ? 'loading' : 'circle-large-outline'}
              />
              <span className={done ? 'text-(--ui-text-secondary) line-through' : 'text-(--ui-text-primary)'}>
                {step.title}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Helpers({ helpers }: { helpers: ComputerHelper[] }) {
  if (!helpers.length) {
    return <EmptyState description="Helpers assigned from this Bot Chat appear here." title="No helpers yet" />
  }

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      {helpers.map(helper => (
        <article className="flex gap-2.5 py-2" key={helper.id}>
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-(--ui-bg-tertiary)">
            <Codicon className="text-(--ui-text-secondary)" name="organization" />
          </div>
          <div className="min-w-0 grow">
            <div className="flex items-center gap-2">
              <span className="truncate text-[0.8125rem] font-medium text-(--ui-text-primary)">
                {helper.title || 'Helper'}
              </span>
              <Badge className="text-xs" variant="muted">
                {helper.status}
              </Badge>
            </div>
            {helper.goal ? <p className="mt-0.5 text-xs leading-4 text-(--ui-text-secondary)">{helper.goal}</p> : null}
            {helper.last_step ? (
              <p className="mt-1 truncate text-xs text-(--ui-text-secondary)">{helper.last_step}</p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  )
}

function ActivityList({
  feed,
  onSelect,
  selectedId,
  tab
}: {
  feed: ComputerFeed
  onSelect: (step: ComputerStep) => void
  selectedId: string
  tab: ActivityTab
}) {
  if (tab === 'helpers') {
    return <Helpers helpers={feed.helpers} />
  }

  const steps = [...(tab === 'activity' ? feed.steps : feed.steps.filter(step => step.kind === tab))].reverse()

  if (!steps.length) {
    return (
      <EmptyState
        description={tab === 'activity' ? 'Tool activity from this Bot Chat appears here.' : `No ${tab} activity yet.`}
        title="Nothing to show"
      />
    )
  }

  return (
    <div className="divide-y divide-(--ui-stroke-tertiary)">
      {steps.map(step => (
        <button
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-(--ui-bg-secondary) ${
            selectedId === step.id ? 'bg-(--ui-bg-secondary)' : ''
          }`}
          key={step.id}
          onClick={() => onSelect(step)}
          type="button"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-(--ui-bg-tertiary)">
            <Codicon className="text-(--ui-text-secondary)" name={STEP_ICON[step.kind]} />
          </div>
          <div className="min-w-0 grow">
            <div className="truncate text-xs font-medium text-(--ui-text-primary)">{step.title}</div>
            <div className="mt-0.5 text-xs capitalize text-(--ui-text-secondary)">
              {step.kind} · {step.status}
            </div>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-(--ui-text-secondary)">{shortTime(step.ts)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Pure work surface for a resolved canonical Bot Chat. Exported for behavioral
 * tests: selecting an earlier activity step must never replace the live screen.
 */
export function ComputerWorkSurface({ bot, feed }: { bot: RosterRow; feed: ComputerFeed }) {
  const [activityTab, setActivityTab] = useState<ActivityTab>('activity')
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const revealEpoch = useValue($computerRevealEpoch)
  const selected = (selectedId ? feed.steps.find(step => step.id === selectedId) : null) ?? feed.steps.at(-1) ?? null

  useEffect(() => {
    setSelectedId(null)
  }, [feed.session.id])

  useEffect(() => {
    if (revealEpoch > 0) {
      setActivityTab('activity')
      setSelectedId(null)
    }
  }, [revealEpoch])

  const selectStep = (step: ComputerStep) => {
    setSelectedId(step.id === feed.steps.at(-1)?.id ? null : step.id)
  }

  return (
    <>
      <LiveScreenFrame bot={bot} />
      <StepTimeline onSelect={selectStep} selectedId={selected?.id ?? null} steps={feed.steps} />
      <StepDetail step={selected} />
      {feed.plan ? <PlanChecklist plan={feed.plan} /> : null}
      <section className="border-t border-(--ui-stroke-tertiary) pt-3">
        <div className="flex gap-1 overflow-x-auto px-3" role="tablist">
          {ACTIVITY_TABS.map(option => (
            <button
              aria-selected={activityTab === option.id}
              className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                activityTab === option.id
                  ? 'bg-(--ui-bg-quaternary) text-(--ui-text-primary)'
                  : 'text-(--ui-text-secondary) hover:bg-(--ui-bg-secondary) hover:text-(--ui-text-primary)'
              }`}
              key={option.id}
              onClick={() => setActivityTab(option.id)}
              role="tab"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <ActivityList feed={feed} onSelect={selectStep} selectedId={selected?.id ?? ''} tab={activityTab} />
        </div>
      </section>
    </>
  )
}

/**
 * Contextual work view for one roster row. The parent supplies the selected
 * bot; this component owns no selection or session fallback of its own.
 */
export function MernaComputerPane({ bot }: { bot: RosterRow }) {
  const { error, feed, loading, target } = useComputerFeed(bot)
  const allMeta = useValue($botMeta)
  const allScreens = useValue($screenState)
  const screenStatus = screenStateFor(allScreens, bot)?.status
  const liveScreen = Boolean(screenStatus?.supported && screenStatus.installed && screenStatus.running)

  if (!target) {
    return null
  }

  // Historic tool steps belong to the chat record. The upper computer only
  // occupies space while the selected teammate is actually working.
  if (!loading && !error && !computerIsActive(feed, liveScreen)) {
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <div className="flex size-7 items-center justify-center rounded-md bg-(--ui-bg-tertiary)">
          <Codicon className="text-(--ui-text-secondary)" name="workspace-trusted" />
        </div>
        <div className="min-w-0 grow">
          <div className="truncate text-sm font-semibold">{displayName(bot, botRosterMeta(bot, allMeta))}</div>
          <div className="truncate text-xs text-(--ui-text-secondary)">
            {feed ? `${sessionStatus(feed)} · ${feed.session.title || 'Bot Chat'}` : 'Connecting to Bot Chat…'}
          </div>
        </div>
        {loading ? <GlyphSpinner /> : null}
      </header>

      {error ? (
        <div className="shrink-0 border-y border-(--ui-stroke-tertiary) px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 grow">
        {feed ? <ComputerWorkSurface bot={bot} feed={feed} key={target.key} /> : null}
        {!feed && !loading ? <LiveScreenFrame bot={bot} /> : null}
        {!feed && loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-xs text-(--ui-text-secondary)">
            <GlyphSpinner /> Loading work…
          </div>
        ) : null}
      </ScrollArea>
    </div>
  )
}
