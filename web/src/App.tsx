import { useEffect, useRef, useState } from 'react';
import { Board, type Item } from './board';
const raw = new URLSearchParams(location.hash.slice(1)).get('room');
const room = raw && /^[\w-]{1,64}$/.test(raw) ? raw : crypto.randomUUID().slice(0, 8);
if (!raw) history.replaceState(null, '', '#room=' + room);
type Tool = 'select' | 'note' | 'box' | 'ellipse' | 'link' | 'pan';
export default function App() {
  const [board] = useState(() => new Board(room)),
    [items, setItems] = useState<Item[]>([]),
    [status, setStatus] = useState('Opening local board'),
    [peers, setPeers] = useState(1),
    [tool, setTool] = useState<Tool>('select'),
    [selected, setSelected] = useState(''),
    [notice, setNotice] = useState('Double-click a note to edit.'),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null),
    [cursors, setCursors] = useState<Record<string, { x: number; y: number; at: number }>>({});
  const svg = useRef<SVGSVGElement>(null),
    file = useRef<HTMLInputElement>(null),
    textInput = useRef<HTMLTextAreaElement>(null),
    drag = useRef<{ id: string; x: number; y: number; ox: number; oy: number } | null>(null),
    lastCursor = useRef(0),
    focusAfterUpdate = useRef(''),
    linkStart = useRef('');
  useEffect(() => {
    if (!focusAfterUpdate.current) return;
    const shape = svg.current?.querySelector<SVGElement>(
      '[data-board-id="' + focusAfterUpdate.current + '"]',
    );
    if (shape) {
      shape.focus();
      focusAfterUpdate.current = '';
    }
  }, [items]);
  useEffect(() => {
    const update = () => setItems(board.snapshot());
    board.items.observeDeep(update);
    board.onStatus = (value, count) => {
      setStatus(value);
      if (count !== undefined) setPeers(count);
    };
    board.onCursor = (id, x, y) =>
      setCursors((current) => ({ ...current, [id]: { x, y, at: Date.now() } }));
    void board.start();
    update();
    const timer = setInterval(
      () =>
        setCursors((current) =>
          Object.fromEntries(Object.entries(current).filter(([, v]) => Date.now() - v.at < 4000)),
        ),
      2000,
    );
    return () => {
      clearInterval(timer);
      board.items.unobserveDeep(update);
      board.stop();
    };
  }, [board]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,textarea,select')) return;
      const focusedItem = (e.target as Element)
        .closest('[data-board-id]')
        ?.getAttribute('data-board-id');
      if (focusedItem) {
        const item = board.snapshot().find((i) => i.id === focusedItem);
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        if (item && directions[e.key]) {
          e.preventDefault();
          const [dx, dy] = directions[e.key],
            distance = e.shiftKey ? 10 : 1;
          board.patch(item.id, {
            x: Math.max(-10000, Math.min(10000, item.x + dx * distance)),
            y: Math.max(-10000, Math.min(10000, item.y + dy * distance)),
          });
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          textInput.current?.focus();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          duplicate(focusedItem);
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? board.undo.redo() : board.undo.undo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        board.remove(selected);
        setSelected('');
      }
      if (e.key === 'Escape') {
        setSelected('');
        linkStart.current = '';
        setTool('select');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [board, selected]);
  function duplicate(id: string) {
    const snapshot = board.snapshot(),
      item = snapshot.find((i) => i.id === id);
    if (!item || item.kind === 'link') return;
    if (snapshot.length >= 500) {
      setNotice('This board is limited to 500 items.');
      return;
    }
    const copy = {
      ...item,
      id: crypto.randomUUID(),
      x: Math.min(10000, item.x + 24),
      y: Math.min(10000, item.y + 24),
    };
    board.undo.stopCapturing();
    focusAfterUpdate.current = copy.id;
    board.add(copy);
    board.undo.stopCapturing();
    setSelected(copy.id);
    setNotice('Duplicated. Arrow keys move a focused shape; Shift moves 10 units.');
  }
  const point = (e: { clientX: number; clientY: number }) => {
    const matrix = svg.current?.getScreenCTM();
    const p = matrix
      ? new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
      : new DOMPoint();
    return { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
  };
  function add(kind: Item['kind'], x = 560, y = 300) {
    if (items.length >= 500) {
      setNotice('This board is limited to 500 items.');
      return;
    }
    const id = crypto.randomUUID();
    board.add({
      id,
      kind,
      x,
      y,
      w: kind === 'note' ? 210 : 180,
      h: kind === 'note' ? 150 : 110,
      text: kind === 'note' ? 'A new idea' : '',
    });
    setSelected(id);
    setTool('select');
  }
  function sample() {
    if (items.length) {
      setNotice('Open a new board for the example.');
      return;
    }
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      c = crypto.randomUUID();
    board.doc.transact(() => {
      board.add({
        id: a,
        kind: 'note',
        x: 250,
        y: 180,
        w: 230,
        h: 170,
        text: 'Start with a question.\nWhat would make this useful?',
      });
      board.add({
        id: b,
        kind: 'note',
        x: 630,
        y: 180,
        w: 230,
        h: 170,
        text: 'Try something small.\nBuild → test → learn.',
      });
      board.add({
        id: c,
        kind: 'box',
        x: 630,
        y: 510,
        w: 230,
        h: 100,
        text: 'Share what you learn.',
      });
      board.add({ id: crypto.randomUUID(), kind: 'link', a, b, x: 0, y: 0, w: 0, h: 0, text: '' });
      board.add({
        id: crypto.randomUUID(),
        kind: 'link',
        a: b,
        b: c,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        text: '',
      });
    }, 'ui');
  }
  const picked = items.find((item) => item.id === selected);
  const position = (item: Item) =>
    dragPreview?.id === item.id ? { ...item, ...dragPreview } : item;
  const exportBoard = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, items }, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'common-board.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function importBoard(f: File) {
    try {
      if (f.size > 2_000_000) throw Error('File exceeds 2 MB');
      const data = JSON.parse(await f.text());
      if (
        data.version !== 1 ||
        !Array.isArray(data.items) ||
        data.items.length + items.length > 500
      )
        throw Error('Invalid board or too many items');
      const ids = new Map<string, string>();
      for (const item of data.items) {
        if (
          typeof item.id !== 'string' ||
          ids.has(item.id) ||
          !['note', 'box', 'ellipse', 'link'].includes(item.kind) ||
          typeof item.text !== 'string' ||
          item.text.length > 2000 ||
          ![item.x, item.y, item.w, item.h].every(Number.isFinite) ||
          Math.abs(item.x) > 10000 ||
          Math.abs(item.y) > 10000 ||
          item.w < 0 ||
          item.w > 800 ||
          item.h < 0 ||
          item.h > 600
        )
          throw Error('Invalid board item');
        ids.set(item.id, crypto.randomUUID());
      }
      for (const item of data.items)
        if (item.kind === 'link' && (!ids.has(item.a) || !ids.has(item.b)))
          throw Error('Invalid connector');
      board.doc.transact(() => {
        for (const item of data.items)
          board.add({
            ...item,
            id: ids.get(item.id),
            ...(item.kind === 'link' ? { a: ids.get(item.a), b: ids.get(item.b) } : {}),
          });
      }, 'ui');
      setNotice('Board imported.');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  return (
    <div className="board-app">
      <header>
        <a className="brand" href="/">
          ▧ common
        </a>
        <div className="room-label">
          Board <span>{room}</span>
        </div>
        <div className="actions">
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(location.href)
                .then(() => setNotice('Board link copied. Open it in another tab to collaborate.'))
                .catch(() => setNotice(location.href));
            }}
          >
            Copy link
          </button>
          <details className="menu">
            <summary aria-label="Board options">•••</summary>
            <div>
              <button
                onClick={() =>
                  window.open(
                    location.pathname + '#room=' + crypto.randomUUID().slice(0, 8),
                    '_blank',
                    'noopener',
                  )
                }
              >
                New board
              </button>
              <button onClick={sample}>Load example</button>
              <button onClick={exportBoard}>Export JSON</button>
              <button onClick={() => file.current?.click()}>Import JSON</button>
              <a href="https://github.com/A-Mardi/shared-canvas" target="_blank" rel="noreferrer">
                View source ↗
              </a>
            </div>
          </details>
        </div>
      </header>
      <input
        ref={file}
        hidden
        type="file"
        accept=".json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importBoard(f);
          e.target.value = '';
        }}
      />
      <main className="board-stage">
        <svg
          ref={svg}
          viewBox="0 0 1400 800"
          aria-label="Shared board"
          onWheel={(e) => {
            const z = Math.max(0.3, Math.min(2.5, zoom * (e.deltaY > 0 ? 0.9 : 1.1))),
              p = point(e);
            setPan({ x: pan.x + p.x * (zoom - z), y: pan.y + p.y * (zoom - z) });
            setZoom(z);
          }}
          onPointerDown={(e) => {
            if (
              tool !== 'pan' &&
              e.target !== svg.current &&
              !(e.target as Element).classList.contains('board-background')
            )
              return;
            const p = point(e);
            setSelected('');
            if (tool === 'note' || tool === 'box' || tool === 'ellipse') add(tool, p.x, p.y);
            else {
              drag.current = { id: 'pan', x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y };
              svg.current?.setPointerCapture(e.pointerId);
            }
          }}
          onPointerMove={(e) => {
            const p = point(e),
              d = drag.current;
            if (d) {
              if (d.id === 'pan') {
                const m = svg.current?.getScreenCTM();
                setPan({
                  x: d.ox + (e.clientX - d.x) / (m?.a || 1),
                  y: d.oy + (e.clientY - d.y) / (m?.d || 1),
                });
              } else
                setDragPreview({
                  id: d.id,
                  x: Math.max(-10000, Math.min(10000, d.ox + p.x - d.x)),
                  y: Math.max(-10000, Math.min(10000, d.oy + p.y - d.y)),
                });
            }
            if (Date.now() - lastCursor.current > 80 && board.ws?.readyState === WebSocket.OPEN) {
              board.ws.send(JSON.stringify(p));
              lastCursor.current = Date.now();
            }
          }}
          onPointerUp={(e) => {
            if (dragPreview) {
              board.patch(dragPreview.id, { x: dragPreview.x, y: dragPreview.y });
              setDragPreview(null);
            }
            drag.current = null;
            if (svg.current?.hasPointerCapture(e.pointerId))
              svg.current.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragPreview(null);
          }}
        >
          <rect className="board-background" width="1400" height="800" fill="transparent" />
          <g transform={'translate(' + pan.x + ' ' + pan.y + ') scale(' + zoom + ')'}>
            {items
              .filter((i) => i.kind === 'link')
              .map((item) => {
                const a = items.find((i) => i.id === item.a),
                  b = items.find((i) => i.id === item.b);
                if (!a || !b) return null;
                const p = position(a),
                  q = position(b);
                return (
                  <g
                    key={item.id}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelected(item.id);
                    }}
                  >
                    <line
                      x1={p.x + p.w / 2}
                      y1={p.y + p.h / 2}
                      x2={q.x + q.w / 2}
                      y2={q.y + q.h / 2}
                      stroke="#263c32"
                      strokeWidth={selected === item.id ? 3 : 1.5}
                    />
                    <line
                      x1={p.x + p.w / 2}
                      y1={p.y + p.h / 2}
                      x2={q.x + q.w / 2}
                      y2={q.y + q.h / 2}
                      stroke="transparent"
                      strokeWidth="16"
                    />
                  </g>
                );
              })}
            {items
              .filter((i) => i.kind !== 'link')
              .map((original) => {
                const item = position(original);
                return (
                  <g
                    key={item.id}
                    data-testid="board-item"
                    data-board-id={item.id}
                    tabIndex={0}
                    role="button"
                    aria-label={item.kind + ': ' + (item.text.slice(0, 80) || 'Untitled')}
                    aria-pressed={selected === item.id}
                    onFocus={() => setSelected(item.id)}
                    transform={'translate(' + item.x + ' ' + item.y + ')'}
                    className="board-item"
                    onDoubleClick={() => textInput.current?.focus()}
                    onPointerDown={(e) => {
                      if (tool === 'pan') return;
                      e.stopPropagation();
                      if (tool === 'link') {
                        if (linkStart.current && linkStart.current !== item.id) {
                          board.add({
                            id: crypto.randomUUID(),
                            kind: 'link',
                            a: linkStart.current,
                            b: item.id,
                            x: 0,
                            y: 0,
                            w: 0,
                            h: 0,
                            text: '',
                          });
                          linkStart.current = '';
                          setTool('select');
                          setNotice('Connected.');
                        } else {
                          linkStart.current = item.id;
                          setNotice('Choose the second shape.');
                        }
                        return;
                      }
                      setSelected(item.id);
                      const p = point(e);
                      drag.current = { id: item.id, x: p.x, y: p.y, ox: item.x, oy: item.y };
                      svg.current?.setPointerCapture(e.pointerId);
                    }}
                  >
                    {item.kind === 'ellipse' ? (
                      <ellipse
                        cx={item.w / 2}
                        cy={item.h / 2}
                        rx={item.w / 2}
                        ry={item.h / 2}
                        fill="#f7f7f2"
                        stroke="#263c32"
                        strokeWidth={selected === item.id ? 2 : 1}
                      />
                    ) : (
                      <rect
                        width={item.w}
                        height={item.h}
                        rx="4"
                        fill={item.kind === 'note' ? '#9fbaa84d' : '#f7f7f2'}
                        stroke={selected === item.id ? '#263c32' : '#263c3226'}
                        strokeWidth={selected === item.id ? 2 : 1}
                      />
                    )}
                    <foreignObject
                      x="18"
                      y="15"
                      width={Math.max(20, item.w - 36)}
                      height={Math.max(20, item.h - 30)}
                      style={{ pointerEvents: 'none' }}
                    >
                      <p className="note-text">{item.text}</p>
                    </foreignObject>
                  </g>
                );
              })}
            {Object.entries(cursors).map(([id, c]) => (
              <g key={id} transform={'translate(' + c.x + ' ' + c.y + ')'} pointerEvents="none">
                <path d="m0 0 10 6-5 1-2 5z" fill="#263c32" />
                <text x="12" y="12" fontSize="11" fill="#263c32">
                  Guest {id.slice(0, 3)}
                </text>
              </g>
            ))}
          </g>
        </svg>
        {!items.length && (
          <div className="board-empty">
            <h1>Room for an idea.</h1>
            <p>Add a note, or start with a small example.</p>
            <button className="primary" onClick={() => add('note')}>
              Add note
            </button>
            <button onClick={sample}>Try example</button>
          </div>
        )}
        {picked && (
          <aside className="item-editor" aria-label="Selected item">
            <div className="inline">
              <span className="small muted">
                {picked.kind === 'link' ? 'Connector' : 'Selected ' + picked.kind}
              </span>
              <button className="icon" aria-label="Close inspector" onClick={() => setSelected('')}>
                ×
              </button>
            </div>
            {picked.kind !== 'link' && (
              <>
                <textarea
                  ref={textInput}
                  aria-label="Note text"
                  value={picked.text}
                  maxLength={2000}
                  onChange={(e) => board.text(picked.id, e.target.value)}
                />
                <div className="dimensions">
                  <label>
                    Width
                    <input
                      aria-label="Shape width"
                      type="number"
                      min="80"
                      max="800"
                      value={picked.w}
                      onChange={(e) =>
                        board.patch(picked.id, { w: Math.max(80, Math.min(800, +e.target.value)) })
                      }
                    />
                  </label>
                  <label>
                    Height
                    <input
                      aria-label="Shape height"
                      type="number"
                      min="60"
                      max="600"
                      value={picked.h}
                      onChange={(e) =>
                        board.patch(picked.id, { h: Math.max(60, Math.min(600, +e.target.value)) })
                      }
                    />
                  </label>
                </div>
              </>
            )}
            {picked.kind !== 'link' && (
              <button onClick={() => duplicate(picked.id)}>Duplicate</button>
            )}
            <button
              onClick={() => {
                board.remove(selected);
                setSelected('');
              }}
            >
              Delete
            </button>
          </aside>
        )}
      </main>
      <nav className="board-toolbar" aria-label="Board tools">
        {(['select', 'note', 'box', 'ellipse', 'link', 'pan'] as Tool[]).map((t) => (
          <button
            key={t}
            aria-pressed={tool === t}
            onClick={() => {
              setTool(t);
              linkStart.current = '';
            }}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <span />
        <button aria-label="Undo" onClick={() => board.undo.undo()}>
          ↶
        </button>
        <button aria-label="Redo" onClick={() => board.undo.redo()}>
          ↷
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => {
            const z = Math.max(0.3, zoom / 1.3);
            setPan({ x: 700 - ((700 - pan.x) * z) / zoom, y: 400 - ((400 - pan.y) * z) / zoom });
            setZoom(z);
          }}
        >
          −
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => {
            const z = Math.min(4, zoom * 1.3);
            setPan({ x: 700 - ((700 - pan.x) * z) / zoom, y: 400 - ((400 - pan.y) * z) / zoom });
            setZoom(z);
          }}
        >
          +
        </button>
        <button
          title="Reset view"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
      </nav>
      <footer>
        <span role="status">{notice}</span>
        <span>
          {status} · {peers} {peers === 1 ? 'person' : 'people'} · {items.length} items
        </span>
      </footer>
    </div>
  );
}
