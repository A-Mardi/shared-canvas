# Common architecture

## Document model

Each room has a Y.Doc containing an item map. Each item is a nested Y.Map; note content is a Y.Text. Text input changes are translated into minimal insert/delete operations. Concurrent text edits merge; concurrent changes to the same scalar property use Yjs conflict resolution. Undo tracks this client's UI transactions, rather than undoing remote collaborators' work. Drag previews stay local until release.

## Storage and transport

IndexedDB restores the local document before opening the socket. The client sends its state on connection and streams local updates thereafter. The server first replays its history, then forwards live updates. Yjs deduplicates repeated operations. Cursor messages and presence counts are ephemeral.

Each persisted record has a length, CRC32 checksum, and update payload. The server writes and syncs the record before broadcasting. Startup truncates an incomplete trailing record; a checksum mismatch fails the room open instead of silently ignoring corruption. CRC32 is for accidental damage, not authentication. Slow peers have bounded queues and are disconnected when they fall behind.

## Tradeoffs

The relay does not interpret CRDT state. This keeps the Go boundary small but means malicious updates cannot be validated as board operations, and histories grow on reconnect. Authentication, state-vector synchronization, compaction, disk quotas across restarts, and room lifecycle management are prerequisites for a public service. Export JSON before reaching the room log limit.
