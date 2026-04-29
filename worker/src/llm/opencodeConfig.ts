// Helpers for setting up an opencode workspace inside a git worktree before
// invoking `opencode run`. Two artefacts are written:
//
//   opencode.json   — provider config derived from the user's primary provider
//   AGENTS.md       — the developer persona, *only* if the project doesn't
//                     already ship its own AGENTS.md (theirs wins)
//
// The provider's API key is never written into opencode.json. opencode.json
// references it via `{env:ATELIER_OPENCODE_API_KEY}`, and the actual value is
// passed into the subprocess via env on /api/pty/spawn so it doesn't leak into
// the long-lived backend process.env.

import fs from 'node:fs';
import path from 'node:path';
import type { PrimaryProvider, ProviderKind } from './callLLM';

/** Env var the spawned opencode subprocess reads for the provider API key.
 *  Referenced by `{env:...}` in the generated opencode.json. */
export const OPENCODE_API_KEY_ENV = 'ATELIER_OPENCODE_API_KEY';

const NPM_PACKAGE_FOR_KIND: Record<ProviderKind, string> = {
  'minimax': '@ai-sdk/openai-compatible',
  'openai-compatible': '@ai-sdk/openai-compatible',
  'anthropic': '@ai-sdk/anthropic',
};

export interface OpencodeConfigShape {
  $schema: string;
  provider: Record<string, {
    npm: string;
    name: string;
    options: { baseURL: string; apiKey: string };
    models: Record<string, { name: string }>;
  }>;
  model: string;
  permission: {
    edit: 'allow';
    bash: 'allow';
    webfetch: 'allow';
  };
}

export function buildOpencodeConfig(provider: PrimaryProvider): OpencodeConfigShape {
  const npm = NPM_PACKAGE_FOR_KIND[provider.kind] ?? '@ai-sdk/openai-compatible';
  const model = provider.selectedModel ?? 'default';
  return {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      primary: {
        npm,
        name: `Atelier Primary (${provider.name})`,
        options: {
          baseURL: provider.baseUrl,
          apiKey: `{env:${OPENCODE_API_KEY_ENV}}`,
        },
        models: {
          [model]: { name: model },
        },
      },
    },
    model: `primary/${model}`,
    permission: {
      edit: 'allow',
      bash: 'allow',
      webfetch: 'allow',
    },
  };
}

export async function writeOpencodeConfig(
  worktreePath: string,
  provider: PrimaryProvider,
): Promise<void> {
  const config = buildOpencodeConfig(provider);
  await fs.promises.writeFile(
    path.join(worktreePath, 'opencode.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}

/** Write the developer persona as AGENTS.md so opencode picks it up as system
 *  instructions. Skipped if the project already has an AGENTS.md — the user's
 *  own instructions take precedence. */
export async function writeAgentsRules(
  worktreePath: string,
  personaContents: string,
): Promise<{ written: boolean }> {
  const dest = path.join(worktreePath, 'AGENTS.md');
  try {
    await fs.promises.access(dest);
    return { written: false };
  } catch {
    // does not exist
  }
  await fs.promises.writeFile(dest, personaContents, 'utf-8');
  return { written: true };
}
