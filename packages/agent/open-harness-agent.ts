/**
 * @deprecated Use machina-agent.ts instead. This file exists for backwards compatibility.
 */
export {
  defaultModel,
  defaultModelLabel,
  machinaAgent as openHarnessAgent,
} from "./machina-agent";
export type {
  AgentModelSelection,
  AgentSandboxContext,
  OpenHarnessAgent,
  OpenHarnessAgentCallOptions,
  OpenHarnessAgentModelInput,
} from "./machina-agent";
