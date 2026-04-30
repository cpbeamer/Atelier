import { afterEach, describe, expect, test } from 'bun:test';
import { ContextBroker } from '../src/subagent/context-broker';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ContextBroker', () => {
  test('formats compact shared context for prompts', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      facts: ['uses Bun'],
      decisions: ['keep context run-scoped'],
      fileFindings: [{ path: 'backend/src/db.ts', summary: 'stores context', sourceAgentId: 'librarian' }],
      gotchas: ['backend outages are non-fatal'],
      openQuestions: [],
      issues: [],
      verification: [],
      agentSummaries: [{ agentId: 'a', agentName: 'Agent A', summary: 'mapped the codebase', createdAt: 1 }],
    }), { status: 200 })) as typeof fetch;

    const broker = new ContextBroker({ backendUrl: 'http://test.local' });
    const prompt = await broker.formatForPrompt('run-1');

    expect(prompt).toContain('## Shared Run Context');
    expect(prompt).toContain('uses Bun');
    expect(prompt).toContain('backend/src/db.ts: stores context');
    expect(prompt).toContain('Agent A: mapped the codebase');
  });

  test('recordAgentResult extracts structured context fields', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const broker = new ContextBroker({ backendUrl: 'http://test.local' });
    await broker.recordAgentResult('run-1', {
      agentId: 'librarian',
      agentName: 'Librarian',
      category: 'docs-research',
      output: JSON.stringify({
        facts: ['fact'],
        fileFindings: [{ path: 'README.md', summary: 'documents setup', sourceAgentId: 'librarian' }],
        recommendedContextForNextAgents: ['next agent context'],
        openQuestions: ['question'],
        gotchas: ['gotcha'],
      }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://test.local/api/runs/run-1/context/append');
    expect(calls[0].body.context.facts).toEqual(['fact', 'next agent context']);
    expect(calls[0].body.context.fileFindings).toEqual([
      { path: 'README.md', summary: 'documents setup', sourceAgentId: 'librarian' },
    ]);
    expect(calls[0].body.context.openQuestions).toEqual(['question']);
    expect(calls[0].body.context.gotchas).toEqual(['gotcha']);
    expect(calls[0].body.context.agentSummaries[0].agentId).toBe('librarian');
  });
});
