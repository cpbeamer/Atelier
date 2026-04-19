// worker/src/worker.ts
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities.ts';
import { watch } from 'chokidar';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const connection = await NativeConnection.connect({
    address: '127.0.0.1:7466',
  });

  const worker = await Worker.create({
    connection,
    workflowsPath: path.join(__dirname, 'workflows'),
    activities,
    taskQueue: 'atelier-default-ts',
  });

  watch(path.join(__dirname, 'workflows', '*.workflow.ts'), { persistent: true }).on('change', (filePath) => {
    console.log(`Workflow changed: ${filePath}`);
  });

  console.log('Bun Temporal Worker started on atelier-default-ts');
  await worker.run();
}

run().catch((err) => { console.error('Worker failed', err); process.exit(1); });
