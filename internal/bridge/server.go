package bridge

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"sync"
	"time"
)

type Observation struct {
	Snapshot   Snapshot  `json:"snapshot"`
	Connected  bool      `json:"connected"`
	ReceivedAt time.Time `json:"receivedAt"`
}
type peer struct {
	conn        net.Conn
	write       sync.Mutex
	observation Observation
	pending     map[string]chan Result
	used        map[string]bool
}

// Server holds bounded observations, not history or a control outbox.
type Server struct {
	mu    sync.Mutex
	peers map[string]*peer
}

func New() *Server { return &Server{peers: make(map[string]*peer)} }
func (s *Server) List() []Observation {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Observation, 0, len(s.peers))
	for _, p := range s.peers {
		out = append(out, p.observation)
	}
	return out
}
func (s *Server) Get(id string) (Observation, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.peers[id]
	if !ok {
		return Observation{}, false
	}
	return p.observation, true
}
func scanner(c net.Conn) *bufio.Scanner {
	r := bufio.NewScanner(c)
	r.Buffer(make([]byte, 4096), MaxFrame)
	return r
}
func validSnapshot(v Snapshot) bool {
	return v.Type == "snapshot" && v.Version == Version && v.EndpointID != "" && v.AssociationID != "" && v.Seq > 0 && v.Session.ID != "" && v.Host.PID > 0 && (v.Host.Mode == "tui")
}

