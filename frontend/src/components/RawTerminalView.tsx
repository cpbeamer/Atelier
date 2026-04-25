// frontend/src/components/RawTerminalView.tsx
//
// xterm.js terminal wired to the backend pty stream.

import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { subscribe, send } from '../lib/ipc';

interface Props {
  ptyId: string;
}

export function RawTerminalView({ ptyId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 12,
      letterSpacing: 0,
      lineHeight: 1.5,
      theme: {
        background: '#141416',
        foreground: '#ededea',
        cursor: '#ff6b35',
        cursorAccent: '#141416',
        selectionBackground: '#27272a',
        black: '#141416',
        red: '#e87b6f',
        green: '#a8c8a0',
        yellow: '#e6b069',
        blue: '#7d92a3',
        magenta: '#b59ac2',
        cyan: '#8aa9a8',
        white: '#ededea',
        brightBlack: '#52524f',
        brightRed: '#f0928a',
        brightGreen: '#bfd6b8',
        brightYellow: '#f0c896',
        brightBlue: '#9aacba',
        brightMagenta: '#c9b3d4',
        brightCyan: '#a3bfbe',
        brightWhite: '#ffffff',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const unsubData = subscribe('pty-output', (payload: { id: string; data: string }) => {
      if (payload.id === ptyId) term.write(payload.data);
    });
    const unsubExit = subscribe('pty-exit', (payload: { id: string; exitCode: number }) => {
      if (payload.id === ptyId) term.writeln(`\r\n\x1b[38;2;113;113;111m— exit · code ${payload.exitCode}\x1b[0m`);
    });
    send('pty-subscribe', { id: ptyId });

    term.onData((data) => send('pty-write', { id: ptyId, data }));

    const resizeObs = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
      send('pty-resize', { id: ptyId, cols: term.cols, rows: term.rows });
    });
    resizeObs.observe(hostRef.current);

    return () => {
      resizeObs.disconnect();
      unsubData();
      unsubExit();
      term.dispose();
    };
  }, [ptyId]);

  return (
    <div className="h-full w-full px-3 py-3">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
