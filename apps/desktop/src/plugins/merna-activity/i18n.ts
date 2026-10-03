import { type PluginLocaleBundles, usePluginI18n } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

import type { ActivityInboxLabels } from './activity-inbox'

const en: ActivityInboxLabels = {
  activity: 'Activity',
  approval: 'Ready for approval',
  empty: 'You’re all caught up.',
  failed: 'Turn failed',
  mentionedYou: 'Mentioned you',
  needsYou: 'Needs you',
  open: 'Open',
  prompts: count => `${count} pending ${count === 1 ? 'prompt' : 'prompts'}`,
  taskNeedsYou: 'Task needs attention',
  unread: 'Unread'
}

const ja: ActivityInboxLabels = {
  activity: 'アクティビティ',
  approval: '承認待ち',
  empty: 'すべて確認済みです。',
  failed: 'ターン失敗',
  mentionedYou: 'あなたへのメンション',
  needsYou: '対応が必要',
  open: '開く',
  prompts: count => `保留中のプロンプト ${count} 件`,
  taskNeedsYou: 'タスクに対応が必要',
  unread: '未読'
}

const zh: ActivityInboxLabels = {
  activity: '动态',
  approval: '等待批准',
  empty: '已全部处理。',
  failed: '回合失败',
  mentionedYou: '提到了你',
  needsYou: '需要你处理',
  open: '打开',
  prompts: count => `${count} 个待处理提示`,
  taskNeedsYou: '任务需要处理',
  unread: '未读'
}

const zhHant: ActivityInboxLabels = {
  activity: '動態',
  approval: '等待核准',
  empty: '已全部處理。',
  failed: '回合失敗',
  mentionedYou: '提及了你',
  needsYou: '需要你處理',
  open: '開啟',
  prompts: count => `${count} 個待處理提示`,
  taskNeedsYou: '任務需要處理',
  unread: '未讀'
}

export const ACTIVITY_LOCALES: PluginLocaleBundles = { en, ja, zh, 'zh-hant': zhHant }

export function useActivityLabels(): ActivityInboxLabels {
  const t = usePluginI18n('merna-activity')

  return useMemo(
    () => ({
      activity: t('activity'),
      approval: t('approval'),
      empty: t('empty'),
      failed: t('failed'),
      mentionedYou: t('mentionedYou'),
      needsYou: t('needsYou'),
      open: t('open'),
      prompts: count => t('prompts', count),
      taskNeedsYou: t('taskNeedsYou'),
      unread: t('unread')
    }),
    [t]
  )
}
