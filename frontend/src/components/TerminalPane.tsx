// frontend/src/components/TerminalPane.tsx
import { useEffect, useRef, useState } from 'react';

interface TerminalLine {
  id: number;
  content: string;
  type: 'input' | 'output' | 'system';
}

interface Props {
  isActive: boolean;
  theme?: 'dark' | 'light';
}

// Fake terminal for demo - shows formatted output instead of real PTY
export function TerminalPane({ isActive, theme = 'light' }: Props) {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: 0, content: 'Initializing agent session...', type: 'system' },
    { id: 1, content: '[Agent ready]', type: 'system' },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && lines.length <= 2) {
      const timer = setTimeout(() => {
        setLines(prev => [...prev,
          { id: Date.now(), content: '> Analyzing project structure...', type: 'output' },
        ]);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const isDark = theme === 'dark';

  return (
    <div
      className={`w-full h-full font-mono text-sm overflow-hidden rounded-b-xl ${
        isDark ? 'bg-black' : 'bg-slate-100'
      }`}
    >
      <div
        ref={scrollRef}
        className={`h-full overflow-y-auto p-4 ${isDark ? 'text-green-400' : 'text-slate-800'}`}
      >
        {lines.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap break-all leading-relaxed ${
              line.type === 'system'
                ? isDark ? 'text-zinc-500 italic' : 'text-slate-400 italic'
                : line.type === 'input'
                ? isDark ? 'text-emerald-400' : 'text-emerald-700'
                : ''
            }`}
          >
            {line.content}
          </div>
        ))}
        {/* Blinking cursor */}
        <span className={`inline-block w-2 h-4 ${isDark ? 'bg-green-400' : 'bg-slate-700'} animate-pulse`} />
      </div>

      <style>{`
        .font-mono {
          font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
        }
      `}</style>
    </div>
  );
}