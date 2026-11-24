package web

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"rai/internal/bridge"
	"rai/internal/catalog"
	"rai/internal/history"
)

//go:embed assets/index.html assets/app.js assets/model.js assets/style.css assets/fonts/*
var assets embed.FS

type sessions interface {
	List() []bridge.Observation
	Get(string) (bridge.Observation, bool)
	Dispatch(context.Context, bridge.Control) bridge.Result
}

type conversation struct {
	Observation  bridge.Observation `json:"observation"`
	History      *history.Page      `json:"history,omitempty"`
	HistoryError string             `json:"historyError,omitempty"`
}

// App serves the browser and API in the same process. Its per-start CSRF secret
// is not authentication; deployment still requires an operator-trusted network.
func App(server sessions, run catalog.Run) (http.Handler, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(secret[:])
	reader := history.NewReader()
	mux := http.NewServeMux()
	for route, name := range map[string]string{"/": "index.html", "/app.js": "app.js", "/model.js": "model.js", "/style.css": "style.css", "/fonts/GoogleSans-Variable.ttf": "fonts/GoogleSans-Variable.ttf", "/fonts/GoogleSans-Italic-Variable.ttf": "fonts/GoogleSans-Italic-Variable.ttf", "/fonts/GoogleSans-OFL.txt": "fonts/GoogleSans-OFL.txt"} {
		mux.HandleFunc("GET "+route, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != route {
				http.NotFound(w, r)
				return
			}
			data, err := assets.ReadFile("assets/" + name)
			if err != nil {
				http.Error(w, "Asset unavailable", 500)
				return
			}
			kind := "text/html; charset=utf-8"
			if strings.HasSuffix(name, ".js") {
				kind = "text/javascript; charset=utf-8"
			}
			if strings.HasSuffix(name, ".css") {
				kind = "text/css; charset=utf-8"
			}
			if strings.HasSuffix(name, ".ttf") {
				kind = "font/ttf"
			}
			if strings.HasSuffix(name, ".txt") {
				kind = "text/plain; charset=utf-8"
			}
			w.Header().Set("Content-Type", kind)
			w.Write(data)
		})
	}
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { reply(w, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/bootstrap", func(w http.ResponseWriter, r *http.Request) { reply(w, map[string]string{"csrf": token}) })
	mux.HandleFunc("GET /sessions", func(w http.ResponseWriter, r *http.Request) {
		reply(w, catalog.Discover(r.Context(), server.List(), run))
	})
	mux.HandleFunc("GET /sessions/{endpoint}", func(w http.ResponseWriter, r *http.Request) {
		o, ok := server.Get(r.PathValue("endpoint"))
		if !ok {
			http.Error(w, "Target unavailable; select a session explicitly.", 404)
			return
		}
		o.Connected = o.Connected && time.Since(o.ReceivedAt) < 10*time.Second
		reply(w, o)
	})
	current := func(w http.ResponseWriter, r *http.Request) (bridge.Observation, bool) {
		o, ok := server.Get(r.PathValue("endpoint"))
		if !ok {
			http.Error(w, "Target unavailable; do not redirect.", 404)
			return o, false
		}
		if r.URL.Query().Get("association") != o.Snapshot.AssociationID {
			http.Error(w, "Conversation changed; refresh the verified association.", 409)
			return o, false
		}
		o.Connected = o.Connected && time.Since(o.ReceivedAt) < 10*time.Second
		return o, true
	}
	same := func(o bridge.Observation) bool {
		now, ok := server.Get(o.Snapshot.EndpointID)
		return ok && now.Snapshot.AssociationID == o.Snapshot.AssociationID && now.Snapshot.Session.ID == o.Snapshot.Session.ID
	}
	mux.HandleFunc("GET /conversation/{endpoint}", func(w http.ResponseWriter, r *http.Request) {
		o, ok := current(w, r)
		if !ok {
			return
		}
		result := conversation{Observation: o}
		source, err := historySource(o)
		if err != nil {
			result.HistoryError = err.Error()
		} else {
			page, err := reader.Page(r.Context(), source, r.URL.Query().Get("before"))
			if err != nil {
				result.HistoryError = err.Error()
			} else {
				result.History = &page
			}
		}
		if !same(o) {
			http.Error(w, "Conversation changed during history read.", 409)
			return
		}
		reply(w, result)
	})
	mux.HandleFunc("GET /conversation/{endpoint}/entries/{entry}", func(w http.ResponseWriter, r *http.Request) {
		o, ok := current(w, r)
		if !ok {
			return
		}
		source, err := historySource(o)
		if err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		offset := 0
		if raw := r.URL.Query().Get("offset"); raw != "" {
			offset, err = strconv.Atoi(raw)
			if err != nil || offset < 0 {
				http.Error(w, "Invalid entry offset", 400)
				return
			}
		}
		chunk, err := reader.Chunk(r.Context(), source, r.PathValue("entry"), offset)
		if err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		if !same(o) {
			http.Error(w, "Conversation changed during entry read.", 409)
			return
		}
		reply(w, chunk)
	})
	mux.HandleFunc("POST /control", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/json" {
			http.Error(w, "JSON required", 415)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, bridge.MaxFrame))
		if err != nil {
			http.Error(w, "Control body exceeds limit", 413)
			return
		}
		if !utf8.Valid(body) {
			http.Error(w, "Invalid UTF-8", 400)
			return
		}
		var req bridge.Control
		decoder := json.NewDecoder(strings.NewReader(string(body)))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&req); err != nil {
			http.Error(w, "Invalid control request", 400)
			return
		}
		if err = decoder.Decode(new(any)); err != io.EOF {
			http.Error(w, "Exactly one control request required", 400)
			return
		}
		// No adapter retries, outbox, or dependency on another request's completion.
		reply(w, server.Dispatch(r.Context(), req))
	})
	mux.HandleFunc("POST /rename", func(w http.ResponseWriter, r *http.Request) {
		renameTab(w, r, server, run)
	})
	return boundary(token, mux), nil
}

