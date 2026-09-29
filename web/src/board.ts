import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
export type Item = {
  id: string;
  kind: 'note' | 'box' | 'ellipse' | 'link';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  a?: string;
  b?: string;
};
export class Board {
  readonly doc = new Y.Doc();
  readonly items = this.doc.getMap<Y.Map<unknown>>('items');
  readonly undo = new Y.UndoManager(this.items, {
    trackedOrigins: new Set(['ui']),
    captureTimeout: 300,
  });
  readonly storage: IndexeddbPersistence;
  ws: WebSocket | null = null;
  stopped = false;
  timer = 0;
  retry = 500;
  onStatus = (status: string, peers?: number) => {
    void status;
    void peers;
  };
  onCursor = (id: string, x: number, y: number) => {
    void id;
    void x;
    void y;
  };
  client = '';
  constructor(readonly room: string) {
    this.storage = new IndexeddbPersistence('common-' + room, this.doc);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote' && this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(new Uint8Array(update));
    });
  }
  async start() {
    try {
      await this.storage.whenSynced;
      if (!this.stopped) this.connect();
    } catch {
      this.onStatus('Local storage unavailable');
    }
  }
  connect() {
    if (this.stopped) return;
    this.onStatus('Connecting');
    const ws = new WebSocket(
      (location.protocol === 'https:' ? 'wss:' : 'ws:') +
        '//' +
        location.host +
        '/ws?room=' +
        encodeURIComponent(this.room),
    );
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.retry = 500;
      ws.send(new Uint8Array(Y.encodeStateAsUpdate(this.doc)));
    };
    ws.onmessage = (event) => {
      try {
        if (event.data instanceof ArrayBuffer)
          Y.applyUpdate(this.doc, new Uint8Array(event.data), 'remote');
        else {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ready') {
            this.client = msg.id;
            this.onStatus('Connected');
          }
          if (msg.type === 'presence') this.onStatus('Connected', msg.peers);
          if (msg.type === 'cursor' && msg.id !== this.client) this.onCursor(msg.id, msg.x, msg.y);
        }
      } catch {
        this.onStatus('Could not read a board update');
      }
    };
    ws.onclose = (event) => {
      if (this.stopped) return;
      this.onStatus(
        event.code === 1008 ? 'Board storage limit reached' : 'Offline · edits saved here',
        1,
      );
      if (event.code !== 1008) {
        this.timer = window.setTimeout(() => this.connect(), this.retry);
        this.retry = Math.min(10000, this.retry * 2);
      }
    };
    ws.onerror = () => ws.close();
  }
  snapshot(): Item[] {
    return [...this.items.entries()].map(([id, item]) => ({ ...item.toJSON(), id }) as Item);
  }
  add(item: Item) {
    this.doc.transact(() => {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(item)) {
        if (key === 'text') {
          const text = new Y.Text();
          text.insert(0, String(value));
          map.set('text', text);
        } else if (key !== 'id') map.set(key, value);
      }
      this.items.set(item.id, map);
    }, 'ui');
  }
  patch(id: string, fields: Partial<Item>) {
    const item = this.items.get(id);
    if (!item) return;
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(fields)) item.set(key, value);
    }, 'ui');
  }
  text(id: string, value: string) {
    const item = this.items.get(id),
      text = item?.get('text');
    if (!(text instanceof Y.Text)) return;
    const old = text.toString();
    let start = 0;
    while (start < old.length && start < value.length && old[start] === value[start]) start++;
    let end = 0;
    while (
      end < old.length - start &&
      end < value.length - start &&
      old[old.length - end - 1] === value[value.length - end - 1]
    )
      end++;
    this.doc.transact(() => {
      text.delete(start, old.length - start - end);
      text.insert(start, value.slice(start, value.length - end));
    }, 'ui');
  }
  remove(id: string) {
    this.doc.transact(() => this.items.delete(id), 'ui');
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.storage.destroy();
    this.doc.destroy();
  }
}
