/** Durable mutation boundary for reactions on group-room log entries. */

import { $groupChats, assignLegacyThreads, updateGroupChat } from './group-chat'
import { groupReactionActorKey, mergeGroupMessageReactions } from './group-message-reactions'
import type { GroupMessageAuthor, GroupMessageReaction } from './types'

function normalizedEmoji(emoji: null | string): null | string {
  return emoji === null
    ? null
    : String(emoji || '')
        .trim()
        .slice(0, 32)
}

/** Set one participant's reaction exactly. Unlike the picker-facing toggle,
 * this is idempotent: replaying a persisted agent reaction from a member's
 * hidden turn cannot retract it on the second poll or another Desktop. */
export function setGroupMessageReaction(
  group: string,
  messageId: string,
  emoji: null | string,
  from: GroupMessageAuthor,
  at = Date.now()
): GroupMessageReaction | null {
  const room = $groupChats.get()[group]
  const stableLog = assignLegacyThreads(Array.isArray(room?.log) ? room.log : [])
  const target = stableLog.find(entry => entry.id === messageId)
  const normalized = normalizedEmoji(emoji)

  if (!target || normalized === '') {
    return null
  }

  const actorKey = groupReactionActorKey(from)

  const current = mergeGroupMessageReactions(undefined, target.reactions).find(
    reaction => groupReactionActorKey(reaction.from) === actorKey
  )

  const rawAt = Number(at)

  const next: GroupMessageReaction = {
    at: Number.isFinite(rawAt) ? Math.max(0, rawAt) : Date.now(),
    emoji: normalized,
    from: {
      ...from
    }
  }

  // A compact remote mirror can replay an older observation after a newer
  // one. Keep the newest per-actor slot, and avoid a redundant persistence
  // write when two pollers observed the same durable reaction.
  if (
    current &&
    (current.at > next.at ||
      (current.at === next.at &&
        current.emoji === next.emoji &&
        groupReactionActorKey(current.from) === groupReactionActorKey(next.from)))
  ) {
    return current
  }

  updateGroupChat(group, currentRoom => ({
    ...currentRoom,
    log: stableLog.map(entry =>
      entry.id === messageId
        ? {
            ...entry,
            reactions: mergeGroupMessageReactions(
              (entry.reactions || []).filter(reaction => groupReactionActorKey(reaction.from) !== actorKey),
              [next]
            )
          }
        : entry
    )
  }))

  return next
}

/** Toggle one participant's reaction on a stable room-log entry. This mutates
 * the existing entry only: log length and member watermarks stay unchanged,
 * so a tapback can never be mistaken for a new user turn. */
export function toggleGroupMessageReaction(
  group: string,
  messageId: string,
  emoji: null | string,
  from: GroupMessageAuthor = { kind: 'user', name: 'You' },
  at = Date.now()
): GroupMessageReaction | null {
  const room = $groupChats.get()[group]
  const stableLog = assignLegacyThreads(Array.isArray(room?.log) ? room.log : [])
  const target = stableLog.find(entry => entry.id === messageId)
  const normalized = normalizedEmoji(emoji)

  if (!target || normalized === '') {
    return null
  }

  const actorKey = groupReactionActorKey(from)

  const current = mergeGroupMessageReactions(undefined, target.reactions).find(
    reaction => groupReactionActorKey(reaction.from) === actorKey
  )

  return setGroupMessageReaction(group, messageId, normalized === null || current?.emoji === normalized ? null : normalized, from, at)
}
