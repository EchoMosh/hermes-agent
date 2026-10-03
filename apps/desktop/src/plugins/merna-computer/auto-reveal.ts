/**
 * Foreground-only reveal for the contextual Computer pane.
 *
 * The gateway carries live tool events for every retained profile and source,
 * so a profile match alone is not enough. A reveal is allowed only when the
 * event belongs to the selected roster row, its canonical Bot Chat is the
 * focused stored session, and its runtime id is the focused runtime session.
 */

/* eslint-disable no-restricted-imports -- This bundled pane extends hermes-bots' selected canonical Bot Chat. */

import { atom, host } from '@hermes/plugin-sdk'
import type { RpcEvent } from '@hermes/plugin-sdk'

import { $botsPaneVisible, $selectedRosterKey } from '../hermes-bots/bot-state'
import { isCanonicalChatOnScreen } from '../hermes-bots/canonical-chat'
import { $lastRoster, botRosterKey } from '../hermes-bots/data'
import { resolveBotConnectionRoute } from '../hermes-bots/routing'
import type { RosterRow } from '../hermes-bots/types'

export const MERNA_COMPUTER_PANE_ID = 'merna-computer:pane'
export const COMPUTER_REVEAL_COOLDOWN_MS = 30_000

const COMPUTER_TOOL_PREFIXES = ['computer_use', 'browser_']
let lastRevealAt = 0

/** A successful foreground reveal asks an already-mounted pane to return to Work. */
export const $computerRevealEpoch = atom(0)

export function isComputerForegroundTool(name: null | string | undefined): boolean {
  return typeof name === 'string' && COMPUTER_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))
}

function sameConnection(expected: null | string | undefined, actual: null | string | undefined): boolean {
  const left = String(expected || 'local')
  const right = String(actual || 'local')

  return left === right
}

/** Does this event carry the selected bot's complete source/profile identity? */
export function eventMatchesBot(bot: RosterRow, event: Pick<RpcEvent, 'connectionId' | 'profile'>): boolean {
  const resolved = resolveBotConnectionRoute(bot)

  if (resolved.status === 'owner_removed') {
    return false
  }

  const route = resolved.route
  const expectedConnection = route?.connectionId ?? (bot.connectionId || null)
  const expectedProfile = String(route?.targetProfile || route?.profile || bot.name || '').trim()

  return (
    Boolean(expectedProfile) &&
    expectedProfile === String(event.profile || '').trim() &&
    sameConnection(expectedConnection, event.connectionId)
  )
}

function focusedOwnerMatches(bot: RosterRow): boolean {
  const owner = host.state.focusedSessionOwner?.get?.()

  // Current Desktop builds expose the connection-qualified owner. Fail closed
  // if the focused tile has not resolved one: profile-only inference can leak
  // between two registered sources with the same profile name.
  if (!owner) {
    return false
  }

  const resolved = resolveBotConnectionRoute(bot)

  if (resolved.status === 'owner_removed') {
    return false
  }

  const route = resolved.route
  const expectedConnection = route?.connectionId ?? (bot.connectionId || null)
  const expectedProfile = String(route?.targetProfile || route?.profile || bot.name || '').trim()

  return expectedProfile === owner.profile && sameConnection(expectedConnection, owner.connectionId)
}

/**
 * Handle one live tool.start. Returns true only when it revealed the pane.
 * `revealPane` changes pane visibility but does not move keyboard focus.
 */
export function handleComputerToolStart(event: RpcEvent, now = Date.now()): boolean {
  const payload = event.payload as { name?: string } | undefined

  if (event.replayed || !isComputerForegroundTool(payload?.name) || !$botsPaneVisible.get()) {
    return false
  }

  const selectedKey = $selectedRosterKey.get()
  const bot = $lastRoster.get().find(row => botRosterKey(row) === selectedKey)

  if (!selectedKey || !bot || !eventMatchesBot(bot, event) || !focusedOwnerMatches(bot)) {
    return false
  }

  const focusedStored = host.state.focusedStoredSessionId?.get?.()
  const focusedRuntime = host.state.focusedSessionId?.get?.()

  if (
    !isCanonicalChatOnScreen(bot, focusedStored) ||
    !focusedRuntime ||
    !event.session_id ||
    String(event.session_id) !== String(focusedRuntime)
  ) {
    return false
  }

  if (host.paneVisibility?.(MERNA_COMPUTER_PANE_ID)?.get?.()) {
    return false
  }

  // If the user closes the pane while a browser run is producing many calls,
  // keep it closed for the rest of that burst.
  if (lastRevealAt && now - lastRevealAt < COMPUTER_REVEAL_COOLDOWN_MS) {
    return false
  }

  lastRevealAt = now
  $computerRevealEpoch.set($computerRevealEpoch.get() + 1)
  host.revealPane(MERNA_COMPUTER_PANE_ID)

  return true
}

/** Test seam. */
export function resetComputerAutoReveal(): void {
  lastRevealAt = 0
  $computerRevealEpoch.set(0)
}
