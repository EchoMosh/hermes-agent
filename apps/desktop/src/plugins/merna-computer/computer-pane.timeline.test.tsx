/* eslint-disable no-restricted-imports -- Exercises the bundled hermes-bots live-screen boundary. */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $screenState } from '../hermes-bots/screen-state'
import type { RosterRow } from '../hermes-bots/types'

import { computerIsActive, ComputerWorkSurface } from './computer-pane'
import type { ComputerFeed, ComputerStep } from './types'

vi.mock('../hermes-bots/screen-pane', () => ({
  BotScreenPane: ({ bot }: { bot: RosterRow }) => <div data-testid="live-screen">Current display · {bot.name}</div>
}))

const bot = { name: 'parker' } as RosterRow

const step = (id: string, title: string, kind: ComputerStep['kind'], ts: number): ComputerStep => ({
  done_ts: ts + 1,
  error: null,
  id,
  kind,
  preview: `${title} output`,
  seq: ts,
  status: 'ok',
  title,
  tool: kind === 'browser' ? 'browser_exec' : 'terminal',
  ts
})

const feed: ComputerFeed = {
  cursor: 3,
  helpers: [],
  now: 4,
  plan: {
    current: 'verify',
    done: 1,
    goal: 'Ship the office update',
    id: 'plan-1',
    status: 'active',
    steps: [
      { id: 'inspect', status: 'completed', title: 'Inspect the page' },
      { id: 'verify', status: 'in_progress', title: 'Verify the result' }
    ],
    total: 2
  },
  say: null,
  session: {
    ended_at: null,
    id: 'canonical-tip',
    last_activity_at: 3,
    model: 'test',
    started_at: 1,
    status: 'running',
    title: 'Bot Chat',
    tool_calls: 2
  },
  steps: [step('browser-1', 'Open the office page', 'browser', 1), step('terminal-2', 'Run checks', 'terminal', 3)]
}

function displayStatus(overrides: Record<string, unknown> = {}) {
  return {
    browser: 'chromium',
    geometry: '1440x900',
    installed: true,
    lease: { epoch: 1, holder: 'agent', since: 1 },
    missing: [],
    placement: 'gateway',
    profile: 'parker',
    profile_key: 'parker',
    running: true,
    supported: true,
    ...overrides
  } as never
}

describe('Computer work timeline', () => {
  beforeEach(() => {
    $screenState.set({
      parker: { lease: null, status: displayStatus(), viewer: null }
    })
  })

  afterEach(() => {
    $screenState.set({})
  })

  it('shows the computer for a live screen or active tool, not an idle history', () => {
    const idle = { ...feed, session: { ...feed.session, status: 'idle' as const } }
    const runningStep = { ...feed, steps: [{ ...feed.steps[0], status: 'running' as const }] }

    expect(computerIsActive(idle, false)).toBe(false)
    expect(computerIsActive(feed, false)).toBe(false)
    expect(computerIsActive(runningStep, false)).toBe(true)
    expect(computerIsActive({ ...runningStep, now: 3600 }, false)).toBe(false)
    expect(computerIsActive(idle, true)).toBe(true)
  })

  it('selects earlier step details while the upper screen remains the current live display', () => {
    render(<ComputerWorkSurface bot={bot} feed={feed} />)

    const liveScreen = screen.getByTestId('live-screen')
    const slider = screen.getByRole('slider', { name: 'Activity timeline' })
    const detail = screen.getByRole('region', { name: 'Selected step detail' })

    expect(liveScreen.textContent).toContain('Current display · parker')
    expect(screen.getByText('Live now')).toBeTruthy()
    expect((slider as HTMLInputElement).value).toBe('1')
    expect(within(detail).getByRole('heading', { name: 'Run checks' })).toBeTruthy()

    fireEvent.change(slider, { target: { value: '0' } })

    expect((slider as HTMLInputElement).value).toBe('0')
    expect(within(detail).getByRole('heading', { name: 'Open the office page' })).toBeTruthy()
    expect(screen.getByTestId('live-screen')).toBe(liveScreen)
    expect(screen.getByText(/screen stays live/i)).toBeTruthy()
  })

  it('collapses the screen frame honestly when the host does not support a display', () => {
    $screenState.set({
      parker: { lease: null, status: displayStatus({ running: false, supported: false }), viewer: null }
    })

    render(<ComputerWorkSurface bot={bot} feed={feed} />)

    expect(screen.getByText('Unsupported')).toBeTruthy()
    expect(screen.getByText(/does not support a live display/i)).toBeTruthy()
    expect(screen.queryByTestId('live-screen')).toBeNull()
    expect(screen.getByRole('slider', { name: 'Activity timeline' })).toBeTruthy()
  })
})
