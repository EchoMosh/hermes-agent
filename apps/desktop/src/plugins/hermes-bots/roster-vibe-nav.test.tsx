import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GroupChatRoom } from './group-chat'

const host = vi.hoisted(() => ({ navigate: vi.fn(), revealPane: vi.fn() }))

vi.mock('@hermes/plugin-sdk', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string
    variant?: string
  }) => <button {...props}>{children}</button>,
  Codicon: ({ name }: { name: string }) => <span data-icon={name} />,
  host,
  Tip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('./group-chat', () => ({
  groupRoomKind: (room?: { kind?: string } | null) => (room?.kind === 'channel' ? 'channel' : 'group-dm')
}))

const { RosterVibeNav, rosterRoomNames } = await import('./roster-vibe-nav')

const room = (partial: Partial<GroupChatRoom> = {}): GroupChatRoom =>
  ({ log: [], watermarks: {}, ...partial }) as GroupChatRoom

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('real room navigation', () => {
  it('partitions persisted channels and legacy group DMs without inventing rows', () => {
    const rooms = {
      Announcements: room({ kind: 'channel' }),
      Planning: room(),
      Retired: room({ kind: 'channel', tombstone: true })
    }

    expect(rosterRoomNames(['Announcements', 'Planning', 'Retired', 'Planning'], rooms, 'channel')).toEqual([
      'Announcements'
    ])
    expect(rosterRoomNames(['Announcements', 'Planning', 'Retired', 'Planning'], rooms, 'group-dm')).toEqual([
      'Planning'
    ])
  })

  it('opens the exact persisted room selected from each section', () => {
    const onOpenRoom = vi.fn()

    render(
      <RosterVibeNav
        activeRoom="Announcements"
        activeView="home"
        canCreateChannel
        canCreateGroupDm
        groupNames={['Announcements', 'Planning']}
        groupRooms={{ Announcements: room({ kind: 'channel' }), Planning: room() }}
        onCreateChannel={() => undefined}
        onCreateGroupDm={() => undefined}
        onNavigate={() => undefined}
        onOpenRoom={onOpenRoom}
      />
    )

    const channels = screen.getByRole('region', { name: 'Channels' })
    const groupDms = screen.getByRole('region', { name: 'Group DMs' })

    expect(
      within(channels)
        .getByRole('button', { name: /Announcements/ })
        .getAttribute('aria-current')
    ).toBe('page')
    expect(within(channels).queryByText('general')).toBeNull()
    expect(within(channels).queryByText('product')).toBeNull()

    fireEvent.click(within(channels).getByRole('button', { name: /Announcements/ }))
    fireEvent.click(within(groupDms).getByRole('button', { name: /Planning/ }))

    expect(onOpenRoom.mock.calls).toEqual([['Announcements'], ['Planning']])
  })
})

describe('rail actions', () => {
  function renderNav(overrides: Partial<ComponentProps<typeof RosterVibeNav>> = {}) {
    const props: ComponentProps<typeof RosterVibeNav> = {
      activeRoom: null,
      activeView: 'home',
      canCreateChannel: true,
      canCreateGroupDm: true,
      groupNames: [],
      groupRooms: {},
      onCreateChannel: vi.fn(),
      onCreateGroupDm: vi.fn(),
      onNavigate: vi.fn(),
      onOpenRoom: vi.fn(),
      ...overrides
    }

    render(<RosterVibeNav {...props} />)

    return props
  }

  it('routes Home, DMs, and Activity through the roster controller', () => {
    const props = renderNav()

    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    fireEvent.click(screen.getByRole('button', { name: 'DMs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))

    expect(props.onNavigate).toHaveBeenNthCalledWith(1, 'home')
    expect(props.onNavigate).toHaveBeenNthCalledWith(2, 'dms')
    expect(props.onNavigate).toHaveBeenNthCalledWith(3, 'activity')
  })

  it('exposes both persisted-room creation paths', () => {
    const props = renderNav()
    const channel = screen.getByRole('button', { name: 'New channel' })
    const groupDm = screen.getByRole('button', { name: 'New group DM' })

    fireEvent.click(channel)
    fireEvent.click(groupDm)

    expect(props.onCreateChannel).toHaveBeenCalledOnce()
    expect(props.onCreateGroupDm).toHaveBeenCalledOnce()
  })

  it('disables both room creation paths until two bots are available', () => {
    const props = renderNav({ canCreateChannel: false, canCreateGroupDm: false })
    const channel = screen.getByRole('button', { name: 'New channel' })
    const groupDm = screen.getByRole('button', { name: 'New group DM' })

    fireEvent.click(channel)
    fireEvent.click(groupDm)

    expect((channel as HTMLButtonElement).disabled).toBe(true)
    expect((groupDm as HTMLButtonElement).disabled).toBe(true)
    expect(props.onCreateChannel).not.toHaveBeenCalled()
    expect(props.onCreateGroupDm).not.toHaveBeenCalled()
  })

  it('keeps Computer and Activity in one place', () => {
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.queryByRole('button', { name: 'Computer' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Activity' })).toBeTruthy()
  })
})
