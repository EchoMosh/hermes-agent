/**
 * Pure identity and merge rules for group-room messages and reactions.
 *
 * The room store owns persistence and sync. Keeping the value semantics here
 * lets the store, UI, and tests share one contract without growing the
 * already-large room orchestration module.
 */

import type { GroupMessage, GroupMessageAuthor, GroupMessageReaction } from './types'

/** Historical room entries predate UUIDs. Derive their id from the durable
 * message body instead of an array position, so a bounded mirror, a cold
 * reload, and another Desktop all name the same entry. */
function legacyGroupMessageId(entry: GroupMessage): string {
  const thread = String(entry?.thread || 'legacy').replace(/^legacy-\d+$/, 'legacy')

  const seed = JSON.stringify([
    Number(entry?.at || 0),
    String(entry?.from?.kind || ''),
    String(entry?.from?.name || ''),
    // Older bounded mirrors did not carry `gateway`; `source` was the shared
    // author qualifier, so legacy identity must stay within that old shape.
    String(entry?.from?.source || ''),
    thread,
    // The bounded gateway projection omits attachments, so they cannot be
    // part of a cross-client identity derived for an older id-less entry.
    String(entry?.text || '')
  ])

  let first = 0x811c9dc5
  let second = 0x9e3779b9

  for (let index = 0; index < seed.length; index++) {
    const code = seed.charCodeAt(index)

    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
  }

  return `legacy-${first.toString(36)}-${second.toString(36)}`
}

/** Stable room-log identity without borrowing a member session id. */
export function groupMessageWithStableId(entry: GroupMessage): GroupMessage {
  return entry?.id
    ? entry
    : {
        ...entry,
        id: legacyGroupMessageId(entry)
      }
}

/** Reaction identity is durable across Desktop labels: prefer the gateway
 * install id, then the source label only for older member records. */
export function groupReactionActorKey(from: GroupMessageAuthor): string {
  if (from?.kind === 'user') {
    return 'user'
  }

  return ['member', String(from?.gateway || from?.source || ''), String(from?.name || '')].join(':')
}

function normalizedGroupReaction(reaction: GroupMessageReaction): GroupMessageReaction | null {
  if (!reaction || !reaction.from || (reaction.from.kind !== 'user' && reaction.from.kind !== 'member')) {
    return null
  }

  const emoji =
    reaction.emoji === null
      ? null
      : String(reaction.emoji || '')
          .trim()
          .slice(0, 32)

  if (emoji === '') {
    return null
  }

  const rawAt = Number(reaction.at)

  return {
    at: Number.isFinite(rawAt) ? Math.max(0, rawAt) : 0,
    emoji,
    from: {
      kind: reaction.from.kind,
      name: String(reaction.from.name || (reaction.from.kind === 'user' ? 'You' : 'Bot')).slice(0, 128),
      ...(reaction.from.gateway
        ? {
            gateway: String(reaction.from.gateway).slice(0, 128)
          }
        : {}),
      ...(reaction.from.source
        ? {
            source: String(reaction.from.source).slice(0, 128)
          }
        : {})
    }
  }
}

/** Merge per-participant reaction slots. Retraction tombstones remain in the
 * durable list, and the newest timestamp wins independently for each actor. */
export function mergeGroupMessageReactions(
  earlier: GroupMessageReaction[] | undefined,
  later: GroupMessageReaction[] | undefined
): GroupMessageReaction[] {
  const byActor = new Map<string, GroupMessageReaction>()

  for (const raw of [...(earlier || []), ...(later || [])]) {
    const reaction = normalizedGroupReaction(raw)

    if (!reaction) {
      continue
    }

    const key = groupReactionActorKey(reaction.from)
    const current = byActor.get(key)

    if (!current || reaction.at >= current.at) {
      byActor.set(key, reaction)
    }
  }

  return [...byActor.values()].sort((left, right) =>
    groupReactionActorKey(left.from).localeCompare(groupReactionActorKey(right.from))
  )
}

/** Merge a compact copy into the preferred rich room entry. */
export function mergeGroupMessageEntries(preferred: GroupMessage, other: GroupMessage): GroupMessage {
  const reactions = mergeGroupMessageReactions(other?.reactions, preferred?.reactions)

  return {
    ...other,
    ...preferred,
    ...(reactions.length
      ? {
          reactions
        }
      : {})
  }
}

export interface GroupMessageReactionCount {
  count: number
  emoji: string
  selected: boolean
}

/** Active reaction counts for rendering. Durable null tombstones stay hidden. */
export function groupMessageReactionCounts(
  reactions: GroupMessageReaction[] | undefined,
  viewer: GroupMessageAuthor = { kind: 'user', name: 'You' }
): GroupMessageReactionCount[] {
  const viewerKey = groupReactionActorKey(viewer)
  const counts = new Map<string, GroupMessageReactionCount>()

  for (const reaction of mergeGroupMessageReactions(undefined, reactions)) {
    if (!reaction.emoji) {
      continue
    }

    const current = counts.get(reaction.emoji) || {
      count: 0,
      emoji: reaction.emoji,
      selected: false
    }

    current.count += 1
    current.selected ||= groupReactionActorKey(reaction.from) === viewerKey
    counts.set(reaction.emoji, current)
  }

  return [...counts.values()].sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji))
}
