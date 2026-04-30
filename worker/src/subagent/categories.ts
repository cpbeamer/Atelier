// Category-based routing — classifies incoming tasks and routes them
// to appropriate specialized agents, following the pattern from
// oh-my-opencode's category system.

import { BackgroundManager } from './background-manager.js';
import { sendAgentPrompt } from '../llm/opencodeServeClient.js';
import { callLLM, getPrimaryModelName } from '../llm/callLLM.js';
import { loadPersona } from '../personaLoader.js';
import { withJsonRetry } from '../llm/withJsonRetry.js';
import { notifyAgentStart, notifyAgentComplete } from '../activities.js';
import { useOpencode } from '../llm/featureFlags.js';
import { contextBroker } from './context-broker.js';

export type Category =
  | 'visual-engineering'   // Gemini for UI/frontend work
  | 'ultrabrain'           // GPT-xhigh for hard logic
  | 'deep'                 // GPT-4 for autonomous research
  | 'artistry'             // Gemini for creative/design
  | 'quick'                // GPT-4 Mini for fast tasks
  | 'unspecified-low'      // cheapest model
  | 'unspecified-high'     // best available
  | 'writing'              // Claude Opus for prose
  | 'review'               // Oracle + reviewer panel
  | 'docs-research'        // Librarian
  | 'code-exploration'     // Explorer
  | 'architecture'         // Oracle
  | 'implementation';     // Developer

export interface CategoryRoute {
  category: Category;
  primaryAgent: string;
  supportingAgents: string[];
  suggestedModel?: string;
  prompt?: string;
}

interface CategoryConfig {
  category: Category;
  keywords: string[];
  agentRouting: {
    primaryAgent: string;
    supportingAgents: string[];
    modelOverride?: string;
  };
}

const CATEGORY_CONFIGS: CategoryConfig[] = [
  {
    category: 'visual-engineering',
    keywords: ['ui', 'frontend', 'css', 'html', 'visual', 'design', 'component', 'button', 'layout', 'responsive'],
    agentRouting: { primaryAgent: 'designer', supportingAgents: ['explorer'] },
  },
  {
    category: 'ultrabrain',
    keywords: ['complex', 'algorithm', 'difficult', 'hard', 'intricate', 'multi-step', 'challenging'],
    agentRouting: { primaryAgent: 'oracle', supportingAgents: ['librarian'] },
  },
  {
    category: 'deep',
    keywords: ['research', 'investigate', 'analyze', 'explore', 'deep-dive', 'researching'],
    agentRouting: { primaryAgent: 'librarian', supportingAgents: ['explorer', 'synthesizer'] },
  },
  {
    category: 'artistry',
    keywords: ['creative', 'design', 'artistic', 'aesthetic', 'ux', 'user-experience'],
    agentRouting: { primaryAgent: 'designer', supportingAgents: ['oracle'] },
  },
  {
    category: 'quick',
    keywords: ['quick', 'fast', 'simple', 'trivial', 'small', 'easy', 'one-line', 'typo', 'fix'],
    agentRouting: { primaryAgent: 'developer', supportingAgents: [] },
  },
  {
    category: 'writing',
    keywords: ['write', 'documentation', 'readme', 'comment', 'prose', 'description', 'explain'],
    agentRouting: { primaryAgent: 'synthesizer', supportingAgents: ['librarian'] },
  },
  {
    category: 'review',
    keywords: ['review', 'critique', 'check', 'evaluate', 'assess', 'security', 'vulnerability'],
    agentRouting: { primaryAgent: 'oracle', supportingAgents: ['reviewer-correctness', 'reviewer-security', 'reviewer-tests', 'reviewer-style'] },
  },
  {
    category: 'docs-research',
    keywords: ['docs', 'documentation', 'search', 'look-up', 'find', 'official', 'api', 'reference'],
    agentRouting: { primaryAgent: 'librarian', supportingAgents: ['explorer'] },
  },
  {
    category: 'code-exploration',
    keywords: ['grep', 'find', 'search', 'where', 'locate', 'map', 'structure', 'architecture'],
    agentRouting: { primaryAgent: 'explorer', supportingAgents: ['librarian'] },
  },
  {
    category: 'architecture',
    keywords: ['architecture', 'design', 'system', 'refactor', 'restructure', 'plan', 'blueprint'],
    agentRouting: { primaryAgent: 'oracle', supportingAgents: ['architect', 'synthesizer'] },
  },
  {
    category: 'implementation',
    keywords: ['implement', 'code', 'build', 'create', 'add', 'feature', 'ticket', 'change'],
    agentRouting: { primaryAgent: 'developer', supportingAgents: ['oracle'] },
  },
];

