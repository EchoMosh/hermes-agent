/** Profile-safe data door for the contextual Computer pane. */

/* eslint-disable no-restricted-imports -- This bundled pane extends hermes-bots' selected canonical Bot Chat. */

import { host, type PluginProfileRoute } from '@hermes/plugin-sdk'

import { resolveBotConnectionRoute } from '../hermes-bots/routing'
import type { RosterRow } from '../hermes-bots/types'

import type { ComputerFeed } from './types'

export interface ComputerTarget {
  key: string
  profile: string
  route: PluginProfileRoute | string
  sessionId: string
}

/**
 * Freeze the three authorities every read needs. The roster's canonical
 * session is the only chat this pane follows; neither recency nor the active
 * gateway can substitute another id.
 */
export function computerTarget(bot: RosterRow): ComputerTarget | null {
  const sessionId = String(bot.canonical_session?.resolved_id || bot.canonical_session?.id || '').trim()

  if (!sessionId) {
    return null
  }

  const resolved = resolveBotConnectionRoute(bot)

  if (resolved.status === 'owner_removed') {
    return null
  }

  const route = resolved.route ?? bot.name
  const profile = typeof route === 'string' ? route : route.targetProfile || route.profile
  const connection = typeof route === 'string' ? 'local' : route.connectionId

  return {
    key: `${connection}\0${profile}\0${sessionId}`,
    profile,
    route,
    sessionId
  }
}

export function requestComputerFeed(
  target: ComputerTarget,
  options: { after?: number; limit?: number } = {}
): Promise<ComputerFeed> {
  return host.requestProfile<ComputerFeed>(target.route, 'computer.feed', {
    after: options.after ?? 0,
    limit: options.limit ?? 240,
    profile: target.profile,
    session_id: target.sessionId
  })
}

/** Incremental replies carry only calls touched after the previous cursor. */
export function mergeComputerFeed(previous: ComputerFeed | null, next: ComputerFeed): ComputerFeed {
  if (!previous || previous.session.id !== next.session.id) {
    return next
  }

  const steps = new Map(previous.steps.map(step => [step.id, step]))

  for (const step of next.steps) {
    steps.set(step.id, step)
  }

  return {
    ...next,
    steps: [...steps.values()].sort((left, right) => left.seq - right.seq).slice(-500)
  }
}
