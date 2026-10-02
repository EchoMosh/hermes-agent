import { host } from '@hermes/plugin-sdk'

import { BotFace } from '@/plugins/hermes-bots/avatar'

import { useConversationIdentity } from './conversation-identity'
import { SessionActionsMenu } from './sidebar/session-actions-menu'

export function ConversationHeader({
  onDelete,
  onPin,
  pinned,
  profile,
  storedId,
  title
}: {
  onDelete?: () => void
  onPin?: () => void
  pinned: boolean
  profile?: string
  storedId?: string
  title: string
}) {
  const { appearance, bot, color, image, name, role, status } = useConversationIdentity(storedId, title, profile)

  return (
    <header className="merna-chat-header">
      <div className="merna-chat-header-identity">
        {bot && appearance ? (
          <BotFace color={color!} image={image} mood="idle" name={bot.name} shape={appearance.shape} size={54} />
        ) : (
          <div aria-hidden="true" className="merna-chat-header-fallback">
            {name.slice(0, 1)}
          </div>
        )}
        <div className="merna-chat-header-copy">
          <strong>{name}</strong>
          <div className="merna-chat-header-meta">
            <span className="merna-chat-header-role">{role}</span>
            {bot ? (
              <span
                aria-hidden="true"
                className="merna-chat-header-status-dot"
                data-available={status?.available ? '' : undefined}
              />
            ) : null}
            {bot ? <span>{status?.available ? 'Online' : status?.label || 'Connecting'}</span> : null}
          </div>
        </div>
      </div>
      <div className="merna-chat-header-actions">
        <button
          aria-label="Search messages (preview)"
          className="merna-chat-header-action"
          onClick={() => host.notify({ kind: 'info', message: 'Message search is a visual preview for now.' })}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="10.7" cy="10.7" r="6.8" />
            <path d="m16 16 5 5" />
          </svg>
        </button>
        <button
          aria-label="Show team"
          className="merna-chat-header-action"
          onClick={() => host.revealPane('hermes-bots:pane')}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="9" cy="8" r="3.2" />
            <path d="M2.8 19c0-3.5 2.5-5.6 6.2-5.6s6.2 2.1 6.2 5.6M16 5.3a3.1 3.1 0 0 1 0 6.1M17 13.7c2.7.5 4.2 2.3 4.2 5.3" />
          </svg>
        </button>
        {storedId ? (
          <SessionActionsMenu
            onDelete={onDelete}
            onPin={onPin}
            pinned={pinned}
            profile={profile}
            sessionId={storedId}
            title={title}
          >
            <button
              aria-label="Conversation options"
              className="merna-chat-header-action merna-chat-header-more"
              type="button"
            >
              ⋮
            </button>
          </SessionActionsMenu>
        ) : null}
      </div>
    </header>
  )
}
