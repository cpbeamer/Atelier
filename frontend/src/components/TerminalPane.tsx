// frontend/src/components/TerminalPane.tsx
//
// Composite pane: structured AgentTranscript by default, raw xterm fallback.

import { useState } from 'react';
import { AgentTranscript } from './AgentTranscript';
import { RawTerminalView } from './RawTerminalView';
import { FileText, Terminal as TerminalIcon } from 'lucide-react';

type ViewMode = 'structured' | 'raw';

interface Props {
  agentId: string;
  isActive: boolean;
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
        <div className="absolute top-2.5 right-2.5 z-10 flex rounded-md border border-[var(--color-hair)] bg-[var(--color-surface)]/85 backdrop-blur-sm overflow-hidden">
          <button
            onClick={() => setView('structured')}
            className={`p-1.5 transition-colors ${
              view === 'structured'
                ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
            title="Structured feed"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setView('raw')}
            className={`p-1.5 transition-colors ${
              view === 'raw'
                ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
            title="Raw terminal"
          >
            <TerminalIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
