/* eslint-disable no-restricted-imports -- Exercises the bundled hermes-bots extension boundary. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterRow } from '../hermes-bots/types'

const live = vi.hoisted(() => ({
  botsVisible: true,
  focusedOwner: { connectionId: 'local', profile: 'parker' } as null | { connectionId: string; profile: string },
  focusedRuntime: 'runtime-parker' as null | string,
  focusedStored: 'stored-parker' as null | string,
  paneVisible: false,
  selectedKey: 'local::parker'
}))

const revealPane = vi.hoisted(() => vi.fn())

const roster = vi.hoisted(
  () =>
    [
      {
        canonical_session: { id: 'stored-parker', resolved_id: 'tip-parker' },
        connectionId: 'local',
        name: 'parker',
        route: { connectionId: 'local', mode: 'local', profile: 'parker', targetProfile: 'parker' },
        sourceScoped: true
      },
      {
        canonical_session: { id: 'stored-alfred', resolved_id: 'tip-alfred' },
        connectionId: 'ssh-box',
        name: 'alfred',
        route: { connectionId: 'ssh-box', mode: 'remote', profile: 'alfred', targetProfile: 'alfred' },
        sourceScoped: true
      }
    ] as unknown as RosterRow[]
)

vi.mock('@hermes/plugin-sdk', () => ({
  atom: (initial: unknown) => {
    let value = initial

    return {
      get: () => value,
      listen: () => () => undefined,
      set: (next: unknown) => {
        value = next
      }
    }
  },
  host: {
    paneVisibility: () => ({ get: () => live.paneVisible }),
    revealPane,
    state: {
      focusedSessionId: { get: () => live.focusedRuntime },
      focusedSessionOwner: { get: () => live.focusedOwner },
      focusedStoredSessionId: { get: () => live.focusedStored }
    }
  }
}))

vi.mock('../hermes-bots/bot-state', () => ({
  $botsPaneVisible: { get: () => live.botsVisible },
  $selectedRosterKey: { get: () => live.selectedKey }
}))

vi.mock('../hermes-bots/data', () => ({
  $lastRoster: { get: () => roster },
  botRosterKey: (bot: RosterRow) => `${bot.connectionId || 'legacy'}::${bot.name || 'default'}`
}))

vi.mock('../hermes-bots/routing', () => ({
  resolveBotConnectionRoute: (bot: RosterRow) => ({ status: 'resolved', route: bot.route })
}))

vi.mock('../hermes-bots/canonical-chat', () => ({
  isCanonicalChatOnScreen: (bot: RosterRow, stored: null | string) =>
    Boolean(stored && [bot.canonical_session?.id, bot.canonical_session?.resolved_id].includes(stored))
}))

const toolStart = (
  name: string,
  overrides: Partial<{
    connectionId: string
    profile: string
    replayed: boolean
    session_id: string
  }> = {}
) =>
  ({
    connectionId: 'local',
    payload: { name, tool_id: 'tool-1' },
    profile: 'parker',
    session_id: 'runtime-parker',
    type: 'tool.start',
    ...overrides
  }) as never

describe('Computer pane foreground auto reveal', () => {
  beforeEach(async () => {
    live.botsVisible = true
    live.focusedOwner = { connectionId: 'local', profile: 'parker' }
    live.focusedRuntime = 'runtime-parker'
    live.focusedStored = 'stored-parker'
    live.paneVisible = false
    live.selectedKey = 'local::parker'
    revealPane.mockReset()
    const { resetComputerAutoReveal } = await import('./auto-reveal')
    resetComputerAutoReveal()
  })

  it('reveals for live computer and browser work in the selected canonical Bot Chat', async () => {
    const { $computerRevealEpoch, COMPUTER_REVEAL_COOLDOWN_MS, handleComputerToolStart, MERNA_COMPUTER_PANE_ID } =
      await import('./auto-reveal')

    expect(handleComputerToolStart(toolStart('computer_use'), 1_000)).toBe(true)
    expect(revealPane).toHaveBeenLastCalledWith(MERNA_COMPUTER_PANE_ID)
    expect($computerRevealEpoch.get()).toBe(1)

    // A later, distinct browser run can raise the activity view as well.
    expect(handleComputerToolStart(toolStart('browser_exec'), 1_000 + COMPUTER_REVEAL_COOLDOWN_MS)).toBe(true)
    expect(revealPane).toHaveBeenCalledTimes(2)
    expect($computerRevealEpoch.get()).toBe(2)
  })

  it('does not reveal for background, side-chat, replayed, hidden, or foreign-source work', async () => {
    const { handleComputerToolStart, resetComputerAutoReveal } = await import('./auto-reveal')

    const rejected = [
      () => {
        live.focusedRuntime = 'another-runtime'

        return toolStart('browser_exec')
      },
      () => {
        live.focusedRuntime = 'runtime-parker'
        live.focusedStored = 'side-chat'

        return toolStart('computer_use')
      },
      () => {
        live.focusedStored = 'stored-parker'

        return toolStart('computer_use', { replayed: true })
      },
      () => {
        live.botsVisible = false

        return toolStart('computer_use')
      },
      () => {
        live.botsVisible = true

        return toolStart('computer_use', { connectionId: 'ssh-box' })
      }
    ]

    for (const event of rejected) {
      resetComputerAutoReveal()
      expect(handleComputerToolStart(event(), 100_000)).toBe(false)
    }

    expect(revealPane).not.toHaveBeenCalled()
  })

  it('fails closed without an authoritative focused owner and respects a manual close during a burst', async () => {
    const { handleComputerToolStart } = await import('./auto-reveal')

    live.focusedOwner = null
    expect(handleComputerToolStart(toolStart('computer_use'), 1_000)).toBe(false)

    live.focusedOwner = { connectionId: 'local', profile: 'parker' }
    expect(handleComputerToolStart(toolStart('computer_use'), 2_000)).toBe(true)

    // paneVisible becoming false models the user closing/collapsing the pane.
    live.paneVisible = false
    expect(handleComputerToolStart(toolStart('browser_exec'), 3_000)).toBe(false)
    expect(revealPane).toHaveBeenCalledTimes(1)
  })

  it('ignores non-computer tools even in the selected foreground chat', async () => {
    const { handleComputerToolStart } = await import('./auto-reveal')

    expect(handleComputerToolStart(toolStart('terminal'), 10_000)).toBe(false)
    expect(revealPane).not.toHaveBeenCalled()
  })
})
