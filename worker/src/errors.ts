// Errors worth distinguishing in the workflow layer.
// Temporal's retry policy is configured with `nonRetryableErrorTypes: ['NonRetryableAgentError']`
// — throwing this class from an activity prevents Temporal from retrying it.
// Use for structural failures that won't be fixed by a retry (e.g. the model
// produced zero file edits, persona files missing, invalid input).

export class NonRetryableAgentError extends Error {
  name = 'NonRetryableAgentError';
  constructor(message: string) {
    super(message);
    // Preserve stack under V8 (Node, Bun, etc.)
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, NonRetryableAgentError);
    }
  }
}
