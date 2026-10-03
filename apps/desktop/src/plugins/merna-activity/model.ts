/**
 * Framework-free Activity inbox model.
 *
 * Every source carries the identity of an existing backend object. The model
 * never mints a chat task, guesses a session from recency, or turns prose into
 * a Kanban card. Callers adapt their live atoms/query results into these small
 * structural inputs, then route clicks through the matching owner callback.
 */

export interface CanonicalChatActivitySource {
  /** Durable "Bot Chat" registry id. */
  id: string
  /** Compression-lineage tip. UI opens this id when present. */
  resolvedId?: null | string
  /** Unix seconds or milliseconds. */
  lastActive?: null | number
  preview?: null | string
}

export interface ActivityProfileRoute {
  connectionId: string
  mode: 'local' | 'remote'
  primary?: true
  profile: string
  targetProfile: string
}

export interface BotChannelActivitySource {
  canonicalChat: CanonicalChatActivitySource
  connectionId?: null | string
  label?: null | string
  /** True only when the canonical chat's unread store claims this id. */
  unread?: boolean
  /** Explicit semantic mention signal supplied by the channel integration. */
  mentioned?: boolean
  profile: string
  /** Exact source owner. Required when duplicate profile names span gateways. */
  route?: ActivityProfileRoute
}

export interface GroupTurnActivitySource {
  /** Milliseconds in the current room implementation. */
  at: number
  epoch?: number
  kind: string
  member?: null | string
  preview?: null | string
  reason?: null | string
}

export interface GroupRoomActivitySource {
  /** Current run epoch. Failures from older epochs are ignored. */
  epoch?: number
  events?: readonly GroupTurnActivitySource[]
  /** Latest room activity time, used for a needs-you row without a prompt. */
  lastActivityAt?: null | number
  name: string
  needsYou?: boolean
  /** Pending clarify/approval prompts mirrored from member sessions. */
  pendingPromptCount?: number
  pendingPromptAt?: null | number
}

export interface KanbanTaskActivitySource {
  /** Existing backend task id. Empty ids are rejected. */
  id: string
  title: string
  status: string
  boardSlug?: null | string
  blockKind?: null | string
  /** Unix seconds or milliseconds. */
  createdAt?: null | number
  latestSummary?: null | string
  /** Future/additive backend semantics can opt a real task in explicitly. */
  approvalRequired?: boolean
  needsAttention?: boolean
}

export interface ActivityInboxSources {
  botChannels?: readonly BotChannelActivitySource[]
  groupRooms?: readonly GroupRoomActivitySource[]
  kanbanTasks?: readonly KanbanTaskActivitySource[]
}

export interface BotActivityTarget {
  connectionId?: string
  /** Snapshot identity for assertions/display correlation. The owner callback
   *  still opens by profile + exact "Bot Chat" title registry, every click. */
  registrySessionId: string
  profile: string
  route?: ActivityProfileRoute
  /** Snapshot compression tip. It is not a persisted navigation pointer. */
  sessionId: string
}

export interface GroupActivityTarget {
  name: string
}

export interface KanbanTaskTarget {
  boardSlug?: string
  taskId: string
}

interface ActivityItemBase {
  /** Milliseconds, normalized across gateway and Kanban payloads. */
  at: number
  id: string
  preview: string
  title: string
}

export interface BotActivityItem extends ActivityItemBase {
  kind: 'bot'
  mentioned: boolean
  signal: 'mention' | 'unread'
  target: BotActivityTarget
  unread: boolean
}

export interface GroupNeedsYouActivityItem extends ActivityItemBase {
  kind: 'group'
  pendingPromptCount: number
  signal: 'needs-you'
  target: GroupActivityTarget
}

export interface GroupFailureActivityItem extends ActivityItemBase {
  kind: 'group'
  member?: string
  reason?: string
  signal: 'turn-failure'
  target: GroupActivityTarget
}

export interface KanbanActivityItem extends ActivityItemBase {
  kind: 'kanban'
  signal: 'approval' | 'task'
  status: string
  target: KanbanTaskTarget
}

export type ActivityInboxItem =
  BotActivityItem | GroupFailureActivityItem | GroupNeedsYouActivityItem | KanbanActivityItem

