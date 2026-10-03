/** Read-only projection of the stores that already own Bot Mode and Kanban. */

/* eslint-disable no-restricted-imports -- This bundled inbox joins existing desktop plugins without duplicating their state. */

import { $sessionDotStateById, host, queryClient } from '@hermes/plugin-sdk'

import { $botMeta, $lastRoster } from '../hermes-bots/data'
import { $groupActivity } from '../hermes-bots/group-activity'
import { $groupChats, $groupClarify, $groupNeedsYou } from '../hermes-bots/group-chat'
import { openGroupChat } from '../hermes-bots/group-chat-view'
import { displayName } from '../hermes-bots/labels'
import { openRosterBot } from '../hermes-bots/roster-actions'
import { botRosterMeta } from '../hermes-bots/routing'
import { botCanonicalSessionId } from '../hermes-bots/row-helpers'
import { $boardSlug, boardKey, kanbanConnectionScope } from '../kanban/api'
import type { KanbanBoard } from '../kanban/types'

import type { BotActivityTarget, BotChannelActivitySource, GroupRoomActivitySource } from './model'
import {
  bindActivityInboxActions,
  setActivityBotChannels,
  setActivityGroupRooms,
  setActivityKanbanTasks
} from './store'

/** The action re-resolves a current roster owner. Snapshot ids from Activity
 * are never used as a navigation pointer after compression or reconnection. */
function matchingBot(target: BotActivityTarget) {
  return $lastRoster.get().find(bot => {
    if (bot.name !== target.profile || !bot.canonical_session?.id) {
      return false
    }

    if (target.route) {
      return (
        bot.route?.connectionId === target.route.connectionId &&
        bot.route?.profile === target.route.profile &&
        bot.route?.targetProfile === target.route.targetProfile
      )
    }

    return (bot.connectionId || '') === (target.connectionId || '')
  })
}

export function projectBotActivity(): BotChannelActivitySource[] {
  const dots = $sessionDotStateById.get()
  const meta = $botMeta.get()

  return $lastRoster.get().flatMap(bot => {
    const chat = bot.canonical_session
    const id = botCanonicalSessionId(bot)

    if (!chat?.id || !id || bot.ghost || bot.sourceMissing || botRosterMeta(bot, meta)?.hidden) {
      return []
    }

    const unread = dots[id] === 'unread' || dots[chat.id] === 'unread'

    if (!unread) {
      return []
    }

    return [
      {
        canonicalChat: {
          id: chat.id,
          resolvedId: chat.resolved_id,
          lastActive: chat.last_active,
          preview: chat.preview
        },
        connectionId: bot.connectionId,
        label: displayName(bot, botRosterMeta(bot, meta)),
        profile: bot.name,
        ...(bot.route ? { route: bot.route } : {}),
        unread
      }
    ]
  })
}

export function projectGroupActivity(): GroupRoomActivitySource[] {
  const rooms = $groupChats.get()
  const needsYou = $groupNeedsYou.get()
  const prompts = Object.values($groupClarify.get())
  const activity = $groupActivity.get()

  return Object.entries(rooms).flatMap(([name, room]) => {
    if (room.tombstone) {
      return []
    }

    const pending = prompts.filter(prompt => prompt.group === name)
    const events = activity[name]?.events || []

    return [
      {
        name,
        epoch: room.epoch,
        needsYou: needsYou[name] === true,
        pendingPromptCount: pending.length,
        pendingPromptAt: Math.max(0, ...pending.map(prompt => prompt.at)),
        lastActivityAt: Math.max(0, ...room.log.map(entry => entry.at)),
        events: events.map(event => ({
          at: event.at,
          epoch: event.epoch,
          kind: event.kind,
          member: event.member,
          preview: event.preview,
          reason: event.reason
        }))
      }
    ]
  })
}

export function projectKanbanActivity() {
  const scope = kanbanConnectionScope()
  const slug = $boardSlug.get()
  const board = queryClient.getQueryData<KanbanBoard>(boardKey(scope, slug, false))

  if (!board) {
    return []
  }

  return board.columns.flatMap(column =>
    column.tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      boardSlug: slug,
      blockKind: task.block_kind,
      createdAt: task.created_at,
      latestSummary: task.latest_summary
    }))
  )
}

/** Register once with the Activity plugin; each source publishes only on its
 * own store's changes. No polling, backend writes, or invented activity. */
export function bindActivitySources(): () => void {
  setActivityBotChannels(projectBotActivity())
  setActivityGroupRooms(projectGroupActivity())
  setActivityKanbanTasks(projectKanbanActivity())

  let disposed = false
  let botQueued = false
  let roomQueued = false
  let kanbanQueued = false

  const scheduleBot = () => {
    if (botQueued) {return}
    botQueued = true
    queueMicrotask(() => {
      botQueued = false

      if (!disposed) {setActivityBotChannels(projectBotActivity())}
    })
  }

  const scheduleRooms = () => {
    if (roomQueued) {return}
    roomQueued = true
    queueMicrotask(() => {
      roomQueued = false

      if (!disposed) {setActivityGroupRooms(projectGroupActivity())}
    })
  }

  const scheduleKanban = () => {
    if (kanbanQueued) {return}
    kanbanQueued = true
    queueMicrotask(() => {
      kanbanQueued = false

      if (!disposed) {setActivityKanbanTasks(projectKanbanActivity())}
    })
  }

  const disposers = [
    $lastRoster.listen(scheduleBot),
    $botMeta.listen(scheduleBot),
    $sessionDotStateById.listen(scheduleBot),
    $groupChats.listen(scheduleRooms),
    $groupNeedsYou.listen(scheduleRooms),
    $groupClarify.listen(scheduleRooms),
    $groupActivity.listen(scheduleRooms),
    $boardSlug.listen(scheduleKanban),
    host.state.connectionId.listen(scheduleKanban),
    queryClient.getQueryCache().subscribe(scheduleKanban),
    bindActivityInboxActions({
      openBot: target => {
        const bot = matchingBot(target)

        if (bot) {
          void openRosterBot(bot)
        }
      },
      openGroup: target => {
        if ($groupChats.get()[target.name] && !$groupChats.get()[target.name]?.tombstone) {
          openGroupChat(target.name)
        }
      }
    })
  ]

  return () => {
    disposed = true

    for (const dispose of disposers) {
      dispose()
    }

    setActivityBotChannels([])
    setActivityGroupRooms([])
    setActivityKanbanTasks([])
  }
}
