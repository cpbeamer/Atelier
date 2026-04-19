import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export function TerminalPane({ isActive }: { isActive: boolean }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#ffffff',
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Setup WebSocket
    const socket = new WebSocket('ws://localhost:3000');
    socketRef.current = socket;

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        term.write(msg.payload);
      } else if (msg.type === 'exit') {
        setIsRunning(false);
        term.writeln('\r\n[Process Exited]');
      }
    };

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', payload: data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', payload: { cols, rows } }));
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.close();
      term.dispose();
    };
  }, []);

  // Trigger agent start when requested
  useEffect(() => {
    if (isActive && !isRunning && socketRef.current?.readyState === WebSocket.OPEN) {
      setIsRunning(true);
      xtermRef.current?.clear();
      xtermRef.current?.writeln('[Starting Claude Code...]\r\n');
      
      socketRef.current.send(JSON.stringify({
        type: 'spawn',
        payload: {
          command: 'cmd.exe',
          args: ['/c', 'npx @anthropic-ai/claude-code --dangerously-skip-permissions']
        }
      }));
    }
  }, [isActive, isRunning]);

  return (
    <div className="w-full h-full p-2 bg-[#0a0a0a] rounded-lg border border-border overflow-hidden">
      <div ref={terminalRef} className="w-full h-full" />
    </div>
  );
}
