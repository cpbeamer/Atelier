// Canonical list of model providers. Adding one here = one new entry.
// On every backend boot, syncProvidersFromRegistry() in db.ts upserts these
// rows into model_config without disturbing user state (enabled, selected
// model, primary, API keys).

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'minimax';

export interface ProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  kind: ProviderKind;
  defaultModels: string[];
  defaultEnabled?: boolean;
}

export const CURATED_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    kind: 'minimax',
    defaultModels: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
    defaultEnabled: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    kind: 'anthropic',
    defaultModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    kind: 'openai-compatible',
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
  {
    id: 'google',
    name: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    kind: 'openai-compatible',
    defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    kind: 'openai-compatible',
    defaultModels: ['mistral-large-latest', 'codestral-latest'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    kind: 'openai-compatible',
    defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    kind: 'openai-compatible',
    defaultModels: ['llama-3.3-70b-versatile'],
  },
  {
    id: 'xai',
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    kind: 'openai-compatible',
    defaultModels: ['grok-3', 'grok-2-latest'],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    kind: 'openai-compatible',
    defaultModels: ['sonar-pro', 'sonar'],
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    kind: 'openai-compatible',
    defaultModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    kind: 'openai-compatible',
    defaultModels: ['command-r-plus', 'command-r'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    kind: 'openai-compatible',
    defaultModels: ['anthropic/claude-opus-4-7', 'openai/gpt-4o'],
  },
];
