// worker/src/workflows/feature.workflow.ts
import { defineWorkflow, callAgent, milestone } from '../workflow-sdk.js';

export const featureWorkflow = defineWorkflow({
  name: 'feature',
  input: { signal: '' },

  run: async (ctx, input) => {
    const proposal = await callAgent(ctx, 'PM Specialist', { signal: input.signal });
    const verdict = await callAgent(ctx, 'PM Validator', { proposal });

    const decision = await milestone(ctx, 'PM Proposal Review', { proposal, verdict });
    if (decision.verdict !== 'Approved') {
      return { status: 'rejected', verdict: decision };
    }

    const design = await callAgent(ctx, 'Architect', { proposal });
    const code = await callAgent(ctx, 'Code Writer', { design });

    return { status: 'completed', design, code };
  },
});
