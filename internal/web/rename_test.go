package web

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"rai/internal/bridge"
)

type renameSessions struct {
	*fakeSessions
	others []bridge.Observation
}

func (s *renameSessions) List() []bridge.Observation {
	return append(s.fakeSessions.List(), s.others...)
}

type renameMux struct {
	label       string
	windowID    string
	mutations   [][]string
	reads       int
	mutationErr error
	herdrOutput string
}

func (m *renameMux) run(_ context.Context, name string, args ...string) ([]byte, error) {
	switch name + " " + strings.Join(args, " ") {
	case "herdr agent list":
		m.reads++
		return []byte(`{"result":{"agents":[{"agent":"pi","pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1","name":"agent one"},{"agent":"pi","pane_id":"w1:p2","tab_id":"w1:t1","workspace_id":"w1","name":"agent two"},{"agent":"pi","pane_id":"w2:p1","tab_id":"w2:t1","workspace_id":"w2","name":"fallback"}]}}`), nil
	case "herdr tab list --workspace w1":
		return json.Marshal(map[string]any{"result": map[string]any{"tabs": []map[string]string{{"tab_id": "w1:t1", "label": m.label}}}})
	case "herdr tab list --workspace w2":
		return []byte(`{"result":{"tabs":[{"tab_id":"w2:t1"}]}}`), nil
	case "tmux list-panes -a -F #{pane_id}":
		return []byte("%1\n%2\n"), nil
	}
	if name == "tmux" && len(args) == 5 && args[0] == "display-message" {
		fields := map[string]string{"#{socket_path}": "/fixture/tmux.sock", "#{window_id}": m.windowID, "#{window_name}": m.label, "#{pane_current_command}": "pi"}
		return []byte(fields[args[4]] + "\n"), nil
	}
	m.mutations = append(m.mutations, append([]string{name}, args...))
	if m.mutationErr != nil {
		return nil, m.mutationErr
	}
	if name == "herdr" {
		if m.herdrOutput != "" {
			return []byte(m.herdrOutput), nil
		}
		m.label = args[len(args)-1]
		return json.Marshal(map[string]any{"id": "cli:tab:rename", "result": map[string]any{
			"type": "tab_info", "tab": map[string]string{"tab_id": args[2], "label": m.label},
		}})
	}
	return nil, nil
}

const testRename = `{"endpointId":"ep","associationId":"assoc","tabId":"w1:t1","name":"New name"}`

func renameFixture(t *testing.T) (*renameSessions, *renameMux, http.Handler, string) {
	t.Helper()
	t.Setenv("HERDR_SOCKET_PATH", "/fixture/herdr.sock")
	s := &renameSessions{fakeSessions: &fakeSessions{observation: bridge.Observation{
		Connected: true, ReceivedAt: time.Now(), Snapshot: bridge.Snapshot{
			Target:  bridge.Target{EndpointID: "ep", AssociationID: "assoc"},
			Host:    bridge.Host{HerdrPane: "w1:p1", HerdrSocket: "/fixture/herdr.sock"},
			Session: bridge.Session{ID: "session", Name: "Pi name"},
		},
	}}}
	m := &renameMux{label: "1", windowID: "@5"}
	h, err := App(s, m.run)
	if err != nil {
		t.Fatal(err)
	}
	return s, m, h, csrfToken(t, h)
}

func postRename(h http.Handler, token, body string) *httptest.ResponseRecorder {
	return call(h, "POST", "/rename", body, "http://"+testAuthority, token, testAuthority)
}

