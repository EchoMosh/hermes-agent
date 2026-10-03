import { cn, Codicon, host, relativeTime } from '@hermes/plugin-sdk'
import type { ComponentProps, ReactNode } from 'react'

import {
  type ActivityInboxItem,
  type ActivityInboxSources,
  type BotActivityTarget,
  buildActivityInbox,
  type GroupActivityTarget,
  type KanbanTaskTarget
} from './model'

export type ActivityInboxLabels = {
  activity: string
  approval: string
  empty: string
  failed: string
  mentionedYou: string
  needsYou: string
  open: string
  prompts: (count: number) => string
  taskNeedsYou: string
  unread: string
}

export const DEFAULT_ACTIVITY_LABELS: ActivityInboxLabels = {
  activity: 'Activity',
  approval: 'Ready for approval',
  empty: 'You’re all caught up.',
  failed: 'Turn failed',
  mentionedYou: 'Mentioned you',
  needsYou: 'Needs you',
  open: 'Open',
  prompts: count => `${count} pending ${count === 1 ? 'prompt' : 'prompts'}`,
  taskNeedsYou: 'Task needs attention',
  unread: 'Unread'
}

export interface ActivityInboxProps extends Omit<ComponentProps<'section'>, 'children'> {
  labels?: Partial<ActivityInboxLabels>
  maxItems?: number
  onOpenBot?: (target: BotActivityTarget) => void
  onOpenGroup?: (target: GroupActivityTarget) => void
  onOpenTask?: (target: KanbanTaskTarget) => void
  sources: ActivityInboxSources
}

export function kanbanTaskPath(target: KanbanTaskTarget): string {
  const taskId = target.taskId.trim()

  if (!taskId) {
    return '/kanban'
  }

  const search = new URLSearchParams()
  const boardSlug = target.boardSlug?.trim()

  if (boardSlug) {
    search.set('board', boardSlug)
  }

  search.set('task', taskId)

  return `/kanban?${search.toString()}`
}

export interface ChannelTaskLinkProps extends Omit<ComponentProps<'button'>, 'onClick'> {
  onOpenTask?: (target: KanbanTaskTarget) => void
  target: KanbanTaskTarget
}

/** A real Kanban task deep-link. It has no create path: an empty task id is a
 * disabled control, and the board verifies the id before opening its drawer. */
export function ChannelTaskLink({ children, className, onOpenTask, target, ...props }: ChannelTaskLinkProps) {
  const valid = Boolean(target.taskId.trim())

  const open = () => {
    if (!valid) {
      return
    }

    if (onOpenTask) {
      onOpenTask(target)
    } else {
      host.navigate(kanbanTaskPath(target))
    }
  }

  return (
    <button
      {...props}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md border border-(--ui-border-muted) px-2.5 py-2 text-left',
        'bg-(--ui-bg-secondary) transition-colors hover:border-(--ui-border) hover:bg-(--ui-bg-tertiary)',
        'disabled:cursor-default disabled:opacity-50',
        className
      )}
      disabled={!valid || props.disabled}
      onClick={open}
      type="button"
    >
      {children}
    </button>
  )
}

function SignalPill({ children, tone = 'quiet' }: { children: ReactNode; tone?: 'attention' | 'danger' | 'quiet' }) {
  const tones = {
    attention: 'bg-amber-500/12 text-amber-500',
    danger: 'bg-red-500/12 text-red-500',
    quiet: 'bg-(--ui-bg-quaternary) text-(--ui-text-secondary)'
  }

  return <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
}

function ItemText({ item, labels }: { item: ActivityInboxItem; labels: ActivityInboxLabels }) {
  const signal =
    item.signal === 'mention'
      ? labels.mentionedYou
      : item.signal === 'unread'
        ? labels.unread
        : item.signal === 'needs-you'
          ? item.pendingPromptCount > 0
            ? labels.prompts(item.pendingPromptCount)
            : labels.needsYou
          : item.signal === 'turn-failure'
            ? labels.failed
            : item.signal === 'approval'
              ? labels.approval
              : labels.taskNeedsYou

  const tone =
    item.signal === 'turn-failure'
      ? 'danger'
      : ['mention', 'needs-you', 'approval'].includes(item.signal)
        ? 'attention'
        : 'quiet'

  const detail =
    item.signal === 'turn-failure'
      ? [item.member, item.reason].filter(Boolean).join(' · ')
      : item.kind === 'kanban'
        ? item.status
        : ''

  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
          <SignalPill tone={tone}>{signal}</SignalPill>
        </span>
        {(detail || item.preview) && (
          <span className="mt-0.5 block truncate text-xs text-(--ui-text-tertiary)">
            {detail || item.preview}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-(--ui-text-tertiary)">
        {item.at > 0 ? relativeTime(item.at) : null}
        <Codicon aria-label={labels.open} name="chevron-right" size="0.7rem" />
      </span>
    </>
  )
}

export function ActivityInbox({
  className,
  labels: labelOverrides,
  maxItems = 20,
  onOpenBot,
  onOpenGroup,
  onOpenTask,
  sources,
  ...props
}: ActivityInboxProps) {
  const labels = { ...DEFAULT_ACTIVITY_LABELS, ...labelOverrides }
  const items = buildActivityInbox(sources).slice(0, Math.max(0, maxItems))

  return (
    <section {...props} className={cn('flex min-h-0 flex-col', className)}>
      <header className="flex shrink-0 items-center gap-2 px-2.5 py-2">
        <h2 className="text-sm font-semibold text-foreground">{labels.activity}</h2>
        {items.length > 0 && (
          <span className="rounded-full bg-(--ui-bg-quaternary) px-1.5 text-xs tabular-nums text-(--ui-text-tertiary)">
            {items.length}
          </span>
        )}
      </header>

      {items.length === 0 ? (
        <p className="px-2.5 py-5 text-center text-sm text-(--ui-text-tertiary)">{labels.empty}</p>
      ) : (
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto px-1.5 pb-2">
          {items.map(item => {
            const content = <ItemText item={item} labels={labels} />

            if (item.kind === 'kanban') {
              return (
                <ChannelTaskLink key={item.id} onOpenTask={onOpenTask} target={item.target}>
                  {content}
                </ChannelTaskLink>
              )
            }

            const canOpen = item.kind === 'bot' ? Boolean(onOpenBot) : Boolean(onOpenGroup)

            return (
              <button
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                  'hover:bg-(--ui-bg-secondary)',
                  'disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent'
                )}
                disabled={!canOpen}
                key={item.id}
                onClick={() => (item.kind === 'bot' ? onOpenBot?.(item.target) : onOpenGroup?.(item.target))}
                type="button"
              >
                {content}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
