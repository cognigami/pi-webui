package web

import (
	"net/http"
	"time"

	"rai/internal/bridge"
	"rai/internal/catalog"
)

// Diagnostic retains the small read-only boundary for transport fixtures.
func Diagnostic(server *bridge.Server, authority string, run catalog.Run) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]string{"status": "bridge diagnostic"})
	})
	mux.HandleFunc("GET /sessions", func(w http.ResponseWriter, r *http.Request) {
		reply(w, catalog.Discover(r.Context(), server.List(), run))
	})
	mux.HandleFunc("GET /sessions/{endpoint}", func(w http.ResponseWriter, r *http.Request) {
		o, ok := server.Get(r.PathValue("endpoint"))
		if !ok {
			http.Error(w, "Target unavailable; do not redirect.", 404)
			return
		}
		o.Connected = o.Connected && time.Since(o.ReceivedAt) < 10*time.Second
		reply(w, o)
	})
	return boundary(authority, "", mux)
}
