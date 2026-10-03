import { Button, Codicon, host, Tip } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { groupRoomKind } from './group-chat'
import type { GroupChatRoom } from './group-chat'
import type { GroupRoomKind } from './types'

export type RosterVibeView = 'activity' | 'dms' | 'home'

interface RosterVibeNavProps {
  activeRoom: null | string
  activeView: null | RosterVibeView
  canCreateChannel: boolean
  canCreateGroupDm: boolean
  groupNames: string[]
  groupRooms: Record<string, GroupChatRoom>
  onCreateChannel: () => void
  onCreateGroupDm: () => void
  onNavigate: (view: RosterVibeView) => void
  onOpenRoom: (name: string) => void
}

function RailIcon({ name }: { name: 'home' | 'dm' | 'activity' | 'more' | 'settings' }) {
  const shared = { className: 'merna-rail-icon', 'aria-hidden': true as const, viewBox: '0 0 32 32' }

  if (name === 'home') {
    return (
      <svg {...shared}>
        <path d="M16 3 2 15l2.5 2.7L16 8l11.5 9.7L30 15 16 3Z" fill="currentColor" />
        <path d="M7 15.5V28h7v-9h4v9h7V15.5L16 8Z" fill="currentColor" />
      </svg>
    )
  }

  if (name === 'dm') {
    return (
      <svg {...shared}>
        <path
          d="M5 6.5h22a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H13l-7.5 4v-4A3.5 3.5 0 0 1 2 22V9.5a3.5 3.5 0 0 1 3-3Z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2.7"
        />
        <circle cx="10" cy="16" fill="currentColor" r="1.6" />
        <circle cx="16" cy="16" fill="currentColor" r="1.6" />
        <circle cx="22" cy="16" fill="currentColor" r="1.6" />
      </svg>
    )
  }

  if (name === 'activity') {
    return (
      <svg {...shared}>
        <path
          d="M16 3a3 3 0 0 1 3 3v1c5.2 1.3 7 5.6 7 11v4l2.3 3H3.7L6 22v-4c0-5.4 1.8-9.7 7-11V6a3 3 0 0 1 3-3ZM12.5 27a3.5 3.5 0 0 0 7 0"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.7"
        />
      </svg>
    )
  }

  if (name === 'more') {
    return (
      <svg {...shared}>
        <circle cx="6" cy="16" fill="currentColor" r="3.1" />
        <circle cx="16" cy="16" fill="currentColor" r="3.1" />
        <circle cx="26" cy="16" fill="currentColor" r="3.1" />
      </svg>
    )
  }

  return (
    <svg {...shared}>
      <path
        d="m13 2 1 3.1a11 11 0 0 1 4 0L19 2l3.5 1.5-.8 3.2a11 11 0 0 1 2.8 2.8l3.2-.8L29 12l-3.1 1a11 11 0 0 1 0 4l3.1 1-1.5 3.5-3.2-.8a11 11 0 0 1-2.8 2.8l.8 3.2L19 28l-1-3.1a11 11 0 0 1-4 0L13 28l-3.5-1.5.8-3.2a11 11 0 0 1-2.8-2.8l-3.2.8L3 18l3.1-1a11 11 0 0 1 0-4L3 12l1.5-3.5 3.2.8a11 11 0 0 1 2.8-2.8l-.8-3.2z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
      <circle cx="16" cy="15" fill="none" r="4.2" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  )
}

/** Preserve the roster's existing order while separating channels from DMs.
 *  Missing room records are legacy group DMs; tombstones never navigate. */
export function rosterRoomNames(names: string[], rooms: Record<string, GroupChatRoom>, kind: GroupRoomKind): string[] {
  const seen = new Set<string>()

  return (Array.isArray(names) ? names : []).filter(name => {
    const room = rooms?.[name]

    if (!name || seen.has(name) || room?.tombstone || groupRoomKind(room) !== kind) {
      return false
    }

    seen.add(name)

    return true
  })
}

interface RoomSectionProps {
  activeRoom: null | string
  addLabel: string
  canCreate: boolean
  kind: GroupRoomKind
  label: string
  names: string[]
  onCreate: () => void
  onOpenRoom: (name: string) => void
}

