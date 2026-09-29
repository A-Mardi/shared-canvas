package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDurableLogAndPartialTail(t *testing.T) {
	path := filepath.Join(t.TempDir(), "board.updates")
	r, err := openRoom(path)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte{1, 2, 3, 4}
	if err = r.append(payload); err != nil {
		t.Fatal(err)
	}
	r.file.Close()
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	f.Write([]byte{7, 8, 9})
	f.Close()
	r, err = openRoom(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.file.Close()
	if len(r.history) != 1 || string(r.history[0]) != string(payload) {
		t.Fatal("committed update not recovered")
	}
	if err = r.append([]byte{9, 8, 7}); err != nil {
		t.Fatal(err)
	}
}
func TestChecksumRejectsCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "board.updates")
	r, _ := openRoom(path)
	r.append([]byte{1, 2, 3})
	r.file.Close()
	f, _ := os.OpenFile(path, os.O_WRONLY, 0600)
	f.WriteAt([]byte{0}, 8)
	f.Close()
	if r, err := openRoom(path); err == nil {
		r.file.Close()
		t.Fatal("expected corruption error")
	}
}
