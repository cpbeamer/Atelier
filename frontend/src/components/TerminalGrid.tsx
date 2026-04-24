// frontend/src/components/TerminalGrid.tsx
//
// Renders a grid of agent panes plus an SVG layer that draws signal / noise /
// parent-child connectors between them. Control-room aesthetic: ink base,
// chartreuse live accents, amber/cyan signal accents, rack-panel chrome.

import { useEffect, useRef, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import { X, Plus, Zap, GitBranch } from 'lucide-react';

export interface TerminalPaneConfig {
  id: string;
  agentName: string;
  agentType: 'terminal' | 'direct-llm';
  status: 'running' | 'exited' | 'killed' | 'waiting';
  /** Optional PTY id if this agent also exposes a raw terminal. */
  ptyId?: string;
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
}

const COLOR = {
  live: '#d4ff00',
  tool: '#ffb84a',
  system: '#63d4ff',
  signal: '#c89cff',
  error: '#ff6b5a',
  hair: '#1e2024',
  hairBright: '#2a2d32',
  textMuted: '#8a8d92',
  textFaint: '#6b6b68',
  textHint: '#4a4d52',
};

export function TerminalGrid({ panes, connections = [], onPaneClose, onPaneAdd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panePositions, setPanePositions] = useState<Map<string, PanePosition>>(new Map());

  useEffect(() => {
    const updatePositions = () => {
      if (!containerRef.current) return;
      const newPositions = new Map<string, PanePosition>();
      containerRef.current.querySelectorAll<HTMLElement>('[data-pane-id]').forEach((el) => {
        const id = el.dataset.paneId!;
        const rect = el.getBoundingClientRect();
        const parent = containerRef.current!.getBoundingClientRect();
        newPositions.set(id, {
          id,
          x: rect.left - parent.left + containerRef.current!.scrollLeft,
          y: rect.top - parent.top + containerRef.current!.scrollTop,
          width: rect.width,
          height: rect.height,
        });
      });
      setPanePositions(newPositions);
    };

    updatePositions();
    const ro = new ResizeObserver(updatePositions);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updatePositions);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updatePositions);
    };
  }, [panes]);

  const getEdgePoints = (from: PanePosition, to: PanePosition) => {
    const fromCx = from.x + from.width / 2;
    const fromCy = from.y + from.height / 2;
    const toCx = to.x + to.width / 2;
    const toCy = to.y + to.height / 2;
    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    let startX: number, startY: number, endX: number, endY: number;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) { startX = from.x + from.width; endX = to.x; }
      else { startX = from.x; endX = to.x + to.width; }
      const overlapTop = Math.max(from.y, to.y);
      const overlapBottom = Math.min(from.y + from.height, to.y + to.height);
      if (overlapBottom > overlapTop) { startY = (overlapTop + overlapBottom) / 2; endY = startY; }
      else { startY = fromCy; endY = toCy; }
    } else {
      if (dy > 0) { startY = from.y + from.height; endY = to.y; }
      else { startY = from.y; endY = to.y + to.height; }
      const overlapLeft = Math.max(from.x, to.x);
      const overlapRight = Math.min(from.x + from.width, to.x + to.width);
      if (overlapRight > overlapLeft) { startX = (overlapLeft + overlapRight) / 2; endX = startX; }
      else { startX = fromCx; endX = toCx; }
    }
    return { startX, startY, endX, endY };
  };

  const getConnectionPath = (from: PanePosition, to: PanePosition) => {
    const { startX, startY, endX, endY } = getEdgePoints(from, to);
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const curvature = Math.min(distance * 0.18, 32);
    const perpX = (-dy / distance) * curvature;
    const perpY = (dx / distance) * curvature;
    const midX = (startX + endX) / 2 + perpX;
    const midY = (startY + endY) / 2 + perpY;
    return `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
  };

  const getMidpoint = (from: PanePosition, to: PanePosition) => {
    const { startX, startY, endX, endY } = getEdgePoints(from, to);
    return { x: (startX + endX) / 2, y: (startY + endY) / 2 };
  };

  const connColor = (type?: string) => {
    if (type === 'signal') return COLOR.signal;
    if (type === 'noise') return COLOR.tool;
    return COLOR.live;
  };

  const isConnectionActive = (fromId: string, toId: string) => {
    const f = panes.find((p) => p.id === fromId);
    const t = panes.find((p) => p.id === toId);
    return f?.status === 'running' && t?.status === 'running';
  };

  const totalRunning = panes.filter((p) => p.status === 'running').length;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-auto bg-[#0a0b0d]"
    >
      {/* Page chrome: crosshatch grid background + corner telemetry */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top telemetry bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-5 py-2 bg-[#0a0b0d]/85 backdrop-blur-sm border-b border-[#1e2024]">
        <div className="flex items-center gap-4 text-[10px] font-display uppercase tracking-[0.3em] text-[#6b6b68]">
          <span className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${totalRunning > 0 ? 'bg-[#d4ff00] live-dot' : 'bg-[#3a3d42]'}`} />
            <span className={totalRunning > 0 ? 'text-[#d4ff00]' : 'text-[#4a4d52]'}>
              {totalRunning > 0 ? `${totalRunning} LIVE` : 'IDLE'}
            </span>
          </span>
          <span className="text-[#4a4d52]">·</span>
          <span>{panes.length} panes</span>
          <span className="text-[#4a4d52]">·</span>
          <span>{connections.length} links</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onPaneAdd}
            className="group flex items-center gap-1.5 px-2.5 py-1 border border-[#1e2024] hover:border-[#d4ff00] bg-[#0d0f12] transition-colors"
            title="Add agent pane"
          >
            <Plus className="w-3 h-3 text-[#6b6b68] group-hover:text-[#d4ff00] transition-colors" />
            <span className="font-display uppercase tracking-[0.25em] text-[10px] text-[#6b6b68] group-hover:text-[#d4ff00] transition-colors">
              agent
            </span>
          </button>
        </div>
      </div>

      {/* Connection SVG layer */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 5, minWidth: '100%', minHeight: '100%' }}
      >
        <defs>
          <linearGradient id="conn-live" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(212, 255, 0, 0)" />
            <stop offset="50%" stopColor="rgba(212, 255, 0, 0.95)" />
            <stop offset="100%" stopColor="rgba(212, 255, 0, 0)" />
          </linearGradient>
          <linearGradient id="conn-signal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(200, 156, 255, 0)" />
            <stop offset="50%" stopColor="rgba(200, 156, 255, 0.95)" />
            <stop offset="100%" stopColor="rgba(200, 156, 255, 0)" />
          </linearGradient>
          <linearGradient id="conn-noise" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255, 184, 74, 0)" />
            <stop offset="50%" stopColor="rgba(255, 184, 74, 0.95)" />
            <stop offset="100%" stopColor="rgba(255, 184, 74, 0)" />
          </linearGradient>
          <filter id="conn-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {connections.map((conn, idx) => {
          const fromPos = panePositions.get(conn.from);
          const toPos = panePositions.get(conn.to);
          if (!fromPos || !toPos) return null;
          const path = getConnectionPath(fromPos, toPos);
          const mid = getMidpoint(fromPos, toPos);
          const active = isConnectionActive(conn.from, conn.to);
          const gradientId = conn.type === 'signal' ? 'conn-signal' : conn.type === 'noise' ? 'conn-noise' : 'conn-live';
          const color = connColor(conn.type);

          return (
            <g key={idx}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeOpacity={active ? 0.25 : 0.12}
                strokeWidth={active ? 1.5 : 1}
                strokeDasharray={active ? '0' : '3 4'}
              />
              {active && (
                <path
                  d={path}
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  filter="url(#conn-glow)"
                  className="connection-flow"
                />
              )}
              {active && (
                <g transform={`translate(${mid.x}, ${mid.y})`}>
                  <rect x="-14" y="-7" width="28" height="14" fill="#0a0b0d" stroke={color} strokeWidth="1" />
                  <g transform="translate(-4, -4)" style={{ color }}>
                    {conn.type === 'signal' || conn.type === 'noise' ? (
                      <Zap className="w-2 h-2" />
                    ) : (
                      <GitBranch className="w-2 h-2" />
                    )}
                  </g>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Pane grid */}
      <div
        className="relative p-6 grid gap-6"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          minHeight: 'calc(100% - 40px)',
          zIndex: 10,
        }}
      >
        {panes.map((pane, i) => <Pane key={pane.id} pane={pane} index={i} onClose={() => onPaneClose?.(pane.id)} />)}
      </div>

      <style>{`
        .connection-flow {
          stroke-dasharray: 4 8;
          animation: flowDash 0.9s linear infinite;
        }
        @keyframes flowDash { to { stroke-dashoffset: -12; } }
      `}</style>
    </div>
  );
}

