import { describe, expect, it } from 'vitest'

import { applyCreatedGroupRoom, groupRoomMinimumMembers } from './create-dialog'
import type { GroupChatRoom } from './group-chat'

const room = (partial: Partial<GroupChatRoom> = {}): GroupChatRoom =>
  ({ log: [], watermarks: {}, ...partial }) as GroupChatRoom

describe('room creation kinds', () => {
  it("keeps both room kinds on the group engine's two-member contract", () => {
    expect(groupRoomMinimumMembers('group-dm')).toBe(2)
    expect(groupRoomMinimumMembers('channel')).toBe(2)
  })

  it.each(['channel', 'group-dm'] as const)('writes an explicit %s kind into the persisted room record', kind => {
    const members = [{ name: 'planner' }, { name: 'reviewer' }]

    const created = applyCreatedGroupRoom(room({ image: 'existing-image' }), {
      image: null,
      kind,
      members,
      roomId: `${kind}-room`
    })

    expect(created).toMatchObject({ kind, members, roomId: `${kind}-room`, image: 'existing-image' })
  })
})
