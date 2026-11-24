package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
)

// RenameTab acts once on a pane selected from fresh discovery, not a browser
// target. The commands themselves can change only the explicit tab/window.
func RenameTab(ctx context.Context, run Run, pane Pane, name string) error {
	if pane.Scope == "" || pane.TabID == "" {
		return errors.New("missing tab scope or ID")
	}
	switch pane.Backend {
	case "herdr":
		if pane.Scope != os.Getenv("HERDR_SOCKET_PATH") {
			return errors.New("Herdr socket changed")
		}
		// Herdr takes the tab ID and remaining label verbatim, without a
		// separate end-of-options token for this subcommand.
		data, err := run(ctx, "herdr", "tab", "rename", pane.TabID, name)
		if err != nil {
			return err
		}
		var response struct {
			ID     string `json:"id"`
			Result struct {
				Type string `json:"type"`
				Tab  struct {
					ID    string `json:"tab_id"`
					Label string `json:"label"`
				} `json:"tab"`
			} `json:"result"`
			Error json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal(data, &response); err != nil || response.ID != "cli:tab:rename" || response.Error != nil ||
			response.Result.Type != "tab_info" || response.Result.Tab.ID != pane.TabID || response.Result.Tab.Label != name {
			return errors.New("Herdr did not confirm the tab rename")
		}
		return nil
	case "tmux":
		if !tmuxID(pane.TabID, '@') {
			return errors.New("invalid tmux window ID")
		}
		// tmux parses even direct argv for trailing command separators and
		// expands formats in the new window name. Escape both layers.
		name = tmuxRenameFormat.Replace(name)
		if strings.HasSuffix(name, ";") {
			name = strings.TrimSuffix(name, ";") + `\;`
		}
		_, err := run(ctx, "tmux", "-S", pane.Scope, "rename-window", "-t", pane.TabID, "--", name)
		return err
	default:
		return errors.New("unsupported multiplexer")
	}
}

// The format parser treats even doubled hashes before '[' as style syntax.
// Expand that bracket from a fixed literal expression instead.
var tmuxRenameFormat = strings.NewReplacer("#[", "###{l:[}", "#", "##")
