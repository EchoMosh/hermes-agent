/** Project authoritative signals for the shared Computer + Activity pane. */

import type { HermesPlugin } from '@hermes/plugin-sdk'

import { bindActivitySources } from './bridge'
import { ACTIVITY_LOCALES } from './i18n'

const plugin: HermesPlugin = {
  id: 'merna-activity',
  name: 'Activity',
  description: 'One inbox for bot mentions, rooms that need you, failures, and actionable Kanban tasks.',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n.register(ACTIVITY_LOCALES)
    ctx.onDispose(bindActivitySources())
  }
}

export default plugin
