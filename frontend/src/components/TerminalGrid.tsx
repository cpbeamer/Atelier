// frontend/src/components/TerminalGrid.tsx
import { useState, useCallback, useEffect } from 'react';
import GridLayout from 'react-grid-layout';
import { TerminalPane } from './TerminalPane';
import { X, Plus } from 'lucide-react';
import 'react-grid-layout/css/styles.css';

export interface TerminalPaneConfig {
  id: string;
  agentName: string;
  agentType: 'terminal' | 'direct-llm';
  status: 'running' | 'exited' | 'killed' | 'waiting';
}

interface Props {
  panes: TerminalPaneConfig[];
  onPaneClose?: (id: string) => void;
  onPaneAdd?: () => void;
}

export function TerminalGrid({ panes, onPaneClose, onPaneAdd }: Props) {
  const [layout, setLayout] = useState(() =>
    panes.map((pane, i) => ({
      i: pane.id,
      x: 0,
      y: i * 6,
      w: 12,
      h: 8,
      minW: 3,
      minH: 4,
    }))
  );

  useEffect(() => {
    setLayout((prev) => {
      const newIds = panes.map((p) => p.id);
      const filtered = prev.filter((l) => newIds.includes(l.i));
      const existingIds = filtered.map((l) => l.i);
      for (const pane of panes) {
        if (!existingIds.includes(pane.id)) {
          filtered.push({
            i: pane.id,
            x: 0,
            y: (prev.length > 0 ? Math.max(...prev.map((l) => l.y + l.h)) : 0),
            w: 12,
            h: 8,
            minW: 3,
            minH: 4,
          });
        }
      }
      return filtered;
    });
  }, [panes.length]);

  const handleLayoutChange = useCallback((newLayout: GridLayout.Layout[]) => {
    setLayout(newLayout);
  }, []);

  return (
    <div className="relative h-full w-full bg-muted/20">
      {/* Toolbar */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        <button
          onClick={onPaneAdd}
          className="p-1.5 rounded-md bg-card border border-border hover:bg-secondary transition-colors"
          title="Add terminal pane"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <GridLayout
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={30}
        width={1200}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".pane-header"
        compactType="vertical"
        preventCollision={false}
      >
        {panes.map((pane) => (
          <div key={pane.id} className="bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 flex flex-col">
            {/* Pane Header */}
            <div className="pane-header h-8 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3 cursor-move">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-zinc-400">{pane.agentName}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  pane.status === 'running' ? 'bg-green-900 text-green-300' :
                  pane.status === 'exited' ? 'bg-zinc-700 text-zinc-400' :
                  pane.status === 'killed' ? 'bg-red-900 text-red-300' :
                  'bg-yellow-900 text-yellow-300'
                }`}>
                  {pane.status}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onPaneClose?.(pane.id)}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Terminal Content */}
            <div className="flex-1 bg-black">
              <TerminalPane paneId={pane.id} isActive={pane.status === 'running'} />
            </div>
          </div>
        ))}
      </GridLayout>
    </div>
  );
}