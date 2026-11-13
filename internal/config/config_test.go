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
func TestAbandonedSocketIsRecoveredAndLockReleased(t *testing.T) {
	path := filepath.Join(directory(t), "bridge.sock")
	old, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	old.SetUnlinkOnClose(false)
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	listener, err := ListenPrivate(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatal("closed socket remains", err)
	}
	next, err := ListenPrivate(path)
	if err != nil {
		t.Fatal("lock was not released", err)
	}
	next.Close()
}
func TestLiveLegacySocketWithoutLockIsNotReplaced(t *testing.T) {
	path := filepath.Join(directory(t), "bridge.sock")
	old, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	if replacement, err := ListenPrivate(path); err == nil {
		replacement.Close()
		t.Fatal("replaced live socket without a lock")
	}
	conn, err := net.Dial("unix", path)
	if err != nil {
		t.Fatal("existing listener was damaged", err)
	}
	conn.Close()
}
func TestSocketLockProtectsEvenAnUnlinkedListener(t *testing.T) {
	path := filepath.Join(directory(t), "bridge.sock")
	first, err := ListenPrivate(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if next, err := ListenPrivate(path); err == nil {
		next.Close()
		t.Fatal("ignored the running owner's lock")
	}
}
func TestExistingFilesAndSymlinksAreNotRemoved(t *testing.T) {
	for _, kind := range []string{"file", "socket-symlink", "lock-symlink"} {
		t.Run(kind, func(t *testing.T) {
			dir := directory(t)
			path := filepath.Join(dir, "bridge.sock")
			target := filepath.Join(dir, "keep")
			if err := os.WriteFile(target, []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "file":
				if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
					t.Fatal(err)
				}
			case "socket-symlink":
				if err := os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			case "lock-symlink":
				if err := os.Symlink(target, path+".lock"); err != nil {
					t.Fatal(err)
				}
			}
			if l, err := ListenPrivate(path); err == nil {
				l.Close()
				t.Fatal("replaced", kind)
			}
			data, err := os.ReadFile(target)
			if err != nil || string(data) != "keep" {
				t.Fatal("modified target", err)
			}
			if kind == "file" {
				if data, err := os.ReadFile(path); err != nil || string(data) != "keep" {
					t.Fatal("modified existing file", err)
				}
			}
		})
	}
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
