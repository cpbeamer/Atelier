export type Persona =
  | 'researcher'
  | 'debate-signal'
  | 'debate-noise'
  | 'arbiter'
  | 'ticket-bot'
  | 'architect'
  | 'developer'
  | 'code-reviewer'
  | 'tester'
  | 'pusher';

export const ALL_PERSONAS: Persona[] = [
  'researcher',
  'debate-signal',
  'debate-noise',
  'arbiter',
  'ticket-bot',
  'architect',
  'developer',
  'code-reviewer',
  'tester',
  'pusher',
];

export interface PersonaTools {
  read: boolean;
  write: boolean;
  edit: boolean;
  bash: boolean;
  webfetch: boolean;
}

export const PERSONA_TOOLS: Record<Persona, PersonaTools> = {
  researcher:      { read: true, write: true, edit: false, bash: false, webfetch: true  },
  'debate-signal': { read: true, write: true, edit: false, bash: false, webfetch: true  },
  'debate-noise':  { read: true, write: true, edit: false, bash: false, webfetch: true  },
  arbiter:         { read: true, write: true, edit: false, bash: false, webfetch: false },
  'ticket-bot':    { read: true, write: true, edit: false, bash: false, webfetch: false },
  architect:       { read: true, write: true, edit: false, bash: true,  webfetch: false },
  developer:       { read: true, write: true, edit: true,  bash: true,  webfetch: false },
  'code-reviewer': { read: true, write: true, edit: false, bash: false, webfetch: false },
  tester:          { read: true, write: true, edit: false, bash: true,  webfetch: false },
  pusher:          { read: true, write: true, edit: false, bash: true,  webfetch: false },
};
