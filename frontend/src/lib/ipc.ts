// frontend/src/lib/ipc.ts

let ws: WebSocket | null = null;
let messageId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function getWs(): WebSocket {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    ws = new WebSocket('ws://localhost:3000');
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.payload);
      }
    };
  }
  return ws;
}

export function invoke<T = any>(channel: string, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    const socket = getWs();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: channel, id, payload }));
    } else {
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: channel, id, payload }));
      };
    }
  });
}