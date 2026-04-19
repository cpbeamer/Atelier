// worker/src/worker.ts
import { Worker } from '@temporalio/worker';
import * as activities from './activities.js';
import { watch } from 'chokidar';

async function run() {
  const worker = await Worker.create({
    workflowsPath: new URL('./workflows', import.meta.url).pathname,
    activities,
    taskQueue: 'atelier-default-ts',
    connectionOptions: { address: '127.0.0.1:7466' },
  });

  watch('./workflows/*.workflow.ts', { persistent: true }).on('change', (filePath) => {
    console.log(`Workflow changed: ${filePath}`);
  });

  console.log('Bun Temporal Worker started on atelier-default-ts');
  await worker.run();
}

run().catch((err) => { console.error('Worker failed', err); process.exit(1); });
