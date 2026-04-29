import fs from 'node:fs';
import path from 'node:path';
import { ALL_PERSONAS, PERSONA_TOOLS, type Persona } from './personas.js';

export interface BootstrapOptions {
  worktreePath: string;
  miniMaxApiKey: string;
  /** Source directory containing <persona>.md body files. Defaults to the bundled worker personas. */
  personasSourceDir?: string;
}

const DEFAULT_PERSONAS_DIR = path.resolve(import.meta.dir, '..', '..', '..', 'worker', 'src', '.atelier', 'agents');
const MODEL_ID = 'minimax/abab6.5s-chat';
const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MODEL = 'MiniMax-M2.7';

const PERSONA_DESCRIPTIONS: Record<Persona, string> = {
  researcher:      'Reads the project and reports structure, features, gaps, and opportunities',
  'debate-signal': 'Argues FOR each candidate feature, finding genuine value',
  'debate-noise':  'Argues AGAINST each candidate feature, finding noise and overreach',
  arbiter:         'Reconciles signal and noise debate output into approved/rejected feature lists',
  'ticket-bot':    'Generates structured tickets with acceptance criteria from approved features',
  architect:       'Scopes tickets into technical plans with file-level precision',
  developer:       'Implements code in the worktree to satisfy a scoped ticket',
  'code-reviewer': 'Reviews implementation against acceptance criteria; never writes code',
  tester:          'Writes and runs tests verifying each acceptance criterion',
  pusher:          'Creates a branch, commits all changes, pushes, and reports the result',
};

export async function bootstrapWorktree(opts: BootstrapOptions): Promise<void> {
  const sourceDir = opts.personasSourceDir ?? DEFAULT_PERSONAS_DIR;

  const config = {
    $schema: 'https://opencode.ai/config.json',
    plugin: [],
    provider: {
      primary: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Atelier Primary (MiniMax)',
        options: {
          baseURL: DEFAULT_BASE_URL,
          apiKey: opts.miniMaxApiKey,
        },
        models: {
          [DEFAULT_MODEL]: { name: DEFAULT_MODEL },
        },
      },
    },
    model: `primary/${DEFAULT_MODEL}`,
    permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' },
  };
  fs.writeFileSync(path.join(opts.worktreePath, 'opencode.json'), JSON.stringify(config, null, 2));

  const agentDir = path.join(opts.worktreePath, '.opencode', 'agent');
  fs.mkdirSync(agentDir, { recursive: true });

  for (const persona of ALL_PERSONAS) {
    const sourceFile = path.join(sourceDir, `${persona}.md`);
    const body = fs.readFileSync(sourceFile, 'utf-8');
    const tools = PERSONA_TOOLS[persona];
    const frontmatter = [
      '---',
      `description: ${PERSONA_DESCRIPTIONS[persona]}`,
      `model: ${MODEL_ID}`,
      'tools:',
      `  read: ${tools.read}`,
      `  write: ${tools.write}`,
      `  edit: ${tools.edit}`,
      `  bash: ${tools.bash}`,
      `  webfetch: ${tools.webfetch}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(agentDir, `${persona}.md`), frontmatter + body);
  }

  fs.mkdirSync(path.join(opts.worktreePath, '.atelier', 'output'), { recursive: true });
}
