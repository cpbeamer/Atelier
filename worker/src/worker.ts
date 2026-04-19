import { Worker } from '@temporalio/worker';
import * as activities from './activities.js';

async function run() {
  const worker = await Worker.create({
    workflowsPath: new URL('./workflows/mvp.workflow.ts', import.meta.url).pathname,
    activities,
    taskQueue: 'atelier-mvp-ts',
    connectionOptions: {
      address: '127.0.0.1:7466',
    },
  });

  console.log('Bun Temporal Worker started. Listening on atelier-mvp-ts task queue...');
  await worker.run();
}

run().catch((err) => {
  console.error('Worker failed', err);
  process.exit(1);
});
