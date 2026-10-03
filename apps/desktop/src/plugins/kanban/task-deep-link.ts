/**
 * `/kanban?board=<slug>&task=<real id>` deep-link contract.
 *
 * The request is verified against the loaded board before the drawer opens.
 * Unknown ids are consumed as a no-op; they never become a create request.
 */

import { useCallback, useEffect, useState } from 'react'

import type { KanbanBoard } from './types'

export interface KanbanTaskDeepLink {
  boardSlug: string
  taskId: string
}

export function parseKanbanTaskDeepLink(hash: string): KanbanTaskDeepLink | null {
  const target = hash.startsWith('#') ? hash.slice(1) : hash
  const [path, query = ''] = target.split('?', 2)

  if (path !== '/kanban') {
    return null
  }

  const search = new URLSearchParams(query)
  const taskId = search.get('task')?.trim() || ''

  if (!taskId) {
    return null
  }

  return {
    boardSlug: search.get('board')?.trim() || '',
    taskId
  }
}

export function resolveKanbanTaskDeepLink(board: null | KanbanBoard, target: KanbanTaskDeepLink): null | string {
  if (!board) {
    return null
  }

  return board.columns.some(column => column.tasks.some(task => task.id === target.taskId)) ? target.taskId : null
}

function clearTaskQuery(): void {
  const url = `${window.location.pathname}${window.location.search}#/kanban`

  window.history.replaceState(window.history.state, '', url)
}

function useTaskTarget(): [KanbanTaskDeepLink | null, () => void] {
  const [target, setTarget] = useState<KanbanTaskDeepLink | null>(() => parseKanbanTaskDeepLink(window.location.hash))

  useEffect(() => {
    const update = () => setTarget(parseKanbanTaskDeepLink(window.location.hash))

    window.addEventListener('hashchange', update)

    return () => window.removeEventListener('hashchange', update)
  }, [])

  const consume = useCallback(() => {
    clearTaskQuery()
    setTarget(null)
  }, [])

  return [target, consume]
}

export interface UseKanbanTaskDeepLinkOptions {
  board: null | KanbanBoard
  boardSlug: string
  onOpenTask: (taskId: string) => void
  onSelectBoard: (boardSlug: string) => void
}

/** Consume one route request after the requested board snapshot is loaded. */
export function useKanbanTaskDeepLink({
  board,
  boardSlug,
  onOpenTask,
  onSelectBoard
}: UseKanbanTaskDeepLinkOptions): void {
  const [target, consume] = useTaskTarget()

  useEffect(() => {
    if (!target) {
      return
    }

    if (target.boardSlug && target.boardSlug !== boardSlug) {
      onSelectBoard(target.boardSlug)

      return
    }

    if (!board) {
      return
    }

    const taskId = resolveKanbanTaskDeepLink(board, target)

    // Consume before opening so a board poll cannot re-open a drawer the user
    // closed. Clearing the query also lets the same task link be clicked again.
    consume()

    if (taskId) {
      onOpenTask(taskId)
    }
  }, [board, boardSlug, consume, onOpenTask, onSelectBoard, target])
}
