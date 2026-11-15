// Package catalog retrieves labels only. It never transports terminal input/output.
package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"rai/internal/bridge"
)

type Run func(context.Context, string, ...string) ([]byte, error)

func Command(ctx context.Context, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	// Limit output in memory; no shell interpolation or transcript logging.
	cmd := exec.CommandContext(ctx, name, args...)
	var out limitedBuffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s discovery failed: %w", name, err)
	}
	return out.data, nil
}

type limitedBuffer struct{ data []byte }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if len(b.data)+len(p) > 4<<20 {
		return 0, errors.New("discovery output exceeded bound")
	}
	b.data = append(b.data, p...)
	return len(p), nil
}

type Pane struct {
	Backend    string `json:"backend"`
	Scope      string `json:"scope"`
	ID         string `json:"id"`
	Label      string `json:"label"`
	Context    string `json:"context"`
	Cwd        string `json:"cwd"`
	Identified bool   `json:"-"`
}
type Row struct {
	EndpointID  string              `json:"endpointId,omitempty"`
	Label       string              `json:"label"`
	Context     string              `json:"context"`
	Integration string              `json:"integration"`
	Ownership   string              `json:"ownership"`
	Panes       []Pane              `json:"panes"`
	Observation *bridge.Observation `json:"observation,omitempty"`
}
type Listing struct {
	Rows     []Row             `json:"rows"`
	Failures map[string]string `json:"failures"`
	Coverage []string          `json:"coverage"`
}
type herdrAgent struct {
	Agent     string `json:"agent"`
	Pane      string `json:"pane_id"`
	Tab       string `json:"tab_id"`
	Workspace string `json:"workspace_id"`
	Name      string `json:"name"`
	Cwd       string `json:"cwd"`
}

