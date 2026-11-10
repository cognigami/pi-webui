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
