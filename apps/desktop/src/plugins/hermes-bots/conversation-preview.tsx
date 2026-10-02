import type { ReactNode } from 'react'

/** A clearly labelled sample transcript for a conversation with no history.
 * It never enters the message store and disappears on the first real message. */
export function ConversationPreview({
  avatar,
  firstMessage,
  name
}: {
  avatar?: ReactNode
  firstMessage?: string
  name: string
}) {
  return (
    <div className="merna-conversation-preview" data-slot="conversation-preview">
      <div className="merna-conversation-preview-label">Example conversation · preview</div>
      <div className="merna-conversation-preview-row">
        <div className="merna-conversation-preview-avatar">{avatar || name.slice(0, 1)}</div>
        <div>
          <div className="merna-conversation-preview-byline">
            <strong>{name}</strong>
            <span>12:04 PM</span>
          </div>
          <p>{firstMessage || 'Hi! Tell me what you’re working on and I’ll help you move it forward. ✨'}</p>
        </div>
      </div>
      <div className="merna-conversation-preview-row merna-conversation-preview-you">
        <div className="merna-conversation-preview-avatar">Y</div>
        <div>
          <div className="merna-conversation-preview-byline">
            <strong>You</strong>
            <span>12:05 PM</span>
          </div>
          <p>Can you take a look at the next step?</p>
        </div>
      </div>
      <div className="merna-conversation-preview-row">
        <div className="merna-conversation-preview-avatar">{avatar || name.slice(0, 1)}</div>
        <div>
          <div className="merna-conversation-preview-byline">
            <strong>{name}</strong>
            <span>12:06 PM</span>
          </div>
          <p>Of course. Send the details whenever you’re ready.</p>
        </div>
      </div>
    </div>
  )
}