function Pane({
  pane,
  index,
  onClose,
}: {
  pane: TerminalPaneConfig;
  index: number;
  onClose: () => void;
}) {
  const isRunning = pane.status === 'running';
  const isExited = pane.status === 'exited';
  const isKilled = pane.status === 'killed';
  const statusColor = isRunning ? '#d4ff00' : isKilled ? '#ff6b5a' : isExited ? '#8a8d92' : '#ffb84a';
  const statusLabel = pane.status.toUpperCase();

  // Slot number — aesthetic touch; shown as a rack-unit identifier.
  const slot = String(index + 1).padStart(2, '0');

  return (
    <div
      data-pane-id={pane.id}
      className={`rack flex flex-col h-[360px] overflow-hidden transition-all duration-300 ${isRunning ? 'rack-live' : ''}`}
    >
      {/* Rack header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[#1e2024] bg-[#0d0f12]">
        <span className="font-display uppercase tracking-[0.3em] text-[10px] text-[#4a4d52] shrink-0">
          {pane.agentType === 'direct-llm' ? 'LLM' : 'PTY'}·{slot}
        </span>
        <div className="h-3 w-[1px] bg-[#1e2024]" />
        <span className="font-display uppercase tracking-[0.15em] text-[12px] text-[#e8e6e0] truncate">
          {pane.agentName}
        </span>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'live-dot' : ''}`}
              style={{ background: statusColor }}
            />
            <span
              className="font-display uppercase tracking-[0.25em] text-[9px]"
              style={{ color: statusColor }}
            >
              {statusLabel}
            </span>
          </span>
          <button
            onClick={onClose}
            className="p-1 text-[#4a4d52] hover:text-[#ff6b5a] transition-colors"
            title="Close pane"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 relative">
        <TerminalPane agentId={pane.id} isActive={isRunning} ptyId={pane.ptyId} />
      </div>

      {/* Footer micro-telemetry */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-[#1e2024] bg-[#0d0f12] text-[9px] font-display uppercase tracking-[0.3em] text-[#4a4d52]">
        <span>node · {pane.id.slice(0, 12)}</span>
        <span className="flex items-center gap-2">
          <span
            className={`inline-block w-1 h-1 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
            style={{ background: statusColor }}
          />
          {isRunning ? 'streaming' : pane.status}
        </span>
      </div>
    </div>
  );
}
