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
	"unicode/utf8"

	"rai/internal/bridge"
	"rai/internal/catalog"
	"rai/internal/history"
)

//go:embed assets/index.html assets/app.js assets/model.js assets/style.css
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
func App(server sessions, authority string, run catalog.Run) (http.Handler, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(secret[:])
	reader := history.NewReader()
	mux := http.NewServeMux()
	for route, name := range map[string]string{"/": "index.html", "/app.js": "app.js", "/model.js": "model.js", "/style.css": "style.css"} {
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
	return boundary(authority, token, mux), nil
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
	if s.Session.File == nil {
		return history.Source{}, errors.New("Retained history unavailable for this ephemeral Pi session.")
	}
	return history.Source{Key: s.EndpointID + ":" + s.AssociationID, SessionID: s.Session.ID, File: *s.Session.File, Leaf: s.Session.Cutoff}, nil
}
func boundary(authority, csrf string, next http.Handler) http.Handler {
	// Browsers omit the default HTTP port from Host/serialized Origin.
	canonical := strings.TrimSuffix(authority, ":80")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
		if r.Host != authority && r.Host != canonical {
			http.Error(w, "Host not permitted", 403)
			return
		}
		origin := r.Header.Get("Origin")
		validOrigin := origin == "http://"+authority || origin == "http://"+canonical
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
