// worker/src/workflows/feature-pipeline.ts
import { proxyActivities, executeChild } from '@temporalio/workflow';
import type * as activities from '../activities.ts';
import type { agentChild } from './agent-child.ts';

const { createMilestone } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
});

export interface PipelineInput {
  signal: string;  // User's task prompt
  runId?: string;
}

export interface PipelineOutput {
  status: 'completed' | 'rejected';
  phase?: string;
  code?: string;
  error?: string;
}

export async function featurePipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { signal, runId } = input;
  let currentPhase = 'research';

  try {
    // Phase 1: Parallel Research
    console.log('Phase 1: Starting parallel research...');
    currentPhase = 'research';
    const [researchA, researchB] = await Promise.all([
      executeChild<typeof agentChild>('agentChild', {
        args: [{
          agentName: 'Researcher A',
          persona: 'researcher-a',
          task: signal,
          runId,
          category: 'docs-research',
        }],
      }),
      executeChild<typeof agentChild>('agentChild', {
        args: [{
          agentName: 'Researcher B',
          persona: 'researcher-b',
          task: signal,
          runId,
          category: 'code-exploration',
        }],
      }),
    ]);
    console.log('Phase 1: Research complete');

    // Phase 2: Synthesis
    console.log('Phase 2: Starting synthesis...');
    currentPhase = 'synthesis';
    const synthesis = await executeChild<typeof agentChild>('agentChild', {
      args: [{
        agentName: 'Synthesizer',
        persona: 'synthesizer',
        task: signal,
        context: {
          'Researcher A': researchA,
          'Researcher B': researchB,
        },
        runId,
        category: 'writing',
      }],
    });
    console.log('Phase 2: Synthesis complete');

    // Phase 3: Milestone - Review Synthesis
    const decision1 = await createMilestone('Review Synthesis', { synthesis });
    if (decision1.verdict !== 'Approved') {
      return { status: 'rejected', phase: 'synthesis' };
    }

    // Phase 4: Architecture
    console.log('Phase 4: Starting architecture...');
    currentPhase = 'architecture';
    const design = await executeChild<typeof agentChild>('agentChild', {
      args: [{
        agentName: 'Architect',
        persona: 'architect',
        task: signal,
        context: { synthesis },
        runId,
        category: 'architecture',
      }],
    });
    console.log('Phase 4: Architecture complete');

    // Phase 5: Milestone - Approve Design
    const decision2 = await createMilestone('Approve Design', { design });
    if (decision2.verdict !== 'Approved') {
      return { status: 'rejected', phase: 'design' };
    }

    // Phase 6: Implementation
    console.log('Phase 6: Starting code writing...');
    currentPhase = 'implementation';
    const code = await executeChild<typeof agentChild>('agentChild', {
      args: [{
        agentName: 'Code Writer',
        persona: 'code-writer',
        task: signal,
        context: { design },
        runId,
        category: 'implementation',
      }],
    });
    console.log('Phase 6: Code writing complete');

    // Phase 7: Milestone - Review Implementation
    const decision3 = await createMilestone('Review Implementation', { code });
    if (decision3.verdict !== 'Approved') {
      return { status: 'rejected', phase: 'implementation' };
    }

    return { status: 'completed', code };
  } catch (e) {
    return { status: 'rejected', phase: currentPhase, error: String(e) };
  }
}
