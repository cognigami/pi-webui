package catalog

import (
	"context"
	"errors"
	"strings"
	"testing"

	"rai/internal/bridge"
)

func fakeRun(_ context.Context, name string, args ...string) ([]byte, error) {
	switch name + " " + strings.Join(args, " ") {
	case "herdr agent list":
		return []byte(`{"result":{"agents":[{"agent":"pi","pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1","cwd":"/a"},{"agent":"pi","pane_id":"w1:p2","tab_id":"w1:t2","workspace_id":"w1","cwd":"/b"}]}}`), nil
	case "herdr tab list --workspace w1":
		return []byte(`{"result":{"tabs":[{"tab_id":"w1:t1","label":"same"},{"tab_id":"w1:t2","label":"same"}]}}`), nil
	case "tmux list-panes -a -F #{pane_id}":
		return []byte("%1\n%2\n"), nil
	}
	if name == "tmux" && len(args) == 5 {
		values := map[string]string{"#{socket_path}": "/tmux.sock", "#{window_name}": "a\tb\nc", "#{pane_title}": "title", "#{session_name}": "group", "#{pane_current_path}": "/a", "#{pane_current_command}": "pi"}
		return []byte(values[args[4]] + "\n"), nil
	}
	return nil, errors.New("unexpected fixture command")
}
func TestLabelsDuplicatesAndExactTMUXFields(t *testing.T) {
	panes, err := Herdr(context.Background(), fakeRun, "/herdr.sock")
	if err != nil {
		t.Fatal(err)
	}
	if len(panes) != 2 || panes[0].Label != "same" || panes[0].ID == panes[1].ID {
		t.Fatal(panes)
	}
	tmux, err := TMUX(context.Background(), fakeRun)
	if err != nil {
		t.Fatal(err)
	}
	if len(tmux) != 2 || tmux[0].Label != "a\tb\nc" {
		t.Fatal(tmux)
	}
}
func TestNodeHostedPiRequiresForegroundProcessEvidence(t *testing.T) {
	for _, tc := range []struct {
		process    string
		identified bool
	}{
		{"101 Ss+ pi\n102 S+ log\n", true},
		{"101 S pi\n", false},
		{"101 S+ node\n", false},
		{"101 S+ other-pi\n", false},
	} {
		run := func(ctx context.Context, name string, args ...string) ([]byte, error) {
			if name == "ps" {
				if strings.Join(args, " ") != "-t /dev/ttyfixture -o pid=,stat=,comm=" {
					t.Fatalf("not tty-scoped: %v", args)
				}
				return []byte(tc.process), nil
			}
			if name == "tmux" && len(args) == 5 {
				if args[4] == "#{pane_current_command}" {
					return []byte("node\n"), nil
				}
				if args[4] == "#{pane_tty}" {
					return []byte("/dev/ttyfixture\n"), nil
				}
			}
			return fakeRun(ctx, name, args...)
		}
		panes, err := TMUX(context.Background(), run)
		if err != nil || len(panes) != 2 {
			t.Fatal(panes, err)
		}
		for _, p := range panes {
			if p.Identified != tc.identified {
				t.Fatalf("%q: %+v", tc.process, p)
			}
		}
	}
}
func TestNodeProcessInspectionFailureIsPartialDiscovery(t *testing.T) {
	run := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if name == "ps" {
			return nil, errors.New("fixture process metadata unavailable")
		}
		if name == "tmux" && len(args) == 5 {
			if args[4] == "#{pane_current_command}" {
				return []byte("node\n"), nil
			}
			if args[4] == "#{pane_tty}" {
				return []byte("/dev/ttyfixture\n"), nil
			}
		}
		return fakeRun(ctx, name, args...)
	}
	listing := Discover(context.Background(), nil, run)
	if listing.Failures["tmux"] == "" {
		t.Fatal("process failure presented as complete discovery")
	}
}
func TestParticipationAndNestedContextNeverDuplicateEndpoint(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "/herdr.sock")
	observations := []bridge.Observation{{Snapshot: bridge.Snapshot{Target: bridge.Target{EndpointID: "one"}, Host: bridge.Host{HerdrPane: "w1:p1", HerdrSocket: "/herdr.sock", TMUXPane: "%1", TMUXSocket: "/tmux.sock"}}}}
	listing := Discover(context.Background(), observations, fakeRun)
	count := 0
	for _, row := range listing.Rows {
		if row.EndpointID == "one" {
			count++
			if row.Ownership != "ambiguous" || len(row.Panes) != 2 {
				t.Fatal(row)
			}
		}
	}
	if count != 1 || len(listing.Rows) != 3 {
		t.Fatal(listing)
	}
}
func TestPartialDiscoveryRetainsKnownRows(t *testing.T) {
	listing := Discover(context.Background(), nil, func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if name == "tmux" {
			return nil, errors.New("fixture missing")
		}
		return fakeRun(ctx, name, args...)
	})
	if len(listing.Rows) != 2 || listing.Failures["tmux"] == "" || listing.Failures["herdr"] != "" {
		t.Fatal(listing)
	}
	for _, row := range listing.Rows {
		if row.Integration != "unavailable" {
			t.Fatal(row)
		}
	}
}
func TestDisplayNamePrecedenceDoesNotEstablishOwnership(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "/herdr.sock")
	for _, tc := range []struct {
		name, backend, muxName, piName, want, ownership string
	}{
		{"neither-name", "none", "", "", "Unnamed session", "unverified"},
		{"pi-only", "none", "", "Research", "Research", "unverified"},
		{"matching-name-is-not-ownership", "none", "same", "same", "same", "unverified"},
		{"herdr-first", "herdr", "Mux name", "Pi name", "Mux name", "single-context"},
		{"herdr-missing", "herdr", "", "Pi name", "Pi name", "single-context"},
		{"herdr-no-names", "herdr", "", "", "Unnamed session", "single-context"},
		{"node-is-a-name", "herdr", "node", "Pi name", "node", "single-context"},
		{"number-is-a-name", "herdr", "1", "Pi name", "1", "single-context"},
		{"literal-placeholder-is-a-name", "herdr", "Unnamed session", "Pi name", "Unnamed session", "single-context"},
		{"tmux-title-first", "tmux", "Mux title", "Pi name", "Mux title", "single-context"},
		{"tmux-missing", "tmux", "", "Pi name", "Pi name", "single-context"},
		{"ambiguous-remains-ambiguous", "both", "Mux name", "Pi name", "Ambiguous multiplexer context", "ambiguous"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := bridge.Host{Cwd: "/a"}
			if tc.backend == "herdr" || tc.backend == "both" {
				h.HerdrPane = "w1:p1"
				h.HerdrSocket = "/herdr.sock"
			}
			if tc.backend == "tmux" || tc.backend == "both" {
				h.TMUXPane = "%1"
				h.TMUXSocket = "/tmux.sock"
			}
			o := bridge.Observation{Snapshot: bridge.Snapshot{Target: bridge.Target{EndpointID: "stable", AssociationID: "branch"}, Host: h, Session: bridge.Session{ID: "session", Name: tc.piName}}}
			run := func(ctx context.Context, name string, args ...string) ([]byte, error) {
				if name == "tmux" && len(args) == 5 {
					if args[4] == "#{window_name}" {
						return []byte("\n"), nil
					}
					if args[4] == "#{pane_title}" {
						return []byte(tc.muxName + "\n"), nil
					}
				}
				data, err := fakeRun(ctx, name, args...)
				return []byte(strings.ReplaceAll(string(data), `"same"`, `"`+tc.muxName+`"`)), err
			}
			listing := Discover(context.Background(), []bridge.Observation{o}, run)
			var found bool
			for _, row := range listing.Rows {
				if row.EndpointID == "stable" {
					found = true
					if row.Label != tc.want || row.Ownership != tc.ownership || row.Observation.Snapshot.AssociationID != "branch" || row.Observation.Snapshot.Session.ID != "session" {
						t.Fatalf("unexpected name/identity: %+v", row)
					}
				} else if tc.muxName == "" && row.Label != "Unnamed session" {
					t.Fatal("unnamed discovered pane borrowed a Pi name", row)
				}
			}
			if !found {
				t.Fatal("lost endpoint")
			}
		})
	}
}
func TestPiNameRenameDoesNotCreateOwnershipOrChangeIdentity(t *testing.T) {
	o := bridge.Observation{Snapshot: bridge.Snapshot{Target: bridge.Target{EndpointID: "stable", AssociationID: "branch"}, Session: bridge.Session{ID: "session", Name: "First"}}}
	missing := func(context.Context, string, ...string) ([]byte, error) { return nil, errors.New("no multiplexer") }
	for _, name := range []string{"First", "Renamed", ""} {
		o.Snapshot.Session.Name = name
		listing := Discover(context.Background(), []bridge.Observation{o}, missing)
		if len(listing.Rows) != 1 {
			t.Fatal(listing)
		}
		row := listing.Rows[0]
		want := name
		if want == "" {
			want = "Unnamed session"
		}
		if row.Label != want || row.Ownership != "unverified" || row.EndpointID != "stable" || row.Observation.Snapshot.AssociationID != "branch" {
			t.Fatal(row)
		}
	}
}
func TestRenameDoesNotChangeEndpointOrAssociation(t *testing.T) {
	t.Setenv("HERDR_SOCKET_PATH", "/herdr.sock")
	observations := []bridge.Observation{{Snapshot: bridge.Snapshot{Target: bridge.Target{EndpointID: "stable", AssociationID: "branch"}, Host: bridge.Host{HerdrPane: "w1:p1", HerdrSocket: "/herdr.sock"}}}}
	run := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		data, err := fakeRun(ctx, name, args...)
		return []byte(strings.ReplaceAll(string(data), "same", "renamed")), err
	}
	listing := Discover(context.Background(), observations, run)
	for _, row := range listing.Rows {
		if row.EndpointID == "stable" {
			if row.Label != "renamed" || row.Observation.Snapshot.AssociationID != "branch" {
				t.Fatal(row)
			}
			return
		}
	}
	t.Fatal("lost endpoint")
}
