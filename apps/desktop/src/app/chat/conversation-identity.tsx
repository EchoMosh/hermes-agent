import { useStore } from '@nanostores/react'
import { createContext, type ReactNode, useContext } from 'react'

import { avatarColor, botAppearance } from '@/plugins/hermes-bots/avatar'
import { isBackfilledFacePng } from '@/plugins/hermes-bots/avatar-image'
import { $botMeta, $lastRoster, botSourceStatus } from '@/plugins/hermes-bots/data'
import { displayName } from '@/plugins/hermes-bots/labels'
import { botRosterMeta } from '@/plugins/hermes-bots/routing'

export function useConversationIdentity(storedId?: string, fallbackName = 'Hermes', profile?: string) {
  const roster = useStore($lastRoster)
  const allMeta = useStore($botMeta)

  const bot = storedId
    ? roster.find(row => row.canonical_session?.id === storedId || row.canonical_session?.resolved_id === storedId)
    : undefined

  const meta = bot ? botRosterMeta(bot, allMeta) : null
  const appearance = bot ? botAppearance(bot.name, meta) : null

  return {
    appearance,
    bot,
    color: bot && appearance ? avatarColor(appearance.color, bot.name) : undefined,
    image: appearance?.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null,
    name: bot ? displayName(bot, meta) : fallbackName,
    role: meta?.description?.trim() || (bot ? 'AI teammate' : profile || 'Conversation'),
    status: bot ? botSourceStatus(bot) : null
  }
}

export type ConversationIdentity = ReturnType<typeof useConversationIdentity>

const ConversationIdentityContext = createContext<ConversationIdentity | null>(null)

export function ConversationIdentityProvider({
  children,
  identity
}: {
  children: ReactNode
  identity: ConversationIdentity
}) {
  return <ConversationIdentityContext.Provider value={identity}>{children}</ConversationIdentityContext.Provider>
}

export function useCurrentConversationIdentity() {
  return useContext(ConversationIdentityContext)
}
