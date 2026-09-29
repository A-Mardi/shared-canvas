package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"github.com/gorilla/websocket"
	"hash/crc32"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

const maxLog = 32 << 20

type frame struct {
	kind int
	data []byte
}
type peer struct {
	id   string
	ws   *websocket.Conn
	send chan frame
}
type room struct {
	sync.Mutex
	file    *os.File
	history [][]byte
	bytes   int
	peers   map[*peer]bool
}
type hub struct {
	sync.Mutex
	rooms map[string]*room
	dir   string
}

var roomPattern = regexp.MustCompile("^[a-zA-Z0-9_-]{1,64}$")

func openRoom(path string) (*room, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	r := &room{file: f, peers: map[*peer]bool{}}
	var offset int64
	for {
		var header [8]byte
		_, err = io.ReadFull(f, header[:])
		if errors.Is(err, io.EOF) {
			break
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			if err = f.Truncate(offset); err != nil {
				f.Close()
				return nil, err
			}
			break
		}
		if err != nil {
			f.Close()
			return nil, err
		}
		size := binary.LittleEndian.Uint32(header[:4])
		if size > 2<<20 {
			f.Close()
			return nil, errors.New("invalid update length")
		}
		data := make([]byte, size)
		_, err = io.ReadFull(f, data)
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			if err = f.Truncate(offset); err != nil {
				f.Close()
				return nil, err
			}
			break
		}
		if err != nil || crc32.ChecksumIEEE(data) != binary.LittleEndian.Uint32(header[4:]) {
			f.Close()
			return nil, errors.New("damaged update log")
		}
		r.history = append(r.history, data)
		r.bytes += len(data) + 8
		offset += int64(len(data) + 8)
		if r.bytes > maxLog {
			f.Close()
			return nil, errors.New("board log limit reached")
		}
	}
	_, err = f.Seek(0, io.SeekEnd)
	return r, err
}
func (r *room) append(data []byte) error {
	if r.bytes+len(data)+8 > maxLog {
		return errors.New("board log limit reached")
	}
	var header [8]byte
	binary.LittleEndian.PutUint32(header[:4], uint32(len(data)))
	binary.LittleEndian.PutUint32(header[4:], crc32.ChecksumIEEE(data))
	offset, err := r.file.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}
	rollback := func(e error) error { _ = r.file.Truncate(offset); _, _ = r.file.Seek(0, io.SeekEnd); return e }
	if _, err = r.file.Write(header[:]); err != nil {
		return rollback(err)
	}
	if _, err = r.file.Write(data); err != nil {
		return rollback(err)
	}
	if err = r.file.Sync(); err != nil {
		return rollback(err)
	}
	r.history = append(r.history, append([]byte(nil), data...))
	r.bytes += len(data) + 8
	return nil
}
func (r *room) broadcast(f frame) {
	for p := range r.peers {
		select {
		case p.send <- f:
		default:
			p.ws.Close()
		}
	}
}
func (r *room) presence() {
	data, _ := json.Marshal(map[string]any{"type": "presence", "peers": len(r.peers)})
	r.broadcast(frame{websocket.TextMessage, data})
}
func allowedOrigin(req *http.Request) bool {
	raw := req.Header.Get("Origin")
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && (u.Host == req.Host || (u.Host == "127.0.0.1:5176" || u.Host == "localhost:5176"))
}
func (h *hub) connect(w http.ResponseWriter, req *http.Request) {
	name := req.URL.Query().Get("room")
	if !roomPattern.MatchString(name) {
		http.Error(w, "Invalid board name", 400)
		return
	}
	h.Lock()
	r := h.rooms[name]
	if r == nil {
		if len(h.rooms) >= 32 {
			h.Unlock()
			http.Error(w, "Room limit", 503)
			return
		}
		var err error
		r, err = openRoom(filepath.Join(h.dir, name+".updates"))
		if err != nil {
			h.Unlock()
			http.Error(w, "Cannot open board", 500)
			return
		}
		h.rooms[name] = r
	}
	h.Unlock()
	upgrade := websocket.Upgrader{CheckOrigin: allowedOrigin, ReadBufferSize: 4096, WriteBufferSize: 4096}
	ws, err := upgrade.Upgrade(w, req, nil)
	if err != nil {
		return
	}
	ws.SetReadLimit(2 << 20)
	token := make([]byte, 4)
	_, _ = rand.Read(token)
	p := &peer{id: hex.EncodeToString(token), ws: ws, send: make(chan frame, 256)}
	r.Lock()
	if len(r.peers) >= 12 {
		r.Unlock()
		ws.Close()
		return
	}
	history := append([][]byte(nil), r.history...)
	r.peers[p] = true
	r.presence()
	r.Unlock()
	done := make(chan struct{})
	defer close(done)
	defer func() { ws.Close(); r.Lock(); delete(r.peers, p); r.presence(); r.Unlock() }()
	go func() {
		defer ws.Close()
		write := func(f frame) error {
			_ = ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			return ws.WriteMessage(f.kind, f.data)
		}
		for _, data := range history {
			if write(frame{websocket.BinaryMessage, data}) != nil {
				return
			}
		}
		ready, _ := json.Marshal(map[string]any{"type": "ready", "id": p.id})
		if write(frame{websocket.TextMessage, ready}) != nil {
			return
		}
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case f := <-p.send:
				if write(f) != nil {
					return
				}
			case <-ticker.C:
				if write(frame{websocket.PingMessage, nil}) != nil {
					return
				}
			}
		}
	}()
	_ = ws.SetReadDeadline(time.Now().Add(60 * time.Second))
	ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	for {
		kind, data, err := ws.ReadMessage()
		if err != nil {
			return
		}
		if kind == websocket.BinaryMessage && len(data) > 2 {
			r.Lock()
			err = r.append(data)
			if err == nil {
				r.broadcast(frame{kind, data})
			}
			r.Unlock()
			if err != nil {
				_ = ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1008, err.Error()), time.Now().Add(time.Second))
				return
			}
		}
		if kind == websocket.TextMessage && len(data) < 512 {
			var cursor struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
			}
			if json.Unmarshal(data, &cursor) == nil && cursor.X >= -10000 && cursor.X <= 10000 && cursor.Y >= -10000 && cursor.Y <= 10000 {
				body, _ := json.Marshal(map[string]any{"type": "cursor", "id": p.id, "x": cursor.X, "y": cursor.Y})
				r.Lock()
				r.broadcast(frame{websocket.TextMessage, body})
				r.Unlock()
			}
		}
	}
}
func main() {
	port := flag.String("addr", "127.0.0.1:8091", "Listen address")
	data := flag.String("data", ".data", "Board storage")
	web := flag.String("web", "web/dist", "Frontend directory")
	flag.Parse()
	if err := os.MkdirAll(*data, 0700); err != nil {
		log.Fatal(err)
	}
	h := &hub{rooms: map[string]*room{}, dir: *data}
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.connect)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","version":"0.1.0"}`))
	})
	mux.Handle("/", http.FileServer(http.Dir(*web)))
	s := &http.Server{Addr: *port, Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("Common beta: http://%s", *port)
	log.Fatal(s.ListenAndServe())
}