func TestRenameHerdrTabLabelSharedByPanesAndNoPiRename(t *testing.T) {
	s, m, h, token := renameFixture(t)
	other := s.observation
	other.Snapshot.EndpointID = "other"
	other.Snapshot.AssociationID = "other-assoc"
	other.Snapshot.Host.HerdrPane = "w1:p2"
	s.others = []bridge.Observation{other}
	const name = `-café $(literal); #{window_id} <text> � 🦉`
	const jsonName = `-café $(literal); #{window_id} <text> \ufffd \ud83e\udd89`
	w := postRename(h, token, strings.Replace(testRename, "New name", jsonName, 1))
	if w.Code != 200 || w.Body.String() != "{\"status\":\"renamed\"}\n" {
		t.Fatal(w.Code, w.Body.String())
	}
	if want := [][]string{{"herdr", "tab", "rename", "w1:t1", name}}; !reflect.DeepEqual(m.mutations, want) || len(s.calls) != 0 {
		t.Fatal(m.mutations, s.calls)
	}
	w = call(h, "GET", "/sessions", "", "", "", testAuthority)
	var rows struct {
		Rows []struct {
			EndpointID  string             `json:"endpointId"`
			Observation bridge.Observation `json:"observation"`
			Label       string             `json:"label"`
			Panes       []struct {
				TabID string `json:"tabId"`
			} `json:"panes"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	count, fallback := 0, false
	for _, row := range rows.Rows {
		if row.EndpointID != "" {
			count++
			if row.Label != name || row.Observation.Snapshot.Session.Name != "Pi name" || len(row.Panes) != 1 || row.Panes[0].TabID != "w1:t1" {
				t.Fatal(row)
			}
		}
		if row.Label == "fallback" {
			fallback = true
		}
	}
	if count != 2 || !fallback {
		t.Fatal(rows)
	}
}

func TestRenameTMUXUsesSocketAndWindowIDWithLiteralName(t *testing.T) {
	s, m, h, token := renameFixture(t)
	// An identically named Herdr pane on another server is not a match.
	s.observation.Snapshot.Host.HerdrSocket = "/different/herdr.sock"
	s.observation.Snapshot.Host.TMUXPane = "%1"
	s.observation.Snapshot.Host.TMUXSocket = "/fixture/tmux.sock"
	const name = `-é #S #(literal) #[style];`
	w := postRename(h, token, strings.NewReplacer("w1:t1", "@5", "New name", name).Replace(testRename))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	want := [][]string{{"tmux", "-S", "/fixture/tmux.sock", "rename-window", "-t", "@5", "--", `-é ##S ##(literal) ###{l:[}style]\;`}}
	if !reflect.DeepEqual(m.mutations, want) || len(s.calls) != 0 {
		t.Fatal(m.mutations, s.calls)
	}
}

func TestRenameRejectsUnverifiedAndStaleTargets(t *testing.T) {
	for _, tc := range []struct {
		name  string
		body  string
		setup func(*renameSessions, *renameMux)
	}{
		{"unknown endpoint", strings.Replace(testRename, `"ep"`, `"different"`, 1), nil},
		{"old association", strings.Replace(testRename, `"assoc"`, `"old"`, 1), nil},
		{"old tab", strings.Replace(testRename, `"w1:t1"`, `"w1:t2"`, 1), nil},
		{"disconnected", testRename, func(s *renameSessions, _ *renameMux) { s.observation.Connected = false }},
		{"stale", testRename, func(s *renameSessions, _ *renameMux) { s.observation.ReceivedAt = time.Now().Add(-time.Minute) }},
		{"nonmux", testRename, func(s *renameSessions, _ *renameMux) { s.observation.Snapshot.Host = bridge.Host{} }},
		{"wrong Herdr scope", testRename, func(s *renameSessions, _ *renameMux) { s.observation.Snapshot.Host.HerdrSocket = "/wrong" }},
		{"wrong tmux scope", strings.Replace(testRename, `"w1:t1"`, `"@5"`, 1), func(s *renameSessions, _ *renameMux) {
			s.observation.Snapshot.Host = bridge.Host{TMUXPane: "%1", TMUXSocket: "/wrong"}
		}},
		{"tmux pane changed windows", strings.Replace(testRename, `"w1:t1"`, `"@5"`, 1), func(s *renameSessions, m *renameMux) {
			s.observation.Snapshot.Host = bridge.Host{TMUXPane: "%1", TMUXSocket: "/fixture/tmux.sock"}
			m.windowID = "@6"
		}},
		{"ambiguous nested", testRename, func(s *renameSessions, _ *renameMux) {
			s.observation.Snapshot.Host.TMUXPane = "%1"
			s.observation.Snapshot.Host.TMUXSocket = "/fixture/tmux.sock"
		}},
		{"competing claim", testRename, func(s *renameSessions, _ *renameMux) {
			other := s.observation
			other.Snapshot.EndpointID = "other"
			s.others = []bridge.Observation{other}
		}},
		{"changed while discovering", testRename, func(s *renameSessions, m *renameMux) {
			s.getter = func(_ string) (bridge.Observation, bool) {
				o := s.observation
				if m.reads != 0 {
					o.Snapshot.AssociationID = "new"
				}
				return o, true
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, m, h, token := renameFixture(t)
			if tc.setup != nil {
				tc.setup(s, m)
			}
			w := postRename(h, token, tc.body)
			if w.Code != 409 || len(m.mutations) != 0 || len(s.calls) != 0 {
				t.Fatal(w.Code, w.Body.String(), m.mutations, s.calls)
			}
		})
	}
}

func TestRenameValidatesBrowserBoundaryAndBodyBeforeDiscovery(t *testing.T) {
	_, m, h, token := renameFixture(t)
	for _, tc := range []struct{ origin, token string }{{"", token}, {"http://attacker.example", token}, {"http://" + testAuthority, "wrong"}} {
		w := call(h, "POST", "/rename", testRename, tc.origin, tc.token, testAuthority)
		if w.Code != 403 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	for _, body := range []string{
		strings.TrimSuffix(testRename, "}") + `,"backend":"tmux"}`,
		strings.TrimSuffix(testRename, "}") + `,"socket":"/attacker"}`,
		testRename + `{}`,
		strings.Replace(testRename, "New name", "", 1),
		strings.Replace(testRename, "New name", "   ", 1),
		strings.Replace(testRename, "New name", `bad\nname`, 1),
		strings.Replace(testRename, "New name", `bad\u0000name`, 1),
		strings.Replace(testRename, "New name", `bad\ud83ename`, 1),
		strings.Replace(testRename, "New name", `bad\udd89name`, 1),
		strings.Replace(testRename, "New name", strings.Repeat("é", 129), 1),
		strings.Replace(testRename, "New name", string([]byte{0xff}), 1),
	} {
		if w := postRename(h, token, body); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := postRename(h, token, strings.Repeat("x", 4097)); w.Code != 413 {
		t.Fatal(w.Code, w.Body.String())
	}
	if m.reads != 0 || len(m.mutations) != 0 {
		t.Fatal("invalid request reached the catalog", m.reads, m.mutations)
	}
}

func TestRenameUnconfirmedCommandNeverRetriesOrReportsSuccess(t *testing.T) {
	for _, setup := range []func(*renameMux){
		func(m *renameMux) { m.mutationErr = errors.New("fixture command timed out after send") },
		func(m *renameMux) { m.herdrOutput = `{"id":"cli:tab:rename","error":{"code":"tab_not_found"}}` },
		func(m *renameMux) { m.herdrOutput = `Usage: herdr tab rename <TAB_ID> <LABEL>...` },
		func(m *renameMux) {
			m.herdrOutput = `{"id":"cli:tab:rename","result":{"type":"tab_info","tab":{"tab_id":"w1:t2","label":"New name"}}}`
		},
	} {
		s, m, h, token := renameFixture(t)
		setup(m)
		w := postRename(h, token, testRename)
		if w.Code != 502 || !strings.Contains(w.Body.String(), "not confirmed") || len(m.mutations) != 1 || len(s.calls) != 0 {
			t.Fatal(w.Code, w.Body.String(), m.mutations, s.calls)
		}
	}
}