func renameTab(w http.ResponseWriter, r *http.Request, server sessions, run catalog.Run) {
	if r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "JSON required", 415)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil {
		http.Error(w, "Rename body exceeds limit", 413)
		return
	}
	var req struct {
		bridge.Target
		TabID string          `json:"tabId"`
		Name  json.RawMessage `json:"name"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if !utf8.Valid(body) || decoder.Decode(&req) != nil || decoder.Decode(new(any)) != io.EOF || req.EndpointID == "" || req.AssociationID == "" || req.TabID == "" {
		http.Error(w, "Invalid rename request", 400)
		return
	}
	var name string
	if json.Unmarshal(req.Name, &name) != nil || strings.TrimSpace(name) == "" || len(name) > 256 || strings.ContainsFunc(name, unicode.IsControl) ||
		strings.ContainsRune(name, utf8.RuneError) && !pairedJSONSurrogates(req.Name) {
		http.Error(w, "Use a nonblank tab name of up to 256 UTF-8 bytes without control characters.", 400)
		return
	}
	changed := func() { http.Error(w, "Cannot verify the current terminal tab; refresh and select it again.", 409) }
	o, ok := server.Get(req.EndpointID)
	if !ok || o.Snapshot.Target != req.Target || !renameConnected(o) || run == nil {
		changed()
		return
	}
	listing := catalog.Discover(r.Context(), server.List(), run)
	var row *catalog.Row
	for i := range listing.Rows {
		candidate := &listing.Rows[i]
		if candidate.EndpointID != req.EndpointID {
			continue
		}
		if row != nil {
			changed()
			return
		}
		row = candidate
	}
	if row == nil || row.Observation == nil || row.Observation.Snapshot.Target != req.Target || !renameConnected(*row.Observation) ||
		row.Integration != "connected" || row.Ownership != "single-context" || len(row.Panes) != 1 {
		changed()
		return
	}
	pane := row.Panes[0]
	host := row.Observation.Snapshot.Host
	if pane.TabID != req.TabID || pane.Scope == "" ||
		host.HerdrPane != "" && listing.Failures["herdr"] != "" ||
		host.TMUXPane != "" && listing.Failures["tmux"] != "" {
		changed()
		return
	}
	// Sharing a tab with a different pane is fine; competing observations
	// claiming this exact pane make its ownership ambiguous.
	for _, other := range listing.Rows {
		if other.EndpointID == req.EndpointID || other.Observation == nil || !renameConnected(*other.Observation) {
			continue
		}
		for _, p := range other.Panes {
			if p.Backend == pane.Backend && p.Scope == pane.Scope && p.ID == pane.ID {
				changed()
				return
			}
		}
	}
	// A bridge observation can change while the mux commands are running.
	now, ok := server.Get(req.EndpointID)
	if !ok || !renameConnected(now) || now.Snapshot.Target != req.Target || now.Snapshot.Host != host || now.Snapshot.Session.ID != row.Observation.Snapshot.Session.ID {
		changed()
		return
	}
	if err := catalog.RenameTab(r.Context(), run, pane, name); err != nil {
		http.Error(w, "Terminal tab rename was not confirmed; refresh before trying again.", 502)
		return
	}
	reply(w, map[string]string{"status": "renamed"})
}

// Go's JSON decoder silently substitutes U+FFFD for unpaired surrogates.
// Check the already decoded JSON string's escapes so a literal U+FFFD is
// accepted but a malformed escape cannot silently change the requested name.
func pairedJSONSurrogates(raw json.RawMessage) bool {
	wantLow := false
	for i := 1; i < len(raw)-1; i++ {
		var code uint64
		if raw[i] == '\\' {
			i++
			if raw[i] == 'u' {
				code, _ = strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
				i += 4
			}
		}
		if low := code >= 0xdc00 && code <= 0xdfff; low != wantLow {
			return false
		}
		wantLow = code >= 0xd800 && code <= 0xdbff
	}
	return !wantLow
}

func renameConnected(o bridge.Observation) bool {
	return o.Connected && time.Since(o.ReceivedAt) < 10*time.Second
}

func reply(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}
func historySource(o bridge.Observation) (history.Source, error) {
	s := o.Snapshot
	if !s.HistoryReady {
		return history.Source{}, errors.New("History awaits a confirmed turn boundary; an older extension may need an explicit reload.")
	}
	var file string
	if s.Session.File == nil {
		if s.Session.Cutoff != nil {
			return history.Source{}, errors.New("Retained history unavailable for this ephemeral Pi session.")
		}
	} else {
		file = *s.Session.File
	}
	return history.Source{Key: s.EndpointID + ":" + s.AssociationID, SessionID: s.Session.ID, File: file, Leaf: s.Session.Cutoff}, nil
}
func boundary(csrf string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
		origin := r.Header.Get("Origin")
		// The listener selects the trusted network interface, not browser names.
		// Origin still has to match this request's Host (with HTTP port 80 omitted).
		// No Host allowlist means this is not a DNS-rebinding defense.
		validOrigin := origin == "http://"+r.Host || origin == "http://"+strings.TrimSuffix(r.Host, ":80")
		if origin != "" && !validOrigin {
			http.Error(w, "Origin not permitted", 403)
			return
		}
		if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
			http.Error(w, "Cross-site request rejected", 403)
			return
		}
		if csrf != "" && r.Method != "GET" && r.Method != "HEAD" {
			if !validOrigin || r.Header.Get("X-RAI-CSRF") != csrf {
				http.Error(w, "Control origin/CSRF check failed; refresh before trying again.", 403)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
