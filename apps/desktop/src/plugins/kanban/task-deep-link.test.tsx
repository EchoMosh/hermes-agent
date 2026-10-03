import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  parseKanbanTaskDeepLink,
  resolveKanbanTaskDeepLink,
  useKanbanTaskDeepLink,
  type UseKanbanTaskDeepLinkOptions
} from './task-deep-link'
import type { KanbanBoard } from './types'

const board = (ids: string[]): KanbanBoard => ({
  assignees: [],
  columns: [{ name: 'review', tasks: ids.map(id => ({ id, status: 'review', title: id })) }],
  latest_event_id: 1,
  now: 1,
  tenants: []
})

function Harness(options: UseKanbanTaskDeepLinkOptions) {
  useKanbanTaskDeepLink(options)

  return null
}

afterEach(() => {
  cleanup()
  window.history.replaceState(window.history.state, '', '#/')
})

describe('Kanban task deep links', () => {
  it('parses and resolves the intended real task', () => {
    const target = parseKanbanTaskDeepLink('#/kanban?board=shipping&task=t_42')

    expect(target).toEqual({ boardSlug: 'shipping', taskId: 't_42' })
    expect(resolveKanbanTaskDeepLink(board(['t_7', 't_42']), target!)).toBe('t_42')
  })

  it('switches boards, waits for its snapshot, then opens exactly that task', () => {
    window.history.replaceState(window.history.state, '', '#/kanban?board=shipping&task=t_42')
    const onOpenTask = vi.fn()
    const onSelectBoard = vi.fn()

    const { rerender } = render(
      <Harness board={board(['other'])} boardSlug="default" onOpenTask={onOpenTask} onSelectBoard={onSelectBoard} />
    )

    expect(onSelectBoard).toHaveBeenCalledWith('shipping')
    expect(onOpenTask).not.toHaveBeenCalled()

    rerender(
      <Harness board={board(['t_42'])} boardSlug="shipping" onOpenTask={onOpenTask} onSelectBoard={onSelectBoard} />
    )

    expect(onOpenTask).toHaveBeenCalledTimes(1)
    expect(onOpenTask).toHaveBeenCalledWith('t_42')
    expect(window.location.hash).toBe('#/kanban')

    rerender(
      <Harness
        board={board(['t_42', 'new'])}
        boardSlug="shipping"
        onOpenTask={onOpenTask}
        onSelectBoard={onSelectBoard}
      />
    )
    expect(onOpenTask).toHaveBeenCalledTimes(1)
  })

  it('consumes an unknown id without opening or creating a task', () => {
    window.history.replaceState(window.history.state, '', '#/kanban?board=shipping&task=missing')
    const onOpenTask = vi.fn()

    render(<Harness board={board(['real'])} boardSlug="shipping" onOpenTask={onOpenTask} onSelectBoard={vi.fn()} />)

    expect(onOpenTask).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/kanban')
  })
})