const ACTION_RANK: Record<ActivityInboxItem['signal'], number> = {
  mention: 0,
  'needs-you': 0,
  approval: 0,
  'turn-failure': 1,
  unread: 2,
  task: 2
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function milliseconds(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0

  // Gateway/session and Kanban timestamps are Unix seconds; room activity is
  // Date.now(). Normalize before sorting the mixed feed.
  return n > 0 && n < 10_000_000_000 ? n * 1000 : n
}

function routePart(value: unknown, fallback: string): string {
  return encodeURIComponent(text(value) || fallback)
}

/** Bot/channel protocol address for a human handoff. Only the exact @user
 * token counts; email addresses and longer handles stay ordinary preview. */
export function canonicalChatMentionsUser(preview: unknown): boolean {
  return /(^|[^\p{L}\p{N}._-])@user(?=$|[^\p{L}\p{N}._-]|\.(?=\s|$))/iu.test(text(preview))
}

function botItems(sources: readonly BotChannelActivitySource[]): BotActivityItem[] {
  const items: BotActivityItem[] = []

  for (const source of sources) {
    const profile = text(source.profile)
    const registrySessionId = text(source.canonicalChat?.id)
    const sessionId = text(source.canonicalChat?.resolvedId) || registrySessionId
    const unread = source.unread === true
    const mentioned = source.mentioned === true || (unread && canonicalChatMentionsUser(source.canonicalChat.preview))

    // A canonical identity and a real attention signal are both required.
    if (!profile || !registrySessionId || !sessionId || (!unread && !mentioned)) {
      continue
    }

    const connectionId = text(source.route?.connectionId) || text(source.connectionId)

    const target: BotActivityTarget = {
      ...(connectionId ? { connectionId } : {}),
      profile,
      registrySessionId,
      ...(source.route ? { route: { ...source.route } } : {}),
      sessionId
    }

    items.push({
      at: milliseconds(source.canonicalChat.lastActive),
      id: `bot:${routePart(connectionId, 'local')}:${routePart(profile, 'default')}:${routePart(sessionId, 'chat')}`,
      kind: 'bot',
      mentioned,
      preview: text(source.canonicalChat.preview),
      signal: mentioned ? 'mention' : 'unread',
      target,
      title: text(source.label) || profile,
      unread
    })
  }

  return items
}

function groupItems(sources: readonly GroupRoomActivitySource[]): ActivityInboxItem[] {
  const items: ActivityInboxItem[] = []

  for (const source of sources) {
    const name = text(source.name)

    if (!name) {
      continue
    }

    const target = { name }
    const promptCount = Math.max(0, Math.floor(source.pendingPromptCount || 0))

    if (source.needsYou === true || promptCount > 0) {
      items.push({
        at: milliseconds(source.pendingPromptAt || source.lastActivityAt),
        id: `group:${routePart(name, 'room')}:needs-you`,
        kind: 'group',
        pendingPromptCount: promptCount,
        preview: '',
        signal: 'needs-you',
        target,
        title: name
      })
    }

    const failures = (source.events || []).filter(event => {
      const currentEpoch = source.epoch
      const sameRun = currentEpoch === undefined || event.epoch === undefined || event.epoch === currentEpoch

      return sameRun && (event.kind === 'failed' || event.kind === 'timed-out')
    })

    // One row per room is enough to route the user to the failed run. Keep the
    // latest real failure rather than manufacturing a summary event.
    const failure = failures.reduce<GroupTurnActivitySource | null>(
      (latest, event) => (!latest || milliseconds(event.at) > milliseconds(latest.at) ? event : latest),
      null
    )

    if (failure) {
      const at = milliseconds(failure.at)
      const member = text(failure.member)
      const reason = text(failure.reason)

      items.push({
        at,
        id: `group:${routePart(name, 'room')}:failure:${source.epoch ?? failure.epoch ?? 0}:${at}:${routePart(member, 'member')}`,
        kind: 'group',
        ...(member ? { member } : {}),
        preview: text(failure.preview),
        ...(reason ? { reason } : {}),
        signal: 'turn-failure',
        target,
        title: name
      })
    }
  }

  return items
}

/** Only states with proven user work enter Activity. Running/ready/completed
 *  cards remain on the board; a regular chat message never calls this path. */
export function kanbanActivitySignal(task: KanbanTaskActivitySource): KanbanActivityItem['signal'] | null {
  if (task.approvalRequired === true || task.status === 'review') {
    return 'approval'
  }

  if (
    task.needsAttention === true ||
    task.status === 'triage' ||
    (task.status === 'blocked' && task.blockKind === 'needs_input')
  ) {
    return 'task'
  }

  return null
}

function kanbanItems(sources: readonly KanbanTaskActivitySource[]): KanbanActivityItem[] {
  const items: KanbanActivityItem[] = []

  for (const source of sources) {
    const taskId = text(source.id)
    const title = text(source.title)
    const signal = kanbanActivitySignal(source)

    if (!taskId || !title || !signal) {
      continue
    }

    const boardSlug = text(source.boardSlug)

    const target: KanbanTaskTarget = {
      ...(boardSlug ? { boardSlug } : {}),
      taskId
    }

    items.push({
      at: milliseconds(source.createdAt),
      id: `kanban:${routePart(boardSlug, 'current')}:${routePart(taskId, 'task')}`,
      kind: 'kanban',
      preview: text(source.latestSummary),
      signal,
      status: source.status,
      target,
      title
    })
  }

  return items
}

/** Build the single Activity stream without taking ownership of any source. */
export function buildActivityInbox(sources: ActivityInboxSources): ActivityInboxItem[] {
  const items = [
    ...botItems(sources.botChannels || []),
    ...groupItems(sources.groupRooms || []),
    ...kanbanItems(sources.kanbanTasks || [])
  ]

  return items.sort(
    (left, right) =>
      ACTION_RANK[left.signal] - ACTION_RANK[right.signal] || right.at - left.at || left.id.localeCompare(right.id)
  )
}
