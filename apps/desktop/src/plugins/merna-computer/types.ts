export type ComputerStepKind =
  'ask' | 'browser' | 'code' | 'delegate' | 'memory' | 'other' | 'plan' | 'search' | 'terminal'

export type ComputerStepStatus = 'error' | 'ok' | 'running'

export interface ComputerSession {
  id: string
  title: string
  model: string
  started_at: number
  last_activity_at: null | number
  ended_at: null | number
  status: string
  tool_calls: number
}

export interface ComputerStep {
  id: string
  seq: number
  ts: number
  done_ts: null | number
  tool: string
  kind: ComputerStepKind
  status: ComputerStepStatus
  title: string
  preview: null | string
  error: null | string
}

export interface ComputerPlanStep {
  id: string
  title: string
  status: string
}

export interface ComputerPlan {
  id: string
  goal: string
  status: string
  steps: ComputerPlanStep[]
  done: number
  total: number
  current: null | string
}

export interface ComputerHelper {
  id: string
  title: string
  goal: null | string
  status: string
  started_at: number
  ended_at: null | number
  last_activity_at: null | number
  tool_calls: number
  last_step: null | string
}

export interface ComputerFeed {
  session: ComputerSession
  cursor: number
  steps: ComputerStep[]
  plan: null | ComputerPlan
  helpers: ComputerHelper[]
  say: null | string
  now: number
}
