# Common roadmap

## Shipped in the local beta

- Notes, boxes, ellipses, connectors, dragging, pan, zoom, and local undo/redo.
- Concurrent note editing with Yjs text CRDTs; IndexedDB stores the local document.
- Room links, remote cursors, reconnect synchronization, and JSON import/export.
- Go WebSocket relay with a checksummed append log and sync-before-broadcast persistence.

## Next, not implemented

- State-vector synchronization and compact snapshots.
- Room ownership, access controls, and eviction.
- Keyboard navigation of shapes and richer touch gestures.

The README and tests describe current behavior. Roadmap items are not resume claims or capacity guarantees.
