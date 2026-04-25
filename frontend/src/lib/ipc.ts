// frontend/src/lib/ipc.ts
//
// WebSocket bridge to the Bun backend.
//
//   - invoke(channel, payload) -> Promise<result>  (request/response; server echoes msg.id)
//   - subscribe(topic, handler) -> unsubscribe      (push stream, e.g. agent-event, pty-output)
//   - send(type, payload)                           (fire-and-forget, e.g. agent-subscribe)

type Listener = (payload: any) => void;

let ws: WebSocket | null = null;
let messageId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
const listeners = new Map<string, Set<Listener>>();
const outgoingQueue: string[] = [];

function handleMessage(raw: string) {
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return; }

  // Response to an invoke()
  if (typeof msg.id === 'number' && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.payload);
    return;
  }

  // Push / broadcast message
  if (msg.type) {
    const set = listeners.get(msg.type);
    if (set) set.forEach((h) => h(msg.payload));
  }
}

function getWs(): WebSocket {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return ws;
  }

  ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    while (outgoingQueue.length > 0) {
      const msg = outgoingQueue.shift();
      if (msg) ws!.send(msg);
    }
  };

  ws.onmessage = (event) => handleMessage(event.data);

  const failAllPending = (err: Error) => {
    for (const [, { reject }] of pending) reject(err);
    pending.clear();
  };

  ws.onerror = () => {
    failAllPending(new Error('WebSocket error'));
  };

  ws.onclose = () => {
    failAllPending(new Error('WebSocket closed'));
    ws = null;
  };

  return ws;
}

function rawSend(msg: string) {
  const socket = getWs();
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(msg);
  } else {
    outgoingQueue.push(msg);
  }
}

export function invoke<T = any>(channel: string, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    rawSend(JSON.stringify({ type: channel, id, payload }));
  });
}

export function send(type: string, payload?: any): void {
  rawSend(JSON.stringify({ type, payload }));
}

export function subscribe(topic: string, handler: Listener): () => void {
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  set.add(handler);
  // Ensure the socket is live so messages can arrive.
  getWs();
  return () => {
    const s = listeners.get(topic);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) listeners.delete(topic);
  };
}
