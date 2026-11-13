package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type Config struct {
	Address string `json:"address"`
	Port    int    `json:"port"`
	Socket  string `json:"socket"`
}

func Load(path string) (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, err
	}
	c := Config{Address: "127.0.0.1", Port: 8484, Socket: filepath.Join(home, ".local", "state", "rai", "bridge.sock")}
	if path != "" {
		f, err := os.Open(path)
		if err != nil {
			return c, err
		}
		defer f.Close()
		d := json.NewDecoder(f)
		d.DisallowUnknownFields()
		if err := d.Decode(&c); err != nil {
			return c, err
		}
	}
	ip, err := netip.ParseAddr(c.Address)
	if err != nil || (!ip.IsLoopback() && !ip.IsPrivate() && !netip.MustParsePrefix("100.64.0.0/10").Contains(ip)) {
		return c, errors.New("choose an explicit loopback, private LAN, or Tailscale IP; wildcard/public binding is refused")
	}
	c.Address = ip.String()
	if c.Port < 1 || c.Port > 65535 || !filepath.IsAbs(c.Socket) {
		return c, errors.New("invalid port or absolute socket path")
	}
	return c, nil
}

// ListenPrivate holds a per-path lock until Close and recovers only owned,
// abandoned sockets. Live sockets and non-socket paths are never replaced.
func ListenPrivate(path string) (net.Listener, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) || !info.IsDir() || info.Mode().Perm() != 0700 {
		return nil, fmt.Errorf("socket directory must be user-owned mode 0700: %s", dir)
	}
	// Reject symlink components, not only a symlink at the final directory.
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, err
	}
	if resolved != filepath.Clean(dir) {
		return nil, errors.New("socket directory must not contain symlinks")
	}
	// Keep the lock file: unlinking it would let another starter lock a new inode.
	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	info, err = lock.Stat()
	if err != nil {
		lock.Close()
		return nil, err
	}
	stat, ok = info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		lock.Close()
		return nil, errors.New("socket lock must be a user-owned regular file with mode 0600")
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("bridge socket is owned by another RAI instance: %w", err)
	}
	l, err := listenSocket(path)
	if err != nil {
		lock.Close()
		return nil, err
	}
	return &privateListener{Listener: l, lock: lock}, nil
}

// The caller holds the path lock while checking, reclaiming and binding.
func listenSocket(path string) (net.Listener, error) {
	if info, err := os.Lstat(path); err == nil {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != uint32(os.Getuid()) || info.Mode()&os.ModeSocket == 0 {
			return nil, errors.New("existing bridge path is not a user-owned socket")
		}
		conn, err := net.DialTimeout("unix", path, 250*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil, errors.New("bridge socket is already listening")
		}
		if !errors.Is(err, syscall.ECONNREFUSED) {
			return nil, fmt.Errorf("cannot establish that bridge socket is abandoned: %w", err)
		}
		if err := os.Remove(path); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	l, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0600); err != nil {
		l.Close()
		return nil, err
	}
	return l, nil
}

type privateListener struct {
	net.Listener
	lock *os.File
	once sync.Once
	err  error
}

func (l *privateListener) Close() error {
	l.once.Do(func() {
		// Remove/close the listener before allowing the next starter to bind.
		l.err = errors.Join(l.Listener.Close(), l.lock.Close())
	})
	return l.err
}
