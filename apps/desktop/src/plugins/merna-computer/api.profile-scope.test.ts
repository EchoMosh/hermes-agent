/* eslint-disable no-restricted-imports -- Exercises the bundled hermes-bots extension boundary. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as routing from '../hermes-bots/routing'
import type { RosterRow } from '../hermes-bots/types'

import type { ComputerFeed } from './types'

const requestProfile = vi.hoisted(() => vi.fn())

vi.mock('@hermes/plugin-sdk', () => ({
  host: { requestProfile }
}))

vi.mock('../hermes-bots/routing', async importOriginal => {
  const actual = await importOriginal<typeof routing>()

  return {
    ...actual,
    resolveBotConnectionRoute: (bot: RosterRow) => ({ status: 'resolved', route: bot.route! })
  }
})

import { computerTarget, mergeComputerFeed, requestComputerFeed } from './api'

const bot = (connectionId: string, profile: string, sessionId: string): RosterRow => ({
  canonical_session: { id: `root-${sessionId}`, resolved_id: sessionId },
  name: profile,
  route: { connectionId, mode: 'remote', profile, targetProfile: profile },
  sourceScoped: true
})

const feed = (sessionId: string, cursor: number): ComputerFeed => ({
  cursor,
  helpers: [],
  now: 1,
  plan: null,
  say: null,
  session: {
    ended_at: null,
    id: sessionId,
    last_activity_at: 1,
    model: 'test',
    started_at: 1,
    status: 'running',
    title: 'Bot Chat',
    tool_calls: 1
  },
  steps: []
})

describe('Merna Computer profile scope', () => {
  beforeEach(() => {
    requestProfile.mockReset()
  })

  it('keeps A → B → A bound to each bot connection, profile and canonical tip', async () => {
    requestProfile.mockImplementation(async (_route, _method, params) => feed(params.session_id, params.after))

    const a = computerTarget(bot('connection-a', 'alpha', 'alpha-tip'))!
    const b = computerTarget(bot('connection-b', 'beta', 'beta-tip'))!

    await requestComputerFeed(a)
    await requestComputerFeed(b)
    await requestComputerFeed(a, { after: 42 })

    expect(requestProfile.mock.calls.map(([route, method, params]) => [route.connectionId, method, params])).toEqual([
      ['connection-a', 'computer.feed', { after: 0, limit: 240, profile: 'alpha', session_id: 'alpha-tip' }],
      ['connection-b', 'computer.feed', { after: 0, limit: 240, profile: 'beta', session_id: 'beta-tip' }],
      ['connection-a', 'computer.feed', { after: 42, limit: 240, profile: 'alpha', session_id: 'alpha-tip' }]
    ])
    expect(a.key).not.toBe(b.key)
  })

  it('drops incremental state when the canonical session changes', () => {
    const previous = feed('alpha-tip', 10)
    previous.steps = [
      {
        done_ts: 2,
        error: null,
        id: 'old',
        kind: 'browser',
        preview: null,
        seq: 1,
        status: 'ok',
        title: 'Opening example.com',
        tool: 'browser_exec',
        ts: 1
      }
    ]

    expect(mergeComputerFeed(previous, feed('beta-tip', 1)).steps).toEqual([])
  })
})
