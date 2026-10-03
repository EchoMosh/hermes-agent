/* eslint-disable no-restricted-imports -- This bundled pane shares Hermes Bots' selected chat context. */

import { describe, expect, it } from 'vitest'

import { botRosterKey } from '../hermes-bots/data'
import type { RosterRow } from '../hermes-bots/types'

import { selectedWorkBot } from './plugin'

describe('Work pane context', () => {
  const teammate = { name: 'testgh' } as RosterRow
  const roster = [teammate]

  it('follows a selected teammate in a direct chat', () => {
    expect(selectedWorkBot(roster, botRosterKey(teammate), null)).toBe(teammate)
  })

  it('does not show an old direct-chat computer in a channel', () => {
    expect(selectedWorkBot(roster, botRosterKey(teammate), 'testgh-hermes')).toBeNull()
  })
})