function RoomSection({ activeRoom, addLabel, canCreate, kind, label, names, onCreate, onOpenRoom }: RoomSectionProps) {
  return (
    <section aria-label={label} className="merna-channels">
      <div className="merna-section-caption">
        <span>{label}</span>
        <Tip label={addLabel}>
          <Button aria-label={addLabel} disabled={!canCreate} onClick={onCreate} size="icon-xs" variant="ghost">
            <Codicon name="add" />
          </Button>
        </Tip>
      </div>
      {names.map(name => (
        <button
          aria-current={activeRoom === name ? 'page' : undefined}
          className="merna-channel-row"
          key={name}
          onClick={() => onOpenRoom(name)}
          type="button"
        >
          <span aria-hidden="true" className="merna-channel-hash">
            {kind === 'channel' ? '#' : <Codicon name="organization" />}
          </span>
          <span className="min-w-0 truncate">{name}</span>
        </button>
      ))}
    </section>
  )
}

export function RosterVibeNav({
  activeRoom,
  activeView,
  canCreateChannel,
  canCreateGroupDm,
  groupNames,
  groupRooms,
  onCreateChannel,
  onCreateGroupDm,
  onNavigate,
  onOpenRoom
}: RosterVibeNavProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const channelNames = rosterRoomNames(groupNames, groupRooms, 'channel')
  const groupDmNames = rosterRoomNames(groupNames, groupRooms, 'group-dm')

  return (
    <>
      <div className="merna-workspace-header">
        <div className="merna-workspace-name">DaisyLabs</div>
      </div>

      <nav aria-label="Workspace" className="merna-workspace-nav">
        {(
          [
            ['home', 'Home', 'home'],
            ['dm', 'DMs', 'dms'],
            ['activity', 'Activity', 'activity']
          ] as const
        ).map(([icon, label, view]) => (
          <button
            aria-current={activeView === view ? 'page' : undefined}
            className="merna-workspace-nav-item"
            key={view}
            onClick={() => onNavigate(view)}
            type="button"
          >
            <RailIcon name={icon} />
            <span>{label}</span>
          </button>
        ))}
        <button
          aria-expanded={moreOpen}
          className="merna-workspace-nav-item"
          onClick={() => setMoreOpen(value => !value)}
          type="button"
        >
          <RailIcon name="more" />
          <span>More</span>
          <Codicon className="merna-more-chevron" name={moreOpen ? 'chevron-up' : 'chevron-down'} />
        </button>
        {moreOpen ? (
          <div className="merna-more-panel">
            {(
              [
                ['Sessions', 'sessions'],
                ['Bots', 'hermes-bots:pane'],
                ['Files', 'files']
              ] as const
            ).map(([label, pane]) => (
              <button key={pane} onClick={() => host.revealPane(pane)} type="button">
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </nav>

      <RoomSection
        activeRoom={activeRoom}
        addLabel="New channel"
        canCreate={canCreateChannel}
        kind="channel"
        label="Channels"
        names={channelNames}
        onCreate={onCreateChannel}
        onOpenRoom={onOpenRoom}
      />
      <RoomSection
        activeRoom={activeRoom}
        addLabel="New group DM"
        canCreate={canCreateGroupDm}
        kind="group-dm"
        label="Group DMs"
        names={groupDmNames}
        onCreate={onCreateGroupDm}
        onOpenRoom={onOpenRoom}
      />
    </>
  )
}

export function RosterVibeFooter({ onHire }: { onHire: () => void }) {
  return (
    <div className="merna-sidebar-bottom">
      <button className="merna-hire-button" onClick={onHire} type="button">
        <span className="merna-hire-plus">
          <Codicon name="add" />
        </span>
        <span>Hire new agents</span>
        <Codicon className="merna-hire-arrow" name="arrow-right" />
      </button>
      <button className="merna-settings-button" onClick={() => host.navigate('/settings')} type="button">
        <RailIcon name="settings" />
        <span>Settings</span>
      </button>
    </div>
  )
}
