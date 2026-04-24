// frontend/src/components/RawTerminalView.tsx
//
// xterm.js terminal wired to the backend `pty-subscribe` / `pty-output` /
// `pty-write` / `pty-resize` stream. Used as the raw fallback view for
// agents whose output isn't structured JSON.

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
      lineHeight: 1.35,
      theme: {
        background: '#0a0b0d',
        foreground: '#d4d2cc',
        cursor: '#d4ff00',
        cursorAccent: '#0a0b0d',
        selectionBackground: '#1e2024',
        black: '#0a0b0d',
        red: '#ff6b5a',
        green: '#d4ff00',
        yellow: '#ffb84a',
        blue: '#63d4ff',
        magenta: '#c89cff',
        cyan: '#63d4ff',
        white: '#d4d2cc',
        brightBlack: '#4a4d52',
        brightRed: '#ff9b8f',
        brightGreen: '#e8ff6b',
        brightYellow: '#ffd28a',
        brightBlue: '#a8e6ff',
        brightMagenta: '#e0c8ff',
        brightCyan: '#a8e6ff',
        brightWhite: '#e8e6e0',
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
      if (payload.id === ptyId) term.writeln(`\r\n\x1b[38;2;138;141;146m— exit · code ${payload.exitCode}\x1b[0m`);
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
    <div className="h-full w-full bg-[#0a0b0d] px-2 py-2">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
