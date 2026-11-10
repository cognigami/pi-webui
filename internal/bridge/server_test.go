package bridge

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) Snapshot {
	t.Helper()
	data, err := os.ReadFile("../../testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	var v Snapshot
	if err = json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	if !validSnapshot(v) {
		t.Fatal("shared snapshot invalid")
	}
	return v
}
func waitFor(t *testing.T, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !predicate() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(time.Millisecond)
	}
}
func connect(t *testing.T, s *Server, v Snapshot) (net.Conn, *json.Decoder) {
	t.Helper()
	server, client := net.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.handle(ctx, server); close(done) }()
	t.Cleanup(func() { cancel(); client.Close(); <-done })
	if err := json.NewEncoder(client).Encode(v); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { _, ok := s.Get(v.EndpointID); return ok })
	return client, json.NewDecoder(client)
}
func request(v Snapshot, id, op string) Control {
	return Control{Type: "control", Version: 1, Target: v.Target, RequestID: id, Operation: op, Text: " \n/command café 🦉\n  "}
}
func TestLiteralSendStopAndNonReplay(t *testing.T) {
	s := New()
	v := fixture(t)
	c, decoder := connect(t, s, v)
	send := request(v, "send-1", "send")
	pending := make(chan Result, 1)
	go func() { pending <- s.Dispatch(context.Background(), send) }()
	var got Control
	if err := decoder.Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got != send {
		t.Fatalf("payload changed: %#v", got)
	}
	// Stop goes through while Send still awaits its dispatch response.
	stop := request(v, "stop-1", "stop")
	stopped := make(chan Result, 1)
	go func() { stopped <- s.Dispatch(context.Background(), stop) }()
	if err := decoder.Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Operation != "stop" {
		t.Fatal("Stop blocked behind Send")
	}
	json.NewEncoder(c).Encode(Result{"result", 1, "stop-1", "stop_requested", "Stop requested"})
	if result := <-stopped; result.Status != "stop_requested" {
		t.Fatal(result)
	}
	json.NewEncoder(c).Encode(Result{"result", 1, "send-1", "submitted_unconfirmed", "Submitted; acceptance unconfirmed"})
	if result := <-pending; result.Status != "submitted_unconfirmed" {
		t.Fatal(result)
	}
	if result := s.Dispatch(context.Background(), send); result.Status != "rejected" {
		t.Fatal("duplicate dispatch", result)
	}
}
func TestAssociationChangesButLeafAdvanceDoesNot(t *testing.T) {
	s := New()
	v := fixture(t)
	c, _ := connect(t, s, v)
	v.Seq++
	leaf := "entry-2"
	v.Session.Leaf = &leaf
	if err := json.NewEncoder(c).Encode(v); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { o, _ := s.Get(v.EndpointID); return o.Snapshot.Seq == 2 })
	o, _ := s.Get(v.EndpointID)
	if o.Snapshot.AssociationID != "fixture-association" {
		t.Fatal("ordinary output invalidated target")
	}
	v.Seq++
	v.AssociationID = "navigated"
	json.NewEncoder(c).Encode(v)
	waitFor(t, func() bool { o, _ := s.Get(v.EndpointID); return o.Snapshot.Seq == 3 })
	if r := s.Dispatch(context.Background(), request(fixture(t), "old", "send")); r.Status != "rejected" {
		t.Fatal(r)
	}
}
func TestLostResponseIsUnknownAndNewEndpointDoesNotReplay(t *testing.T) {
	s := New()
	v := fixture(t)
	c, decoder := connect(t, s, v)
	result := make(chan Result, 1)
	go func() { result <- s.Dispatch(context.Background(), request(v, "lost", "send")) }()
	var got Control
	if err := decoder.Decode(&got); err != nil {
		t.Fatal(err)
	}
	c.Close()
	if r := <-result; r.Status != "outcome_unknown" {
		t.Fatal(r)
	}
	waitFor(t, func() bool { _, ok := s.Get(v.EndpointID); return !ok })
	v.EndpointID = "fresh"
	fresh, _ := connect(t, s, v)
	fresh.SetReadDeadline(time.Now().Add(20 * time.Millisecond))
	b := make([]byte, 1)
	if _, err := fresh.Read(b); err == nil {
		t.Fatal("unexpected replay")
	}
	if r := s.Dispatch(context.Background(), request(fixture(t), "stale", "stop")); r.Status != "rejected" {
		t.Fatal(r)
	}
}
func TestInvalidUnsupportedAndGap(t *testing.T) {
	s := New()
	v := fixture(t)
	c, _ := connect(t, s, v)
	for _, text := range []string{"", " \n\t", strings.Repeat("x", 128*1024+1)} {
		req := request(v, "invalid", "send")
		req.Text = text
		if r := s.Dispatch(context.Background(), req); r.Status != "rejected" {
			t.Fatal(r)
		}
	}
	v.Seq = 5
	v.State.SendSupported = false
	json.NewEncoder(c).Encode(v)
	waitFor(t, func() bool { o, _ := s.Get(v.EndpointID); return o.Snapshot.Seq == 5 })
	o, _ := s.Get(v.EndpointID)
	if !o.Snapshot.Gap {
		t.Fatal("silent observation gap")
	}
	if r := s.Dispatch(context.Background(), request(v, "unsupported", "send")); r.Status != "rejected" {
		t.Fatal(r)
	}
}

type partialWriteConn struct {
	net.Conn
	closed chan struct{}
}

func (c *partialWriteConn) Write(p []byte) (int, error) { return len(p) / 2, io.ErrUnexpectedEOF }
func (c *partialWriteConn) Close() error {
	select {
	case <-c.closed:
	default:
		close(c.closed)
	}
	return c.Conn.Close()
}
func TestPartialControlWriteClosesEndpointWithoutReplay(t *testing.T) {
	s := New()
	v := fixture(t)
	raw, client := net.Pipe()
	conn := &partialWriteConn{raw, make(chan struct{})}
	done := make(chan struct{})
	go func() { s.handle(context.Background(), conn); close(done) }()
	t.Cleanup(func() { client.Close(); <-done })
	if err := json.NewEncoder(client).Encode(v); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { _, ok := s.Get(v.EndpointID); return ok })
	if r := s.Dispatch(context.Background(), request(v, "partial", "send")); r.Status != "outcome_unknown" {
		t.Fatal(r)
	}
	select {
	case <-conn.closed:
	case <-time.After(time.Second):
		t.Fatal("damaged stream left open")
	}
	waitFor(t, func() bool { _, ok := s.Get(v.EndpointID); return !ok })
	if r := s.Dispatch(context.Background(), request(v, "later", "stop")); r.Status != "rejected" {
		t.Fatal(r)
	}
}
func TestMalformedAndOversizedPeersAreDropped(t *testing.T) {
	for _, frame := range []string{"not json\n", strings.Repeat("x", MaxFrame) + "\n"} {
		s := New()
		server, client := net.Pipe()
		done := make(chan struct{})
		go func() { s.handle(context.Background(), server); close(done) }()
		client.Write([]byte(frame))
		client.Close()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("unbounded frame reader")
		}
	}
}