// Serve closes every connection on cancellation, independently of Pi lifetime.
func (s *Server) Serve(ctx context.Context, l net.Listener) error {
	ctx, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	defer func() { cancel(); l.Close(); s.closePeers(); wg.Wait() }()
	go func() { <-ctx.Done(); l.Close() }()
	for {
		c, err := l.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		wg.Add(1)
		go func() { defer wg.Done(); s.handle(ctx, c) }()
	}
}
func (s *Server) closePeers() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.peers {
		p.conn.Close()
	}
}
func (s *Server) handle(ctx context.Context, c net.Conn) {
	defer c.Close()
	// Also close clients that never finish their first frame.
	stop := context.AfterFunc(ctx, func() { c.Close() })
	defer stop()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	r := scanner(c)
	if !r.Scan() {
		return
	}
	var envelope struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(r.Bytes(), &envelope) != nil {
		return
	}
	if envelope.Type == "control" {
		var req Control
		if json.Unmarshal(r.Bytes(), &req) != nil {
			return
		}
		result := s.Dispatch(ctx, req)
		c.SetWriteDeadline(time.Now().Add(time.Second))
		json.NewEncoder(c).Encode(result)
		return
	}
	var snapshot Snapshot
	if json.Unmarshal(r.Bytes(), &snapshot) != nil || !validSnapshot(snapshot) {
		return
	}
	p := &peer{conn: c, observation: Observation{snapshot, true, time.Now()}, pending: make(map[string]chan Result), used: make(map[string]bool)}
	s.mu.Lock()
	// An endpoint ID is unique to a connection. Never replace an existing target.
	if _, exists := s.peers[snapshot.EndpointID]; exists || len(s.peers) >= 256 {
		s.mu.Unlock()
		return
	}
	s.peers[snapshot.EndpointID] = p
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.peers, snapshot.EndpointID)
		for _, ch := range p.pending {
			close(ch)
		}
	}()
	c.SetReadDeadline(time.Now().Add(15 * time.Second))
	for r.Scan() {
		var env struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(r.Bytes(), &env) != nil {
			return
		}
		s.mu.Lock()
		switch env.Type {
		case "snapshot":
			var next Snapshot
			if json.Unmarshal(r.Bytes(), &next) != nil || !validSnapshot(next) || next.EndpointID != snapshot.EndpointID || next.Seq <= p.observation.Snapshot.Seq {
				s.mu.Unlock()
				return
			}
			if next.Seq != p.observation.Snapshot.Seq+1 {
				next.Gap = true
			}
			p.observation = Observation{next, true, time.Now()}
		case "result":
			var result Result
			if json.Unmarshal(r.Bytes(), &result) != nil || result.Version != Version {
				s.mu.Unlock()
				return
			}
			switch result.Status {
			case "submitted_unconfirmed", "stop_requested", "rejected", "outcome_unknown":
			default:
				s.mu.Unlock()
				return
			}
			if ch, ok := p.pending[result.RequestID]; ok {
				ch <- result
				delete(p.pending, result.RequestID)
			}
		default:
			s.mu.Unlock()
			return
		}
		s.mu.Unlock()
		c.SetReadDeadline(time.Now().Add(15 * time.Second))
	}
}
func (s *Server) Dispatch(ctx context.Context, req Control) Result {
	if req.Type != "control" || req.Version != Version || req.RequestID == "" || len(req.RequestID) > 128 {
		return Rejected(req.RequestID, "Invalid control request.")
	}
	if req.Operation != "send" && req.Operation != "stop" {
		return Rejected(req.RequestID, "Unknown operation.")
	}
	if req.Operation == "send" && (len(strings.TrimSpace(req.Text)) == 0 || len(req.Text) > 128*1024) {
		return Rejected(req.RequestID, "Message must contain 1–131072 bytes.")
	}
	s.mu.Lock()
	p, ok := s.peers[req.EndpointID]
	if !ok || p.observation.Snapshot.AssociationID != req.AssociationID {
		s.mu.Unlock()
		return Rejected(req.RequestID, "Target unavailable or conversation changed.")
	}
	if time.Since(p.observation.ReceivedAt) > 10*time.Second {
		s.mu.Unlock()
		return Rejected(req.RequestID, "Observation is stale.")
	}
	if p.observation.Snapshot.State.ControlUnavailable != "" {
		reason := p.observation.Snapshot.State.ControlUnavailable
		s.mu.Unlock()
		return Rejected(req.RequestID, reason)
	}
	if req.Operation == "send" && !p.observation.Snapshot.State.SendSupported {
		s.mu.Unlock()
		return Rejected(req.RequestID, "Terminal action required; Send unsupported.")
	}
	// Bound outstanding requests AND transient replay protection. No eviction/replay.
	// On exhaustion require a fresh connection, rather than forget IDs and risk resend.
	if p.used[req.RequestID] || len(p.used) >= 1024 || len(p.pending) >= 16 {
		s.mu.Unlock()
		return Rejected(req.RequestID, "Duplicate request or connection control limit reached.")
	}
	ch := make(chan Result, 1)
	p.pending[req.RequestID] = ch
	p.used[req.RequestID] = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(p.pending, req.RequestID); s.mu.Unlock() }()
	// Serializes tiny socket writes only; never waits for a Send acceptance/turn.
	p.write.Lock()
	p.conn.SetWriteDeadline(time.Now().Add(time.Second))
	err := json.NewEncoder(p.conn).Encode(req)
	if err != nil {
		p.conn.Close()
	} // Close a damaged stream before any waiting writer runs.
	p.write.Unlock()
	if err != nil {
		return Unknown(req.RequestID)
	}
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	select {
	case result, open := <-ch:
		if open {
			return result
		}
		return Unknown(req.RequestID)
	case <-ctx.Done():
		return Unknown(req.RequestID)
	case <-timer.C:
		return Unknown(req.RequestID)
	}
}
func Client(ctx context.Context, path string, req Control) (Result, error) {
	c, err := (&net.Dialer{}).DialContext(ctx, "unix", path)
	if err != nil {
		return Result{}, err
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	if err := json.NewEncoder(c).Encode(req); err != nil {
		return Unknown(req.RequestID), nil
	}
	r := scanner(c)
	if !r.Scan() {
		return Unknown(req.RequestID), nil
	}
	var result Result
	if json.Unmarshal(r.Bytes(), &result) != nil || result.RequestID != req.RequestID || result.Version != Version {
		return Unknown(req.RequestID), errors.New("invalid control response")
	}
	return result, nil
}
