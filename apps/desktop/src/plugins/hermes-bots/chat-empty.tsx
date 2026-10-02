/**
 * What a bot's chat shows before it has said anything.
 *
 * Show a labelled sample conversation until the bot has real history. The
 * sample is presentation only; the transcript and composer stay untouched.
 */

import { host, useValue } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { ConversationPreview } from './conversation-preview'
import { $botMeta, $lastRoster } from './data'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { RosterRow } from './types'

/** The bot whose canonical chat this session is, if it is one. Matches the
 *  durable registry id or the compression-lineage tip, the same pair the
 *  roster's click and preview identity resolve through. */
function botForStoredId(roster: readonly RosterRow[], storedId: string): null | RosterRow {
  if (!storedId || !Array.isArray(roster)) {
    return null
  }

  return (
    roster.find(bot => {
      const canonical = bot?.canonical_session

      return String(canonical?.id ?? '') === storedId || String(canonical?.resolved_id ?? '') === storedId
    }) ?? null
  )
}

/** The stored id of the chat on screen. The transcript hands its slot the
 *  RUNTIME id, and a canonical Bot Chat is keyed by its stored one — the same
 *  two id spaces that misrouted Bot Mode's RPCs in #93080. The focus store is
 *  the translation the rest of the plugin already trusts. */
function focusedStoredId(): string {
  return String(host.state.focusedStoredSessionId?.get?.() ?? '')
}

function botForChat(roster: readonly RosterRow[], sessionId: string): null | RosterRow {
  // Stored ids pass straight through, so a shell that hands us one still
  // resolves; otherwise the focused chat is the empty one being looked at.
  return botForStoredId(roster, sessionId) ?? botForStoredId(roster, focusedStoredId())
}

export function BotChatEmpty({ sessionId }: { sessionId: string }) {
  // Subscribed, not read once: roster, metadata and focus all land after the
  // transcript mounts. This is also how the state appears at all — the slot
  // mounts for every empty session and only resolves to a bot once the roster
  // is in hand.
  const roster = useValue($lastRoster)
  const allMeta = useValue($botMeta)
  useValue(host.state.focusedStoredSessionId)
  const bot = botForChat(roster, sessionId)

  if (!bot) {
    return null
  }

  // Route-keyed, exactly as the roster row resolves it: metadata is scoped to
  // the gateway it came from, so a plain by-name read misses the entry a
  // source-scoped bot's avatar actually lives under.
  const meta = botRosterMeta(bot, allMeta)
  const name = displayName(bot, meta)
  const { color, image, shape } = botAppearance(bot.name, meta)
  // Same rule the rows use: keep a real photo or pet, drop the SVG backfill so
  // the math face can animate.
  const photo = Boolean(image && !isBackfilledFacePng(image))

  return (
    <div data-slot="bot_chat_empty">
      <ConversationPreview
        avatar={
          <BotFace
            color={avatarColor(color, bot.name)}
            image={photo ? image : null}
            mood="idle"
            name={bot.name}
            shape={shape}
            size={48}
          />
        }
        name={name}
      />
    </div>
  )
}