export function detectCategory(taskOrPrompt: string): Category {
  const lower = taskOrPrompt.toLowerCase();

  for (const config of CATEGORY_CONFIGS) {
    const score = config.keywords.reduce((acc, keyword) =>
      acc + (lower.includes(keyword) ? 1 : 0), 0);
    if (score >= 2) {
      return config.category;
    }
  }

  // Default heuristics based on task structure
  if (lower.includes('visual') || lower.includes('ui') || lower.includes('frontend')) {
    return 'visual-engineering';
  }
  if (lower.includes('review') || lower.includes('security')) {
    return 'review';
  }
  if (lower.includes('architecture') || lower.includes('design')) {
    return 'architecture';
  }
  if (lower.includes('documentation') || lower.includes('docs')) {
    return 'docs-research';
  }

  return 'unspecified-high';
}

export async function delegateByCategory(
  category: Category,
  task: string,
  parentSessionId?: string,
  options: { runId?: string; cwd?: string; model?: string } = {},
): Promise<string> {
  const config = CATEGORY_CONFIGS.find(c => c.category === category) ?? {
    category: 'unspecified-high' as Category,
    keywords: [],
    agentRouting: { primaryAgent: 'developer', supportingAgents: [] },
  };

  const bgManager = BackgroundManager.getInstance();

  // Launch primary agent
  const primaryTaskId = await bgManager.launch(
    task,
    config.agentRouting.primaryAgent,
    `${config.agentRouting.primaryAgent}-${Date.now()}`,
    config.agentRouting.primaryAgent,
    parentSessionId,
    { ...options, category },
  );

  // Launch supporting agents in parallel
  if (config.agentRouting.supportingAgents.length > 0) {
    for (const agent of config.agentRouting.supportingAgents) {
      bgManager.launch(
        task,
        agent,
        `${agent}-${Date.now()}`,
        agent,
        parentSessionId,
        { ...options, category },
      );
    }
  }

  return primaryTaskId;
}

export async function runCategoryRoute(
  input: { task: string; parentSessionId?: string; runId?: string; cwd?: string },
): Promise<{ category: Category; primaryAgent: string; supportingAgents: string[]; result: string }> {
  const category = detectCategory(input.task);
  const config = CATEGORY_CONFIGS.find(c => c.category === category) ?? {
    agentRouting: { primaryAgent: 'developer', supportingAgents: [] },
  };

  const primaryAgent = config.agentRouting.primaryAgent;
  const supportingAgents = config.agentRouting.supportingAgents;

  const primaryPersona = await loadPersona(process.cwd(), primaryAgent);
  const agentId = `${primaryAgent}-category-${Date.now()}`;

  await notifyAgentStart({ agentId, agentName: `Category Route (${category})`, terminalType: 'direct-llm' });

  let result: string;
  try {
    const sharedContext = await contextBroker.formatForPrompt(input.runId);
    const prompt = `${input.task}${sharedContext}`;
    if (await useOpencode()) {
      result = await sendAgentPrompt({
        runId: input.runId ?? '',
        personaKey: agentId,
        personaText: primaryPersona,
        userPrompt: prompt,
      });
    } else {
      result = await callLLM(primaryPersona, prompt, {
        cwd: input.cwd,
        agentId,
        runId: input.runId,
      });
    }
    await contextBroker.recordAgentResult(input.runId, {
      agentId,
      agentName: `Category Route (${category})`,
      category,
      output: result,
    });
    await notifyAgentComplete({ agentId, status: 'completed', output: result.slice(0, 500), runId: input.runId });
  } catch (e) {
    await contextBroker.recordAgentResult(input.runId, {
      agentId,
      agentName: `Category Route (${category})`,
      category,
      error: String(e),
    });
    await notifyAgentComplete({ agentId, status: 'error', output: String(e).slice(0, 500), runId: input.runId });
    result = `Error: ${String(e)}`;
  }

  // Launch supporting agents in background
  if (supportingAgents.length > 0) {
    const bgManager = BackgroundManager.getInstance();
    for (const agent of supportingAgents) {
      bgManager.launch(
        input.task,
        agent,
        `${agent}-bg-${Date.now()}`,
        agent,
        input.parentSessionId,
        { runId: input.runId, cwd: input.cwd, category },
      );
    }
  }

  return { category, primaryAgent, supportingAgents, result };
}
