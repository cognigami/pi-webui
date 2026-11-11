package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"syscall"
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

// ListenPrivate refuses existing paths; it never unlinks someone else's socket.
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
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("socket path already exists or cannot be checked")
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
