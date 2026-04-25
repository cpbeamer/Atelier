// frontend/src/components/TerminalGrid.tsx
//
// Grid of agent panes with a quiet SVG layer for connections. The aesthetic
// is editorial-minimal: soft surfaces, single amber accent on active state,
// no rack chrome or telemetry bars.

import { useEffect, useRef, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import { X, Plus } from 'lucide-react';

export interface TerminalPaneConfig {
  id: string;
  agentName: string;
  agentType: 'terminal' | 'direct-llm';
  status: 'running' | 'exited' | 'killed' | 'waiting';
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

  const isConnectionActive = (fromId: string, toId: string) => {
    const f = panes.find((p) => p.id === fromId);
    const t = panes.find((p) => p.id === toId);
    return f?.status === 'running' && t?.status === 'running';
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-auto">
      {/* Connection layer — quiet hairlines, no glow, no animation */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 5, minWidth: '100%', minHeight: '100%' }}
      >
        {connections.map((conn, idx) => {
          const fromPos = panePositions.get(conn.from);
          const toPos = panePositions.get(conn.to);
          if (!fromPos || !toPos) return null;
          const path = getConnectionPath(fromPos, toPos);
          const active = isConnectionActive(conn.from, conn.to);
          return (
            <path
              key={idx}
              d={path}
              fill="none"
              stroke={active ? 'rgba(255, 107, 53, 0.45)' : 'rgba(255, 255, 255, 0.07)'}
              strokeWidth={active ? 1.25 : 1}
              strokeDasharray={active ? '0' : '3 5'}
            />
          );
        })}
      </svg>

      {/* Pane grid */}
      <div
        className="relative px-6 py-6 grid gap-5"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          minHeight: '100%',
          zIndex: 10,
        }}
      >
        {panes.map((pane) => <Pane key={pane.id} pane={pane} onClose={() => onPaneClose?.(pane.id)} />)}

        <button
          onClick={onPaneAdd}
          className="group min-h-[360px] rounded-lg border border-dashed border-[var(--color-hair-2)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent-soft)]/40 transition-colors flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
          title="Add agent pane"
        >
          <span className="flex items-center gap-2 text-[12.5px]">
            <Plus className="w-3.5 h-3.5" />
            New pane
          </span>
        </button>
      </div>
    </div>
  );
}

function Pane({
  pane,
  onClose,
}: {
  pane: TerminalPaneConfig;
  onClose: () => void;
}) {
  const isRunning = pane.status === 'running';
  const isExited = pane.status === 'exited';
  const isKilled = pane.status === 'killed';

  const dotColor = isRunning
    ? 'var(--color-accent)'
    : isKilled
    ? 'var(--color-error)'
    : isExited
    ? 'var(--color-text-muted)'
    : 'var(--color-text-faint)';

  const statusLabel = isRunning ? 'Live' : isKilled ? 'Killed' : isExited ? 'Done' : 'Waiting';

  return (
    <div
      data-pane-id={pane.id}
      className={`relative flex flex-col h-[360px] rounded-lg overflow-hidden bg-[var(--color-surface)] border transition-colors ${
        isRunning ? 'border-[var(--color-accent)]/30' : 'border-[var(--color-hair)]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--color-hair)]">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRunning ? 'live-dot' : ''}`}
          style={{ background: dotColor }}
        />
        <span className="text-[13px] text-[var(--color-text)] truncate">
          {pane.agentName}
        </span>
        <span className="text-[11px] text-[var(--color-text-faint)] shrink-0">
          {statusLabel}
        </span>

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            onClick={onClose}
            className="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
            title="Close pane"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 relative">
        <TerminalPane agentId={pane.id} isActive={isRunning} ptyId={pane.ptyId} />
      </div>
    </div>
  );
}
