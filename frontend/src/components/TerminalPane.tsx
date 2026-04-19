// frontend/src/components/TerminalPane.tsx
import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

interface Props {
  paneId: string;
  isActive: boolean;
}

export function TerminalPane({ paneId, isActive }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new Terminal({
      theme: { background: '#0a0a0a', foreground: '#ffffff' },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect to WebSocket for PTY output
    const ws = new WebSocket('ws://localhost:3000');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'pty-subscribe', payload: { id: paneId } }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'pty-output' && msg.id === paneId) {
        term.write(msg.data);
      } else if (msg.type === 'pty-exit' && msg.id === paneId) {
        term.writeln('\r\n[Process Exited]');
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pty-input', payload: { id: paneId, data } }));
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
      xtermRef.current = null;
    };
  }, [paneId]);

  // Trigger agent start when pane becomes active
  useEffect(() => {
    if (isActive && xtermRef.current) {
      xtermRef.current.clear();
      xtermRef.current.writeln('[Starting Claude Code...]\r\n');
      // PTY spawning is handled via IPC in a later task
    }
  }, [isActive, paneId]);

  return (
    <div ref={terminalRef} className="w-full h-full" />
  );
}