import { atom } from '@hermes/plugin-sdk'

import type {
  ActivityInboxSources,
  BotActivityTarget,
  BotChannelActivitySource,
  GroupActivityTarget,
  GroupRoomActivitySource,
  KanbanTaskActivitySource,
  KanbanTaskTarget
} from './model'

/** Runtime projection only. Backend/plugin stores remain authoritative. */
export const $activityInboxSources = atom<ActivityInboxSources>({})

export interface ActivityInboxActions {
  openBot?: (target: BotActivityTarget) => void
  openGroup?: (target: GroupActivityTarget) => void
  openTask?: (target: KanbanTaskTarget) => void
}

export const $activityInboxActions = atom<ActivityInboxActions>({})

export function setActivityBotChannels(botChannels: readonly BotChannelActivitySource[]): void {
  $activityInboxSources.set({ ...$activityInboxSources.get(), botChannels })
}

export function setActivityGroupRooms(groupRooms: readonly GroupRoomActivitySource[]): void {
  $activityInboxSources.set({ ...$activityInboxSources.get(), groupRooms })
}

export function setActivityKanbanTasks(kanbanTasks: readonly KanbanTaskActivitySource[]): void {
  $activityInboxSources.set({ ...$activityInboxSources.get(), kanbanTasks })
}

/** Bind owner-aware navigation callbacks. Returns a disposer for the caller's
 * lifecycle so a disabled source plugin cannot leave a stale click handler. */
export function bindActivityInboxActions(actions: ActivityInboxActions): () => void {
  $activityInboxActions.set(actions)

  return () => {
    if ($activityInboxActions.get() === actions) {
      $activityInboxActions.set({})
    }
  }
}

export function resetActivityInbox(): void {
  $activityInboxSources.set({})
  $activityInboxActions.set({})
}
