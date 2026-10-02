import { useAuiState } from '@assistant-ui/react'

import { BotFace } from '@/plugins/hermes-bots/avatar'

import { useCurrentConversationIdentity } from './conversation-identity'

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** A quiet byline shared by all real assistant replies. No placeholder date is shown. */
export function ConversationMessageAuthor() {
  const identity = useCurrentConversationIdentity()

  const timestamp = useAuiState(s => {
    const value = (s.message.metadata?.custom as { timelineTimestamp?: unknown } | undefined)?.timelineTimestamp

    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  })

  if (!identity) {return null}

  return (
    <div className="merna-message-author">
      <div aria-hidden="true" className="merna-message-author-avatar">
        {identity.bot && identity.appearance && identity.color ? (
          <BotFace
            color={identity.color}
            image={identity.image}
            mood="idle"
            name={identity.bot.name}
            shape={identity.appearance.shape}
            size={40}
          />
        ) : (
          identity.name.slice(0, 1)
        )}
      </div>
      <strong>{identity.name}</strong>
      {timestamp ? (
        <time dateTime={new Date(timestamp * 1000).toISOString()}>{clock.format(timestamp * 1000)}</time>
      ) : null}
    </div>
  )
}
