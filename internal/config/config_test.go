package config

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func directory(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp(".", "t-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	abs, err := filepath.Abs(dir)
	if err != nil {
		t.Fatal(err)
	}
	return abs
}
func TestPrivateSocketAndRefusalToReplace(t *testing.T) {
	dir := directory(t)
	path := filepath.Join(dir, "bridge.sock")
	listener, err := ListenPrivate(path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	if replacement, err := ListenPrivate(path); err == nil {
		replacement.Close()
		t.Fatal("replaced existing socket")
	}
	conn, err := net.Dial("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	conn.Close()
}
func TestUnsafeDirectoryIsNotRepaired(t *testing.T) {
	dir := directory(t)
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := ListenPrivate(filepath.Join(dir, "bridge.sock")); err == nil {
		t.Fatal("accepted public directory")
	}
	info, _ := os.Stat(dir)
	if info.Mode().Perm() != 0755 {
		t.Fatal("modified operator permissions")
	}
}
func TestSymlinkIsRejected(t *testing.T) {
	dir := directory(t)
	link := filepath.Join(dir, "alias")
	target := filepath.Join(dir, "private")
	os.Mkdir(target, 0700)
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := ListenPrivate(filepath.Join(link, "bridge.sock")); err == nil {
		t.Fatal("accepted symlink")
	}
}
func TestPrivateListenerAndUnknownConfig(t *testing.T) {
	dir := directory(t)
	path := filepath.Join(dir, "config.json")
	for _, data := range []string{`{"address":"0.0.0.0"}`, `{"address":"8.8.8.8"}`, `{"unknown":true}`, `{"socket":"relative"}`} {
		os.WriteFile(path, []byte(data), 0600)
		if _, err := Load(path); err == nil {
			t.Fatal("accepted", data)
		}
	}
	if c, err := Load(""); err != nil || c.Address != "127.0.0.1" {
		t.Fatal(c, err)
	}
	for _, address := range []string{"127.0.0.1", "::1", "192.168.1.2", "10.1.2.3", "100.90.1.2", "fd00::1"} {
		if err := os.WriteFile(path, []byte(`{"address":"`+address+`"}`), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path); err != nil {
			t.Fatalf("explicit private IP %s: %v", address, err)
		}
	}
	for _, address := range []string{"::", "0.0.0.0", "8.8.8.8", "example.com"} {
		os.WriteFile(path, []byte(`{"address":"`+address+`"}`), 0600)
		if _, err := Load(path); err == nil {
			t.Fatal("wildcard/public/DNS listener accepted", address)
		}
	}
}
