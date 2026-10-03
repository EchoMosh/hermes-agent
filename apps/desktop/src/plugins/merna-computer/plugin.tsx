/** Contextual Computer pane for Bot Mode. */

/* eslint-disable no-restricted-imports -- This bundled pane is a contextual extension of hermes-bots. */

import './work-panels.css'

import { type HermesPlugin, type RpcEvent, useValue } from '@hermes/plugin-sdk'

import { $botsPaneVisible, $selectedRosterKey } from '../hermes-bots/bot-state'
import { $lastRoster, botRosterKey } from '../hermes-bots/data'
import { ActivityInbox } from '../merna-activity/activity-inbox'
import { useActivityLabels } from '../merna-activity/i18n'
import { $activityInboxActions, $activityInboxSources } from '../merna-activity/store'

import { handleComputerToolStart } from './auto-reveal'
import { MernaComputerPane } from './computer-pane'

export { MERNA_COMPUTER_PANE_ID } from './auto-reveal'

function SelectedComputerPane() {
  const roster = useValue($lastRoster)
  const selectedKey = useValue($selectedRosterKey)
  const activitySources = useValue($activityInboxSources)
  const activityActions = useValue($activityInboxActions)
  const activityLabels = useActivityLabels()
  const bot = roster.find(row => botRosterKey(row) === selectedKey) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 grow basis-[56%] empty:hidden">
        {bot ? <MernaComputerPane bot={bot} key={botRosterKey(bot)} /> : null}
      </div>
      <ActivityInbox
        className="min-h-40 grow basis-[44%] border-t border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)"
        labels={activityLabels}
        onOpenBot={activityActions.openBot}
        onOpenGroup={activityActions.openGroup}
        onOpenTask={activityActions.openTask}
        sources={activitySources}
      />
    </div>
  )
}

const plugin: HermesPlugin = {
  id: 'merna-computer',
  name: 'Computer',
  description: 'A live, profile-safe view of the selected bot’s plan, tool activity, helpers, and screen.',
  register(ctx) {
    let unregisterPane: null | (() => void) = null

    const syncPane = () => {
      const shouldExist = $botsPaneVisible.get()

      if (shouldExist && !unregisterPane) {
        unregisterPane = ctx.register({
          id: 'pane',
          area: 'panes',
          title: 'Work',
          data: {
            defaultCollapsed: true,
            dock: {
              pane: 'hermes-bots:routines',
              pos: 'center',
              enforce: true
            },
            placement: 'main',
            tabTitle: () => 'Work',
            tabTitleText: () => 'Work',
            width: '420px'
          },
          render: () => <SelectedComputerPane />
        })
      } else if (!shouldExist && unregisterPane) {
        unregisterPane()
        unregisterPane = null
      }
    }

    const stopBots = $botsPaneVisible.listen(syncPane)
    syncPane()
    ctx.onEvent('tool.start', (event: RpcEvent) => {
      handleComputerToolStart(event)
    })
    ctx.onDispose(() => {
      stopBots()
      unregisterPane?.()
      unregisterPane = null
    })
  }
}

export default plugin
