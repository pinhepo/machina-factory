import type { SandboxState } from "@machina-factory/sandbox";
import {
  gateway as aiGatewaySync,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import {
  type GatewayModelId,
  gateway,
  type ProviderOptionsByProvider,
} from "./models";

import type { SkillMetadata } from "./skills/types";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
  skillTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
} from "./tools";

export interface AgentModelSelection {
  id: GatewayModelId;
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export type MachinaAgentModelInput = GatewayModelId | AgentModelSelection;

/** @deprecated Use MachinaAgentModelInput */
export type OpenHarnessAgentModelInput = MachinaAgentModelInput;

export interface AgentSandboxContext {
  state: SandboxState;
  workingDirectory: string;
  currentBranch?: string;
  environmentDetails?: string;
}

const callOptionsSchema = z.object({
  sandbox: z.custom<AgentSandboxContext>(),
  model: z.custom<OpenHarnessAgentModelInput>().optional(),
  subagentModel: z.custom<OpenHarnessAgentModelInput>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
});

export type MachinaAgentCallOptions = z.infer<typeof callOptionsSchema>;

/** @deprecated Use MachinaAgentCallOptions */
export type OpenHarnessAgentCallOptions = MachinaAgentCallOptions;

// Default model label — used as fallback when no model is specified per-request.
// Prefer Google when available (no AI Gateway needed), otherwise fall back to gateway.
export const defaultModelLabel: GatewayModelId = process.env
  .GOOGLE_GENERATIVE_AI_API_KEY
  ? ("google/gemini-2.5-pro" as GatewayModelId)
  : ("anthropic/claude-opus-4.6" as GatewayModelId);

// Default model is resolved synchronously via AI Gateway (the async direct-provider
// path is only used when prepareCall overrides the model per-request).
export const defaultModel = aiGatewaySync(defaultModelLabel);

function normalizeAgentModelSelection(
  selection: OpenHarnessAgentModelInput | undefined,
  fallbackId: GatewayModelId,
): AgentModelSelection {
  if (!selection) {
    return { id: fallbackId };
  }

  return typeof selection === "string" ? { id: selection } : selection;
}

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  skill: skillTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

export const machinaAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(1),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps: _steps }) => {
    return {
      messages: addCacheControl({
        messages,
        model,
      }),
    };
  },
  prepareCall: async ({ options, ...settings }) => {
    if (!options) {
      throw new Error(
        "Machina Factory agent requires call options with sandbox.",
      );
    }

    const mainSelection = normalizeAgentModelSelection(
      options.model,
      defaultModelLabel,
    );
    const subagentSelection = options.subagentModel
      ? normalizeAgentModelSelection(options.subagentModel, defaultModelLabel)
      : undefined;

    const callModel = await gateway(mainSelection.id, {
      providerOptionsOverrides: mainSelection.providerOptionsOverrides,
    });
    const subagentModel = subagentSelection
      ? await gateway(subagentSelection.id, {
          providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
        })
      : undefined;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const skills = options.skills ?? [];

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: mainSelection.id,
    });

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      instructions,
      experimental_context: {
        sandbox,
        skills,
        model: callModel,
        subagentModel,
      },
    };
  },
});

/** @deprecated Use machinaAgent */
export const openHarnessAgent = machinaAgent;

export type MachinaAgent = typeof machinaAgent;
/** @deprecated Use MachinaAgent */
export type OpenHarnessAgent = MachinaAgent;
