import { host } from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActivityInbox, ChannelTaskLink, kanbanTaskPath } from './activity-inbox'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ActivityInbox routing', () => {
  it('routes each row through its real source identity', () => {
    const openBot = vi.fn()
    const openGroup = vi.fn()
    const openTask = vi.fn()

    render(
      <ActivityInbox
        onOpenBot={openBot}
        onOpenGroup={openGroup}
        onOpenTask={openTask}
        sources={{
          botChannels: [
            {
              canonicalChat: { id: 'bot-root', resolvedId: 'bot-tip', lastActive: 30, preview: 'New result' },
              connectionId: 'local',
              label: 'Copy editor',
              profile: 'copy',
              unread: true
            }
          ],
          groupRooms: [{ name: 'War room', needsYou: true }],
          kanbanTasks: [{ boardSlug: 'shipping', id: 'task-real-42', status: 'review', title: 'Approve release' }]
        }}
      />
    )

    fireEvent.click(screen.getByText('Copy editor'))
    fireEvent.click(screen.getByText('War room'))
    fireEvent.click(screen.getByText('Approve release'))

    expect(openBot).toHaveBeenCalledWith({
      connectionId: 'local',
      profile: 'copy',
      registrySessionId: 'bot-root',
      sessionId: 'bot-tip'
    })
    expect(openGroup).toHaveBeenCalledWith({ name: 'War room' })
    expect(openTask).toHaveBeenCalledWith({ boardSlug: 'shipping', taskId: 'task-real-42' })
  })

  it('never turns an empty task id into a navigation or create action', () => {
    const openTask = vi.fn()

    render(
      <ChannelTaskLink onOpenTask={openTask} target={{ taskId: '' }}>
        Invalid task
      </ChannelTaskLink>
    )

    const button = screen.getByRole('button', { name: 'Invalid task' })

    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(openTask).not.toHaveBeenCalled()
    expect(kanbanTaskPath({ taskId: '' })).toBe('/kanban')
  })

  it('builds the board deep-link from the backend task id and board slug', () => {
    expect(kanbanTaskPath({ boardSlug: 'shipping / west', taskId: 'task/42' })).toBe(
      '/kanban?board=shipping+%2F+west&task=task%2F42'
    )
  })

  it('opens the existing Kanban task surface when no integration override is needed', () => {
    const navigate = vi.spyOn(host, 'navigate').mockImplementation(() => undefined)

    render(<ChannelTaskLink target={{ boardSlug: 'shipping', taskId: 'task-real-42' }}>Open task</ChannelTaskLink>)
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }))

    expect(navigate).toHaveBeenCalledWith('/kanban?board=shipping&task=task-real-42')
    navigate.mockRestore()
  })

  it('keeps owner-routed rows disabled until their navigation actions are bound', () => {
    render(
      <ActivityInbox
        sources={{
          botChannels: [{ canonicalChat: { id: 'bot-chat' }, profile: 'copy', unread: true }],
          groupRooms: [{ name: 'War room', needsYou: true }]
        }}
      />
    )

    expect((screen.getByRole('button', { name: /copy/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /war room/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
