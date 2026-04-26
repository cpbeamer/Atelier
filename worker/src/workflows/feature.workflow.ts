// worker/src/workflows/feature.workflow.ts
import { defineWorkflow, callAgent, milestone } from '../workflow-sdk.js';

export const featureWorkflow = defineWorkflow({
  name: 'feature',
  input: { signal: '' },

  run: async (input: { signal: string }) => {
    const proposal = await callAgent('PM Specialist', 'pm-specialist', input.signal);
    const verdict = await callAgent('PM Validator', 'pm-validator', proposal);

    const decision = await milestone('PM Proposal Review', { proposal, verdict });
    if (decision.verdict !== 'Approved') {
      return { status: 'rejected', verdict: decision };
    }

    const design = await callAgent('Architect', 'architect', proposal);
    const code = await callAgent('Code Writer', 'code-writer', design);

    return { status: 'completed', design, code };
  },
});
