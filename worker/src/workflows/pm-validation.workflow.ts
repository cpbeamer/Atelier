// worker/src/workflows/pm-validation.workflow.ts
import { defineWorkflow, callAgent, milestone } from '../workflow-sdk.js';

export const pmValidationWorkflow = defineWorkflow({
  name: 'pm-validation',
  input: { proposal: '' },

  run: async (input: { proposal: string }) => {
    const review = await callAgent('PM Validator', 'pm-validator', input.proposal);

    const decision = await milestone('PM Validation Review', { review });
    if (decision.verdict !== 'Approved') {
      return { status: 'rejected', verdict: decision };
    }

    return { status: 'completed', review };
  },
});
