// frontend/src/components/TerminalGrid.tsx
import { useEffect, useRef, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import { X, Plus, Zap, GitBranch } from 'lucide-react';

export interface TerminalPaneConfig {
  id: string;
  agentName: string;
  agentType: 'terminal' | 'direct-llm';
  status: 'running' | 'exited' | 'killed' | 'waiting';
}

export interface TerminalConnection {
  from: string;
  to: string;
  type?: 'signal' | 'noise' | 'parent-child' | 'sibling';
}

interface Props {
  panes: TerminalPaneConfig[];
  connections?: TerminalConnection[];
  onPaneClose?: (id: string) => void;
  onPaneAdd?: () => void;
}

interface PanePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export function TerminalGrid({ panes, connections = [], onPaneClose, onPaneAdd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panePositions, setPanePositions] = useState<Map<string, PanePosition>>(new Map());

  useEffect(() => {
    const updatePositions = () => {
      if (!containerRef.current) return;

      const newPositions = new Map<string, PanePosition>();
      const containerRect = containerRef.current.getBoundingClientRect();
      const paneWidth = Math.min(400, (containerRect.width - 60) / 2);
      const paneHeight = 300;
      const gap = 20;
      const headerOffset = 60;

      // Arrange in a responsive grid: 2 columns for wider screens, 1 for narrow
      const cols = containerRect.width > 600 ? 2 : 1;

      panes.forEach((pane, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = col * (paneWidth + gap);
        const y = row * (paneHeight + gap) + headerOffset;

        newPositions.set(pane.id, {
          id: pane.id,
          x,
          y,
          width: paneWidth,
          height: paneHeight,
          centerX: x + paneWidth / 2,
          centerY: y + paneHeight / 2,
        });
      });

      setPanePositions(newPositions);
    };

    updatePositions();
    window.addEventListener('resize', updatePositions);
    return () => window.removeEventListener('resize', updatePositions);
  }, [panes]);

  const getConnectionPath = (from: PanePosition, to: PanePosition): string => {
    const dx = to.centerX - from.centerX;
    const dy = to.centerY - from.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const curvature = Math.min(distance * 0.25, 60);

    const perpX = -dy / distance * curvature;
    const perpY = dx / distance * curvature;

    const midX = (from.centerX + to.centerX) / 2 + perpX;
    const midY = (from.centerY + to.centerY) / 2 + perpY;

    return `M ${from.centerX} ${from.centerY} Q ${midX} ${midY} ${to.centerX} ${to.centerY}`;
  };

  const getMidpoint = (from: PanePosition, to: PanePosition) => ({
    x: (from.centerX + to.centerX) / 2,
    y: (from.centerY + to.centerY) / 2,
  });

  const getConnectionStatus = (fromId: string, toId: string) => {
    const fromPane = panes.find(p => p.id === fromId);
    const toPane = panes.find(p => p.id === toId);
    return fromPane?.status === 'running' && toPane?.status === 'running' ? 'active' : 'inactive';
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-auto bg-slate-50"
      style={{ position: 'relative' }}
    >
      {/* Toolbar */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <button
          onClick={onPaneAdd}
          className="p-2 rounded-lg border bg-white border-slate-200 hover:border-emerald-500/50 transition-all duration-300"
          title="Add terminal pane"
        >
          <Plus className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      {/* SVG Connection Layer */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 5, minWidth: '100%', minHeight: '100%' }}
      >
        <defs>
          <linearGradient id="conn-active" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(34, 197, 94, 0)" />
            <stop offset="50%" stopColor="rgba(34, 197, 94, 0.9)" />
            <stop offset="100%" stopColor="rgba(34, 197, 94, 0)" />
          </linearGradient>
          <linearGradient id="conn-signal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(168, 85, 247, 0)" />
            <stop offset="50%" stopColor="rgba(168, 85, 247, 0.9)" />
            <stop offset="100%" stopColor="rgba(168, 85, 247, 0)" />
          </linearGradient>
          <linearGradient id="conn-noise" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(251, 146, 60, 0)" />
            <stop offset="50%" stopColor="rgba(251, 146, 60, 0.9)" />
            <stop offset="100%" stopColor="rgba(251, 146, 60, 0)" />
          </linearGradient>
          <filter id="conn-glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {connections.map((conn, idx) => {
          const fromPos = panePositions.get(conn.from);
          const toPos = panePositions.get(conn.to);
          if (!fromPos || !toPos) return null;

          const path = getConnectionPath(fromPos, toPos);
          const mid = getMidpoint(fromPos, toPos);
          const isActive = getConnectionStatus(conn.from, conn.to) === 'active';
          const gradientId = conn.type === 'signal' ? 'conn-signal' : conn.type === 'noise' ? 'conn-noise' : 'conn-active';

          return (
            <g key={idx}>
              <path
                d={path}
                fill="none"
                stroke={conn.type === 'signal' ? 'rgba(168, 85, 247, 0.25)' :
                        conn.type === 'noise' ? 'rgba(251, 146, 60, 0.25)' :
                        'rgba(34, 197, 94, 0.25)'}
                strokeWidth={isActive ? 3 : 1.5}
                className={isActive ? 'connection-line' : ''}
              />
              {isActive && (
                <path
                  d={path}
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth={4}
                  strokeLinecap="round"
                  filter="url(#conn-glow)"
                  className="connection-flow"
                />
              )}
              {isActive && (
                <g transform={`translate(${mid.x}, ${mid.y})`}>
                  <circle r="10" fill={conn.type === 'signal' ? '#a855f7' : conn.type === 'noise' ? '#f97316' : '#22c55e'} className="pulse-icon" />
                  {conn.type === 'signal' || conn.type === 'noise' ? (
                    <Zap className="w-3 h-3 text-white absolute" style={{ transform: 'translate(-5px, -5px)' }} />
                  ) : (
                    <GitBranch className="w-3 h-3 text-white absolute" style={{ transform: 'translate(-5px, -5px)' }} />
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Pane Grid */}
      <div
        className="relative p-8 grid gap-5"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
          minHeight: '100%',
        }}
      >
        {panes.map((pane) => {
          const isRunning = pane.status === 'running';
          const isConnected = connections.some(c =>
            (c.from === pane.id || c.to === pane.id) &&
            getConnectionStatus(c.from, c.to) === 'active'
          );

          return (
            <div
              key={pane.id}
              className={`rounded-2xl overflow-hidden border shadow-lg transition-all duration-300 ${
                isRunning
                  ? isConnected
                    ? 'border-emerald-500 shadow-emerald-200/50 glow-active'
                    : 'border-slate-300 shadow-emerald-200/30 glow-subtle'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Pane Header */}
              <div className="h-10 flex items-center justify-between px-4 border-b border-slate-200 bg-gradient-to-r from-slate-100 to-slate-50">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                    isRunning
                      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                      : 'bg-slate-400'
                  }`} />
                  <span className="text-sm font-semibold tracking-wide text-slate-900">{pane.agentName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-mono uppercase tracking-wider border ${
                    isRunning
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : pane.status === 'exited'
                      ? 'bg-slate-100 text-slate-500 border-slate-200'
                      : pane.status === 'killed'
                      ? 'bg-red-50 text-red-600 border-red-200'
                      : 'bg-amber-100 text-amber-700 border-amber-200'
                  }`}>
                    {pane.status}
                  </span>
                  <button
                    onClick={() => onPaneClose?.(pane.id)}
                    className="p-1.5 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Terminal Content */}
              <div className="h-64 bg-slate-50">
                <TerminalPane isActive={isRunning} theme="light" />
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');

        .font-mono {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }

        .connection-flow {
          stroke-dasharray: 6 10;
          animation: flowDash 0.8s linear infinite;
        }

        @keyframes flowDash {
          to { stroke-dashoffset: -16; }
        }

        .pulse-icon {
          animation: iconPulse 2s ease-in-out infinite;
        }

        @keyframes iconPulse {
          0%, 100% { opacity: 0.9; r: 10; }
          50% { opacity: 1; r: 12; }
        }

        .glow-active {
          animation: glowPulse 2s ease-in-out infinite;
        }

        .glow-subtle {
          animation: subtlePulse 3s ease-in-out infinite;
        }

        @keyframes glowPulse {
          0%, 100% {
            box-shadow: 0 0 20px rgba(34, 197, 94, 0.3), 0 0 40px rgba(34, 197, 94, 0.1);
          }
          50% {
            box-shadow: 0 0 30px rgba(34, 197, 94, 0.5), 0 0 60px rgba(34, 197, 94, 0.2);
          }
        }

        @keyframes subtlePulse {
          0%, 100% { box-shadow: 0 0 10px rgba(34, 197, 94, 0.15); }
          50% { box-shadow: 0 0 20px rgba(34, 197, 94, 0.25); }
        }

        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { border-radius: 3px; background: rgba(0,0,0,0.1); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
      `}</style>
    </div>
  );
}