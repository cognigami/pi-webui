package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rai/internal/bridge"
)

const testAuthority = "127.0.0.1:8484"

type fakeSessions struct {
	observation bridge.Observation
	calls       []bridge.Control
	getter      func(string) (bridge.Observation, bool)
	dispatch    func(context.Context, bridge.Control) bridge.Result
}

func (s *fakeSessions) List() []bridge.Observation { return []bridge.Observation{s.observation} }
func (s *fakeSessions) Get(id string) (bridge.Observation, bool) {
	if s.getter != nil {
		return s.getter(id)
	}
	return s.observation, id == s.observation.Snapshot.EndpointID
}
func (s *fakeSessions) Dispatch(ctx context.Context, req bridge.Control) bridge.Result {
	if s.dispatch != nil {
		return s.dispatch(ctx, req)
	}
	s.calls = append(s.calls, req)
	if req.Target != s.observation.Snapshot.Target {
		return bridge.Rejected(req.RequestID, "Conversation changed")
	}
	status, detail := "submitted_unconfirmed", "Submitted; acceptance unconfirmed"
	if req.Operation == "stop" {
		status, detail = "stop_requested", "Stop requested"
	}
	return bridge.Result{Type: "result", Version: 1, RequestID: req.RequestID, Status: status, Detail: detail}
}
func webFixture(t *testing.T) (*fakeSessions, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "synthetic.jsonl")
	data := `{"type":"session","version":3,"id":"session"}
{"type":"message","id":"u","parentId":null,"message":{"role":"user","content":"hello"}}
{"type":"message","id":"a","parentId":"u","message":{"role":"assistant","content":[{"type":"text","text":"saved after later transformation"}]}}
{"type":"message","id":"t","parentId":"a","message":{"role":"toolResult","toolName":"fixture","toolCallId":"call","content":[{"type":"text","text":"done"}]}}
`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	cutoff := "u"
	s := &fakeSessions{observation: bridge.Observation{Connected: true, ReceivedAt: time.Now(), Snapshot: bridge.Snapshot{
		Type: "snapshot", Version: 1, Target: bridge.Target{EndpointID: "ep", AssociationID: "assoc"}, Seq: 1, ObservedAt: time.Now().Format(time.RFC3339),
		Host: bridge.Host{PID: 123, Cwd: "/synthetic", Mode: "tui"}, Session: bridge.Session{ID: "session", File: &path, Leaf: &cutoff, Cutoff: &cutoff},
		State: bridge.State{Activity: "working", SendSupported: true}, HistoryReady: true, TurnOpen: true,
		Provisional: json.RawMessage(`{"message":{"role":"assistant","content":[{"type":"text","text":"provisional before transformation"}]},"tools":[]}`),
	}}}
	return s, path
}
func appFor(t *testing.T, s *fakeSessions) http.Handler {
	t.Helper()
	h, err := App(s, func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("fixture backend unavailable")
	})
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func call(h http.Handler, method, path, body, origin, token, host string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Host = host
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if token != "" {
		r.Header.Set("X-RAI-CSRF", token)
	}
	if method == "POST" {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func csrfToken(t *testing.T, h http.Handler) string {
	t.Helper()
	w := call(h, "GET", "/api/bootstrap", "", "", "", testAuthority)
	var value map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	if len(value["csrf"]) != 64 {
		t.Fatal("missing per-start token")
	}
	return value["csrf"]
}
func TestUntouchedSessionIsEmptyBeforeFileCreationButMissingSavedHistoryIsError(t *testing.T) {
	s, _ := webFixture(t)
	path := filepath.Join(t.TempDir(), "not-created-yet.jsonl")
	s.observation.Snapshot.Session.File = &path
	s.observation.Snapshot.Session.Leaf = nil
	s.observation.Snapshot.Session.Cutoff = nil
	s.observation.Snapshot.TurnOpen = false
	s.observation.Snapshot.Provisional = json.RawMessage(`{"message":null,"tools":[]}`)
	h := appFor(t, s)
	get := func() conversation {
		w := call(h, "GET", "/conversation/ep?association=assoc", "", "", "", testAuthority)
		if w.Code != 200 {
			t.Fatal(w.Code)
		}
		var c conversation
		if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
			t.Fatal(err)
		}
		return c
	}
	for _, file := range []*string{&path, nil} {
		s.observation.Snapshot.Session.File = file
		c := get()
		if c.History == nil || c.HistoryError != "" || len(c.History.Entries) != 0 {
			t.Fatal(c)
		}
	}
	s.observation.Snapshot.Session.File = &path
	cutoff := "saved"
	s.observation.Snapshot.Session.Cutoff = &cutoff
	if c := get(); c.History != nil || c.HistoryError == "" {
		t.Fatal("missing saved history concealed", c)
	}
	if err := os.WriteFile(path, []byte(`{"type":"session","version":3,"id":"session"}`+"\n"+`{"type":"message","id":"saved","parentId":null,"message":{"role":"user","content":"first"}}`+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if c := get(); c.History == nil || c.HistoryError != "" || len(c.History.Entries) != 1 {
		t.Fatal(c)
	}
}
func TestConversationHistoryAndProvisionalUseOneCutoff(t *testing.T) {
	s, path := webFixture(t)
	h := appFor(t, s)
	get := func() conversation {
		w := call(h, "GET", "/conversation/ep?association=assoc", "", "", "", testAuthority)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var c conversation
		if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
			t.Fatal(err)
		}
		return c
	}
	current := get()
	if len(current.History.Entries) != 1 || current.History.Entries[0].ID != "u" || !strings.Contains(string(current.Observation.Snapshot.Provisional), "provisional") {
		t.Fatal(current)
	}
	cutoff := "t"
	s.observation.Snapshot.Session.Cutoff = &cutoff
	s.observation.Snapshot.TurnOpen = false
	s.observation.Snapshot.PersistedIDs = []string{"a", "t"}
	s.observation.Snapshot.Provisional = json.RawMessage(`{"message":null,"tools":[]}`)
	complete := get()
	if len(complete.History.Entries) != 3 || complete.History.Entries[1].ID != "a" || !strings.Contains(string(complete.History.Entries[1].Data), "saved after later transformation") {
		t.Fatal(complete)
	}
	if strings.Contains(string(complete.Observation.Snapshot.Provisional), "provisional") {
		t.Fatal("duplicate provisional output")
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintln(f, `{"type":"context_edit","id":"c","parentId":"t","targetId":"a","replacement":null}`)
	f.Close()
	cutoff = "c"
	tail := get()
	if len(tail.History.Entries) != 4 || tail.History.Entries[3].Type != "context_edit" {
		t.Fatal("late committed tail missing")
	}
}
func TestHistoryAssociationInvalidatedDuringNavigationAndRead(t *testing.T) {
	s, _ := webFixture(t)
	h := appFor(t, s)
	s.observation.Snapshot.AssociationID = "pending"
	s.observation.Snapshot.HistoryReady = false
	s.observation.Snapshot.Session.Cutoff = nil
	s.observation.Snapshot.Provisional = json.RawMessage(`{"message":null,"tools":[]}`)
	w := call(h, "GET", "/conversation/ep?association=pending", "", "", "", testAuthority)
	var c conversation
	json.Unmarshal(w.Body.Bytes(), &c)
	if c.History != nil || c.HistoryError == "" || strings.Contains(w.Body.String(), "saved after later transformation") {
		t.Fatal(w.Body.String())
	}
	if old := call(h, "GET", "/conversation/ep?association=assoc", "", "", "", testAuthority); old.Code != 409 {
		t.Fatal(old.Code)
	}
	s.observation.Snapshot.HistoryReady = true
	s.observation.Snapshot.AssociationID = "assoc"
	calls := 0
	s.getter = func(id string) (bridge.Observation, bool) {
		calls++
		copy := s.observation
		if calls > 1 {
			copy.Snapshot.AssociationID = "changed"
		}
		return copy, true
	}
	if raced := call(h, "GET", "/conversation/ep?association=assoc", "", "", "", testAuthority); raced.Code != 409 {
		t.Fatal("served stale read", raced.Code)
	}
}
func TestHistoryNeverTakesBrowserFilePathOrSiblingEntry(t *testing.T) {
	s, _ := webFixture(t)
	h := appFor(t, s)
	w := call(h, "GET", "/conversation/ep?association=assoc&path=/not-an-authorized-file", "", "", "", testAuthority)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "hello") {
		t.Fatal(w.Body.String())
	}
	sibling := call(h, "GET", "/conversation/ep/entries/a?association=assoc", "", "", "", testAuthority)
	if sibling.Code != 409 {
		t.Fatal("expanded entry beyond safe cutoff", sibling.Code)
	}
	bad := call(h, "GET", "/conversation/ep/entries/u?association=assoc&offset=-1", "", "", "", testAuthority)
	if bad.Code != 400 {
		t.Fatal(bad.Code)
	}
}
func TestBrowserBoundaryRejectsCrossOriginAndUnprotectedControls(t *testing.T) {
	s, _ := webFixture(t)
	h := appFor(t, s)
	token := csrfToken(t, h)
	body := `{"type":"control","version":1,"endpointId":"ep","associationId":"assoc","requestId":"one","operation":"send","text":"literal"}`
	for _, tc := range []struct{ host, origin, token string }{
		{"attacker.example", "http://" + testAuthority, token},
		{testAuthority, "https://attacker.example", token},
		{testAuthority, "", token},
		{testAuthority, "http://" + testAuthority, ""},
	} {
		w := call(h, "POST", "/control", body, tc.origin, tc.token, tc.host)
		if w.Code != 403 {
			t.Fatal(w.Code, w.Body.String())
		}
		if w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("permissive CORS")
		}
	}
	r := httptest.NewRequest("POST", "/control", strings.NewReader(body))
	r.Host = "machine.local:8000"
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://machine.local:8000")
	r.Header.Set("X-RAI-CSRF", token)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	crossSite := httptest.NewRecorder()
	h.ServeHTTP(crossSite, r)
	if crossSite.Code != 403 {
		t.Fatal("cross-site request accepted", crossSite.Code)
	}
	if len(s.calls) != 0 {
		t.Fatal("unprotected dispatch")
	}
	get := call(h, "GET", "/control", "", "", "", testAuthority)
	if get.Code < 400 {
		t.Fatal("state-changing GET")
	}
	other := appFor(t, s)
	if oldToken := call(other, "POST", "/control", body, "http://"+testAuthority, token, testAuthority); oldToken.Code != 403 {
		t.Fatal("old-start CSRF token accepted")
	}
	valid := call(h, "POST", "/control", body, "http://"+testAuthority, token, testAuthority)
	if valid.Code != 200 || len(s.calls) != 1 {
		t.Fatal(valid.Code, valid.Body.String())
	}
}
func TestLiteralPayloadAndKnownInvalidControlBodies(t *testing.T) {
	s, _ := webFixture(t)
	h := appFor(t, s)
	token := csrfToken(t, h)
	text := " \n/command café 🦉\n  "
	req := bridge.Control{Type: "control", Version: 1, Target: s.observation.Snapshot.Target, RequestID: "literal", Operation: "send", Text: text}
	body, _ := json.Marshal(req)
	w := call(h, "POST", "/control", string(body), "http://"+testAuthority, token, testAuthority)
	if w.Code != 200 || len(s.calls) != 1 || s.calls[0].Text != text {
		t.Fatal(w.Body.String())
	}
	stale := req
	stale.AssociationID = "old"
	data, _ := json.Marshal(stale)
	w = call(h, "POST", "/control", string(data), "http://"+testAuthority, token, testAuthority)
	if !strings.Contains(w.Body.String(), `"rejected"`) {
		t.Fatal(w.Body.String())
	}
	before := len(s.calls)
	for _, bad := range []string{string(body) + ` {}`, `{"unknown":true}`, string([]byte{0xff}), strings.Repeat("x", bridge.MaxFrame+1)} {
		w := call(h, "POST", "/control", bad, "http://"+testAuthority, token, testAuthority)
		if w.Code < 400 {
			t.Fatal("accepted malformed request")
		}
	}
	if len(s.calls) != before {
		t.Fatal("invalid request dispatched")
	}
}
func TestStopHTTPDoesNotWaitForPendingSend(t *testing.T) {
	s, _ := webFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	s.dispatch = func(ctx context.Context, req bridge.Control) bridge.Result {
		if req.Operation == "send" {
			close(started)
			<-release
			return bridge.Unknown(req.RequestID)
		}
		return bridge.Result{Type: "result", Version: 1, RequestID: req.RequestID, Status: "stop_requested", Detail: "Stop requested"}
	}
	h := appFor(t, s)
	token := csrfToken(t, h)
	send := `{"type":"control","version":1,"endpointId":"ep","associationId":"assoc","requestId":"send","operation":"send","text":"x"}`
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- call(h, "POST", "/control", send, "http://"+testAuthority, token, testAuthority) }()
	<-started
	stop := strings.ReplaceAll(strings.ReplaceAll(send, `"operation":"send"`, `"operation":"stop"`), `"requestId":"send"`, `"requestId":"stop"`)
	w := call(h, "POST", "/control", stop, "http://"+testAuthority, token, testAuthority)
	if !strings.Contains(w.Body.String(), "stop_requested") {
		t.Fatal(w.Body.String())
	}
	close(release)
	if result := <-done; !strings.Contains(result.Body.String(), "outcome_unknown") {
		t.Fatal(result.Body.String())
	}
}
func TestBrowserNamesNeedNoAllowlistAndStillRequireMatchingOrigin(t *testing.T) {
	for _, host := range []string{"machine.local:8000", "machine:8000", "192.168.1.9:8000", "localhost:18484", "[::1]:8000", "localhost", "localhost:80"} {
		t.Run(host, func(t *testing.T) {
			s, _ := webFixture(t)
			h, err := App(s, nil)
			if err != nil {
				t.Fatal(err)
			}
			bootstrap := call(h, "GET", "/api/bootstrap", "", "", "", host)
			if bootstrap.Code != 200 {
				t.Fatal(bootstrap.Code, bootstrap.Body.String())
			}
			var token map[string]string
			json.Unmarshal(bootstrap.Body.Bytes(), &token)
			body := `{"type":"control","version":1,"endpointId":"ep","associationId":"assoc","requestId":"localhost","operation":"stop"}`
			valid := call(h, "POST", "/control", body, "http://"+strings.TrimSuffix(host, ":80"), token["csrf"], host)
			if valid.Code != 200 || len(s.calls) != 1 {
				t.Fatal(valid.Code, valid.Body.String())
			}
			wrongOrigin := call(h, "POST", "/control", body, "http://other-machine.local:8000", token["csrf"], host)
			if wrongOrigin.Code != 403 || len(s.calls) != 1 {
				t.Fatal("cross-alias Origin accepted", wrongOrigin.Code)
			}
		})
	}
}
func TestDefaultHTTPPortUsesBrowserCanonicalOrigin(t *testing.T) {
	s, _ := webFixture(t)
	h, err := App(s, nil)
	if err != nil {
		t.Fatal(err)
	}
	bootstrap := call(h, "GET", "/api/bootstrap", "", "", "", "127.0.0.1")
	var token map[string]string
	json.Unmarshal(bootstrap.Body.Bytes(), &token)
	if bootstrap.Code != 200 {
		t.Fatal(bootstrap.Code)
	}
	body := `{"type":"control","version":1,"endpointId":"ep","associationId":"assoc","requestId":"default-port","operation":"stop"}`
	w := call(h, "POST", "/control", body, "http://127.0.0.1", token["csrf"], "127.0.0.1")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	bad := call(h, "POST", "/control", body, "http://127.0.0.1:81", token["csrf"], "127.0.0.1")
	if bad.Code != 403 {
		t.Fatal("other port accepted", bad.Code)
	}
}
func TestLocalFontsAndLicenseAreEmbeddedWithRestrictedFontPolicy(t *testing.T) {
	s, _ := webFixture(t)
	h := appFor(t, s)
	for _, name := range []string{"GoogleSans-Variable.ttf", "GoogleSans-Italic-Variable.ttf"} {
		w := call(h, "GET", "/fonts/"+name, "", "", "", testAuthority)
		if w.Code != 200 || w.Header().Get("Content-Type") != "font/ttf" || w.Body.Len() < 1024 {
			t.Fatal(name, w.Code, w.Header())
		}
		if !strings.Contains(w.Header().Get("Content-Security-Policy"), "font-src 'self';") {
			t.Fatal("missing local font policy")
		}
	}
	license := call(h, "GET", "/fonts/GoogleSans-OFL.txt", "", "", "", testAuthority)
	if license.Code != 200 || license.Header().Get("Content-Type") != "text/plain; charset=utf-8" || !strings.Contains(license.Body.String(), "SIL OPEN FONT LICENSE") {
		t.Fatal("font license unavailable")
	}
	if w := call(h, "GET", "/fonts/not-an-asset.ttf", "", "", "", testAuthority); w.Code != 404 {
		t.Fatal("unlisted font route accepted")
	}
}
func TestEmbeddedBrowserAssetsAndSecurityHeaders(t *testing.T) {
	s, _ := webFixture(t)
	h := appFor(t, s)
	for _, path := range []string{"/", "/app.js", "/model.js", "/style.css"} {
		w := call(h, "GET", path, "", "", "", testAuthority)
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Security-Policy") == "" {
			t.Fatal(path, w.Code)
		}
	}
	if w := call(h, "GET", "/model.test.js", "", "", "", testAuthority); w.Code != 404 {
		t.Fatal("test assets exposed")
	}
}
