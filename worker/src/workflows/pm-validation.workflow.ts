// worker/src/workflows/pm-validation.workflow.ts
import { defineWorkflow, callAgent, milestone } from '../workflow-sdk.js';

export const pmValidationWorkflow = defineWorkflow({
  name: 'pm-validation',
  input: { proposal: '' },

  run: async (ctx, input) => {
    const review = await callAgent(ctx, 'PM Validator', { proposal: input.proposal });

    const decision = await milestone(ctx, 'PM Validation Review', { review });
    if (decision.verdict !== 'Approved') {
      return { status: 'rejected', verdict: decision };
    }

    return { status: 'completed', review };
  },
});
