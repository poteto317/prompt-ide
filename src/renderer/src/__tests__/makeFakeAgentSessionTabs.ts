import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import { createAgentSessionTabs } from '../lib/agentSessionTabs'
import type { AgentSessionTabs } from '../lib/agentSessionTabs'
import { makeFakeController } from './makeFakeAgentTerminal'

// タブの置き場は本物で、controller だけを偽物にする(jsdom では xterm を開けないため)。上限は本番の xtermFactory と同じ
// AGENT_MAX_SESSIONS_PER_WINDOW(useAgentSessions の + の判定と揃える)。slotId は作った順に slot-1, slot-2, ...
export function makeFakeAgentSessionTabs(): AgentSessionTabs {
  let next = 0
  return createAgentSessionTabs({
    createController: makeFakeController,
    createSlotId: () => `slot-${++next}`,
    max: AGENT_MAX_SESSIONS_PER_WINDOW
  })
}
