// worker/src/workflows/index.ts
// Re-export all workflows for Temporal discovery.
// Every workflow the backend can start must appear here, otherwise Temporal's
// workflow bundle won't find it and `workflow.start` will fail with
// "no such function is exported by the workflow bundle".
export { featurePipeline } from './feature-pipeline.js';
export { agentChild } from './agent-child.js';
export { autopilotWorkflow } from './autopilot.workflow.js';
export { featureWorkflow } from './feature.workflow.js';
export { greenfieldWorkflow } from './greenfield.workflow.js';
export { mvpWorkflow } from './mvp.workflow.js';
export { pmValidationWorkflow } from './pm-validation.workflow.js';
