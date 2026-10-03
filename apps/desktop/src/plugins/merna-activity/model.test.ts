import { describe, expect, it } from 'vitest'

import { buildActivityInbox, canonicalChatMentionsUser, kanbanActivitySignal } from './model'

describe('Activity inbox model', () => {
  it('keys bot activity to the canonical compression tip and preserves the exact owner route', () => {
    const items = buildActivityInbox({
      botChannels: [
        {
          canonicalChat: {
            id: 'registry-chat',
            resolvedId: 'live-tip',
            lastActive: 1_800_000_000,
            preview: '@user I need a decision'
          },
          connectionId: 'display-alias-that-must-not-win',
          label: 'Remote Ops',
          mentioned: true,
          profile: 'ops',
          route: {
            connectionId: 'prod-vps',
            mode: 'remote',
            profile: 'ops',
            targetProfile: 'ops-runtime'
          },
          unread: true
        }
      ]
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'bot:prod-vps:ops:live-tip',
      kind: 'bot',
      signal: 'mention',
      target: {
        connectionId: 'prod-vps',
        profile: 'ops',
        registrySessionId: 'registry-chat',
        route: {
          connectionId: 'prod-vps',
          mode: 'remote',
          profile: 'ops',
          targetProfile: 'ops-runtime'
        },
        sessionId: 'live-tip'
      }
    })
  })

  it('does not invent bot rows without a canonical identity or an attention signal', () => {
    const items = buildActivityInbox({
      botChannels: [
        { canonicalChat: { id: '' }, profile: 'missing-registry', unread: true },
        { canonicalChat: { id: 'quiet-chat' }, profile: 'quiet' }
      ]
    })

    expect(items).toEqual([])
  })

  it('recognizes only the canonical @user handoff token in unread previews', () => {
    expect(canonicalChatMentionsUser('Decision needed from @user.')).toBe(true)
    expect(canonicalChatMentionsUser('mail user@example.com or ask @username')).toBe(false)
    expect(canonicalChatMentionsUser('ask @user.name')).toBe(false)

    const [item] = buildActivityInbox({
      botChannels: [
        {
          canonicalChat: { id: 'bot-chat', preview: 'Could @user choose a direction?' },
          profile: 'planner',
          unread: true
        }
      ]
    })

    expect(item).toMatchObject({ mentioned: true, signal: 'mention' })
  })

  it('keeps needs-you state and only the latest failure from the current room epoch', () => {
    const items = buildActivityInbox({
      groupRooms: [
        {
          epoch: 4,
          events: [
            { at: 1_800_000_000_100, epoch: 3, kind: 'failed', member: 'old', reason: 'superseded run' },
            { at: 1_800_000_000_200, epoch: 4, kind: 'failed', member: 'writer', reason: 'missing_config' },
            { at: 1_800_000_000_300, epoch: 4, kind: 'replied', member: 'reviewer' },
            { at: 1_800_000_000_400, epoch: 4, kind: 'timed-out', member: 'reviewer', reason: 'timeout' }
          ],
          name: 'Launch room',
          needsYou: true,
          pendingPromptAt: 1_800_000_000_500,
          pendingPromptCount: 2
        }
      ]
    })

    expect(items.map(item => [item.signal, item.id])).toEqual([
      ['needs-you', 'group:Launch%20room:needs-you'],
      ['turn-failure', 'group:Launch%20room:failure:4:1800000000400:reviewer']
    ])
    expect(items[1]).toMatchObject({ member: 'reviewer', reason: 'timeout' })
  })

  it('admits only real actionable Kanban tasks and retains their backend ids', () => {
    const items = buildActivityInbox({
      kanbanTasks: [
        { boardSlug: 'release', id: 'task-review', status: 'review', title: 'Approve release' },
        { boardSlug: 'release', id: 'task-input', status: 'blocked', title: 'Choose region', blockKind: 'needs_input' },
        { boardSlug: 'release', id: 'task-running', status: 'running', title: 'Build artifacts' },
        { boardSlug: 'release', id: '', status: 'review', title: 'No backend identity' }
      ]
    })

    expect(items.map(item => [item.signal, item.kind === 'kanban' ? item.target.taskId : null])).toEqual([
      ['approval', 'task-review'],
      ['task', 'task-input']
    ])
    expect(kanbanActivitySignal({ id: 'task-running', status: 'running', title: 'Build artifacts' })).toBeNull()
  })
})
