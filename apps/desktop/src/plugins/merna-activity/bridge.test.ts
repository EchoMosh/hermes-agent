import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  board: null as null | { columns: { tasks: { id: string; status: string; title: string }[] }[] },
  bots: [] as Array<Record<string, unknown>>,
  dots: {} as Record<string, string>,
  rooms: {} as Record<string, Record<string, unknown>>
}))

const atom = (read: () => unknown) => ({ get: read, listen: () => () => undefined })
const openBot = vi.hoisted(() => vi.fn())
const openGroup = vi.hoisted(() => vi.fn())

vi.mock('@hermes/plugin-sdk', () => ({
  $sessionDotStateById: atom(() => state.dots),
  host: { state: { connectionId: atom(() => 'local') } },
  queryClient: {
    getQueryCache: () => ({ subscribe: () => () => undefined }),
    getQueryData: () => state.board
  }
}))
vi.mock('../hermes-bots/data', () => ({
  $botMeta: atom(() => ({})),
  $lastRoster: atom(() => state.bots)
}))
vi.mock('../hermes-bots/group-activity', () => ({ $groupActivity: atom(() => ({})) }))
vi.mock('../hermes-bots/group-chat', () => ({
  $groupChats: atom(() => state.rooms),
  $groupClarify: atom(() => ({})),
  $groupNeedsYou: atom(() => ({}))
}))
vi.mock('../hermes-bots/group-chat-view', () => ({ openGroupChat: openGroup }))
vi.mock('../hermes-bots/labels', () => ({ displayName: (bot: { name: string }) => bot.name }))
vi.mock('../hermes-bots/roster-actions', () => ({ openRosterBot: openBot }))
vi.mock('../hermes-bots/routing', () => ({ botRosterMeta: () => ({}) }))
vi.mock('../hermes-bots/row-helpers', () => ({
  botCanonicalSessionId: (bot: { canonical_session?: { id: string; resolved_id?: string } }) =>
    bot.canonical_session?.resolved_id || bot.canonical_session?.id
}))
vi.mock('../kanban/api', () => ({
  $boardSlug: atom(() => 'real-board'),
  boardKey: () => ['kanban'],
  kanbanConnectionScope: () => 'local'
}))
vi.mock('./store', () => ({
  bindActivityInboxActions: () => () => undefined,
  setActivityBotChannels: vi.fn(),
  setActivityGroupRooms: vi.fn(),
  setActivityKanbanTasks: vi.fn()
}))

describe('Activity source projection', () => {
  beforeEach(() => {
    state.bots = []
    state.dots = {}
    state.rooms = {}
    state.board = null
    openBot.mockReset()
    openGroup.mockReset()
  })

  it('shows only the exact canonical unread Bot Chat, never a newer unrelated session', async () => {
    state.bots = [
      {
        name: 'ivy',
        connectionId: 'local',
        canonical_session: { id: 'bot-chat', resolved_id: 'bot-tip', preview: 'Done' },
        last_session: { id: 'unrelated-newer-session', preview: 'Not the chat' }
      }
    ]
    state.dots = { 'unrelated-newer-session': 'unread' }

    const { projectBotActivity } = await import('./bridge')
    expect(projectBotActivity()).toEqual([])

    state.dots = { 'bot-tip': 'unread' }
    expect(projectBotActivity()).toMatchObject([
      { canonicalChat: { id: 'bot-chat', resolvedId: 'bot-tip', preview: 'Done' }, profile: 'ivy', unread: true }
    ])
  })

  it('rejects old room tombstones and projects real Kanban card identities', async () => {
    state.rooms = {
      live: { log: [{ at: 123 }], epoch: 2 },
      deleted: { log: [], tombstone: true }
    }
    state.board = { columns: [{ tasks: [{ id: 'task-42', title: 'Approve copy', status: 'review' }] }] }

    const { projectGroupActivity, projectKanbanActivity } = await import('./bridge')
    expect(projectGroupActivity().map(room => room.name)).toEqual(['live'])
    expect(projectKanbanActivity()).toMatchObject([
      { id: 'task-42', boardSlug: 'real-board', status: 'review', title: 'Approve copy' }
    ])
  })
})
