// frontend/src/components/TerminalPane.tsx
//
// Composite pane: shows the structured AgentTranscript by default, with a
// toggle to drop into a raw xterm.js view for the underlying PTY stream.

import { useState } from 'react';
import { AgentTranscript } from './AgentTranscript';
import { RawTerminalView } from './RawTerminalView';

type ViewMode = 'structured' | 'raw';

interface Props {
  agentId: string;
  isActive: boolean;
  /** If this agent also has a backing PTY stream, supply its id to enable the raw view. */
  ptyId?: string;
  defaultView?: ViewMode;
}

export function TerminalPane({ agentId, isActive, ptyId, defaultView = 'structured' }: Props) {
  const [view, setView] = useState<ViewMode>(defaultView);
  const canToggle = !!ptyId;

  return (
    <div className="relative h-full w-full">
      {view === 'structured' ? (
        <AgentTranscript agentId={agentId} isActive={isActive} />
      ) : (
        ptyId && <RawTerminalView ptyId={ptyId} />
      )}

      {canToggle && (
        <div className="absolute top-2 right-2 z-10 flex border border-[#1e2024] bg-[#0d0f12]/80 backdrop-blur-sm">
          <button
            onClick={() => setView('structured')}
            className={`px-2 py-1 text-[10px] font-display uppercase tracking-[0.25em] transition-colors ${
              view === 'structured' ? 'bg-[#1e2024] text-[#d4ff00]' : 'text-[#6b6b68] hover:text-[#d4d2cc]'
            }`}
          >
            feed
          </button>
          <button
            onClick={() => setView('raw')}
            className={`px-2 py-1 text-[10px] font-display uppercase tracking-[0.25em] transition-colors ${
              view === 'raw' ? 'bg-[#1e2024] text-[#d4ff00]' : 'text-[#6b6b68] hover:text-[#d4d2cc]'
            }`}
          >
            raw
          </button>
        </div>
      )}
    </div>
  );
}
