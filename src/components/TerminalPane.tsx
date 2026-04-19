import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, Event } from '@tauri-apps/api/event';
import 'xterm/css/xterm.css';

export function TerminalPane({ isActive }: { isActive: boolean }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
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

    term.onData((data) => {
      invoke('write_pty', { data }).catch(console.error);
    });

    term.onResize(({ cols, rows }) => {
      invoke('resize_pty', { cols, rows }).catch(console.error);
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const unlistenData = listen<number[]>('pty-data', (event) => {
      if (xtermRef.current) {
        // Convert the number array (bytes) to Uint8Array to string
        const text = new TextDecoder().decode(new Uint8Array(event.payload));
        xtermRef.current.write(text);
      }
    });

    const unlistenExit = listen('pty-exit', () => {
      setIsRunning(false);
      if (xtermRef.current) {
        xtermRef.current.writeln('\r\n[Process Exited]');
      }
    });

    return () => {
      unlistenData.then((f) => f());
      unlistenExit.then((f) => f());
    };
  }, []);

  // Trigger agent start when requested
  useEffect(() => {
    if (isActive && !isRunning) {
      setIsRunning(true);
      xtermRef.current?.clear();
      xtermRef.current?.writeln('[Starting Claude Code...]\r\n');
      
      // Fallback: Use native npx cmd if WSL is not preferred or available
      invoke('spawn_pty', { 
        command: 'cmd.exe',
        args: ['/c', 'npx @anthropic-ai/claude-code --dangerously-skip-permissions']
      }).catch((err) => {
        console.error(err);
        xtermRef.current?.writeln(`\r\n[Failed to start: ${err}]`);
        setIsRunning(false);
      });
    }
  }, [isActive, isRunning]);

  return (
    <div className="w-full h-full p-2 bg-[#0a0a0a] rounded-lg border border-border overflow-hidden">
      <div ref={terminalRef} className="w-full h-full" />
    </div>
  );
}
