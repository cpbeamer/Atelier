// worker/src/worker.ts
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities.ts';
import { watch } from 'chokidar';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Non-blocking probe so operators see opencode availability in worker logs.
 *  When ATELIER_USE_OPENCODE=1 the implementer tries to spawn opencode; if it's
 *  not on PATH the activity will fall back to the legacy direct-LLM path. */
async function probeOpencode(): Promise<void> {
  try {
    const proc = Bun.spawn(['opencode', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log(`[worker] opencode ${out.trim()} available`);
    } else {
      console.warn('[worker] opencode probe exited non-zero — implementer will fall back to direct-LLM');
    }
  } catch {
    console.warn('[worker] opencode not found on PATH — implementer will fall back to direct-LLM (install with: npm install -g opencode-ai)');
  }
}

async function run() {
  void probeOpencode();
  const address = process.env.TEMPORAL_ADDRESS || '127.0.0.1:7466';
  console.log(`[worker] connecting to Temporal at ${address}`);
  const connection = await NativeConnection.connect({ address });

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