func Herdr(ctx context.Context, run Run, scope string) ([]Pane, error) {
	data, err := run(ctx, "herdr", "agent", "list")
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Result struct {
			Agents []herdrAgent `json:"agents"`
		} `json:"result"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, err
	}
	if envelope.Result.Agents == nil {
		return nil, errors.New("unsupported herdr discovery response")
	}
	workspaces := map[string]bool{}
	for _, a := range envelope.Result.Agents {
		if a.Agent == "pi" {
			workspaces[a.Workspace] = true
		}
	}
	labels := map[string]string{}
	var failures []error
	for workspace := range workspaces {
		data, err = run(ctx, "herdr", "tab", "list", "--workspace", workspace)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		var tabs struct {
			Result struct {
				Tabs []struct {
					ID    string `json:"tab_id"`
					Label string `json:"label"`
				} `json:"tabs"`
			} `json:"result"`
		}
		if err = json.Unmarshal(data, &tabs); err != nil {
			failures = append(failures, err)
			continue
		}
		if tabs.Result.Tabs == nil {
			failures = append(failures, errors.New("unsupported herdr tab response"))
			continue
		}
		for _, tab := range tabs.Result.Tabs {
			labels[tab.ID] = tab.Label
		}
	}
	panes := []Pane{}
	for _, a := range envelope.Result.Agents {
		if a.Agent != "pi" {
			continue
		}
		label := a.Name
		if label == "" {
			label = labels[a.Tab]
		}
		panes = append(panes, Pane{"herdr", scope, a.Pane, label, a.Workspace + " · " + a.Pane, a.Cwd, true})
	}
	return panes, errors.Join(failures...)
}

// Enumerate only stable IDs; fetch arbitrary labels individually so tabs and
// embedded newlines cannot change field boundaries. No shell parsing.
const tmuxFormat = "#{pane_id}"

func TMUX(ctx context.Context, run Run) ([]Pane, error) {
	data, err := run(ctx, "tmux", "list-panes", "-a", "-F", tmuxFormat)
	if err != nil {
		return nil, err
	}
	panes := []Pane{}
	ids := strings.Fields(string(data))
	if len(ids) > 256 {
		return nil, errors.New("tmux discovery exceeds 256-pane bound")
	}
	for _, id := range ids {
		if !strings.HasPrefix(id, "%") || len(id) < 2 || strings.Trim(id[1:], "0123456789") != "" {
			return nil, errors.New("unsupported tmux pane ID")
		}
		values := []string{}
		for _, format := range []string{"#{socket_path}", "#{window_name}", "#{pane_title}", "#{session_name}", "#{pane_current_path}", "#{pane_current_command}"} {
			value, err := run(ctx, "tmux", "display-message", "-p", "-t", id, format)
			if err != nil {
				return panes, err
			}
			values = append(values, strings.TrimSuffix(string(value), "\n"))
		}
		label := values[1]
		if label == "" {
			label = values[2]
		}
		pane := Pane{"tmux", values[0], id, label, values[3] + " · " + id, values[4], values[5] == "pi"}
		// tmux can report Node's executable name even when Pi's process command
		// is pi. Inspect only this pane's foreground processes, never its text.
		if values[5] == "node" || values[5] == "nodejs" {
			identified, err := nodePi(ctx, run, id)
			pane.Identified = identified
			panes = append(panes, pane)
			if err != nil {
				return panes, err
			}
		} else {
			panes = append(panes, pane)
		}
	}
	return panes, nil
}
func nodePi(ctx context.Context, run Run, paneID string) (bool, error) {
	tty, err := run(ctx, "tmux", "display-message", "-p", "-t", paneID, "#{pane_tty}")
	if err != nil {
		return false, err
	}
	terminal := strings.TrimSuffix(string(tty), "\n")
	if !strings.HasPrefix(terminal, "/dev/") || strings.ContainsAny(terminal, "\r\n") {
		return false, errors.New("tmux pane has unavailable terminal metadata")
	}
	data, err := run(ctx, "ps", "-t", terminal, "-o", "pid=,stat=,comm=")
	if err != nil {
		return false, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 3 && strings.Contains(fields[1], "+") && filepath.Base(fields[2]) == "pi" {
			return true, nil
		}
	}
	return false, nil
}

// Names are display metadata only; they never establish a pane match or ownership.
func displayName(muxName, piName string) string {
	if muxName != "" {
		return muxName
	}
	if piName != "" {
		return piName
	}
	return "Unnamed session"
}

func Discover(ctx context.Context, observations []bridge.Observation, run Run) Listing {
	result := Listing{Rows: []Row{}, Failures: map[string]string{}, Coverage: []string{
		"Herdr: inherited/default server only. tmux: default/inherited server only.",
		"Unintegrated tmux candidates require command pi, or Node with an exact pi foreground process on that pane's tty; other launchers/nesting may be unidentifiable.",
		"Inherited nested pane context is not proof of innermost ownership; ambiguous labels require live validation.",
	}}
	scope := os.Getenv("HERDR_SOCKET_PATH")
	herdr, err := Herdr(ctx, run, scope)
	if err != nil {
		result.Failures["herdr"] = err.Error()
	}
	tmux, err := TMUX(ctx, run)
	if err != nil {
		result.Failures["tmux"] = err.Error()
	}
	panes := append(herdr, tmux...)
	claimed := map[int]bool{}
	for i := range observations {
		o := observations[i]
		row := Row{EndpointID: o.Snapshot.EndpointID, Label: displayName("", o.Snapshot.Session.Name), Context: o.Snapshot.Host.Cwd, Integration: "connected", Ownership: "unverified", Panes: []Pane{}, Observation: &o}
		h := o.Snapshot.Host
		for n, p := range panes {
			match := p.Backend == "herdr" && h.HerdrPane != "" && h.HerdrPane == p.ID && h.HerdrSocket == p.Scope ||
				p.Backend == "tmux" && h.TMUXPane != "" && h.TMUXPane == p.ID && h.TMUXSocket == p.Scope
			if match {
				row.Panes = append(row.Panes, p)
				claimed[n] = true
			}
		}
		if len(row.Panes) == 1 {
			row.Label = displayName(row.Panes[0].Label, o.Snapshot.Session.Name)
			row.Context = row.Panes[0].Context + " · " + h.Cwd
			row.Ownership = "single-context"
		}
		if len(row.Panes) > 1 {
			row.Ownership = "ambiguous"
			row.Label = "Ambiguous multiplexer context"
		}
		result.Rows = append(result.Rows, row)
	}
	for n, p := range panes {
		if !claimed[n] && p.Identified {
			result.Rows = append(result.Rows, Row{Label: displayName(p.Label, ""), Context: p.Context, Integration: "unavailable", Ownership: "discovered", Panes: []Pane{p}})
		}
	}
	sort.SliceStable(result.Rows, func(i, j int) bool {
		a, b := result.Rows[i], result.Rows[j]
		if a.Label != b.Label {
			return a.Label < b.Label
		}
		if a.Context != b.Context {
			return a.Context < b.Context
		}
		return a.EndpointID < b.EndpointID
	})
	return result
}
