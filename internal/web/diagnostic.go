// Package web exposes only read-only diagnostics until P5's browser control boundary.
package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"rai/internal/bridge"
	"rai/internal/catalog"
)

func Diagnostic(server *bridge.Server, authority string, run catalog.Run) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "bridge diagnostic only; live validation pending"})
	})
	mux.HandleFunc("GET /sessions", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(catalog.Discover(r.Context(), server.List(), run))
	})
	mux.HandleFunc("GET /sessions/{endpoint}", func(w http.ResponseWriter, r *http.Request) {
		o, ok := server.Get(r.PathValue("endpoint"))
		if !ok {
			http.Error(w, "Target unavailable; do not redirect.", http.StatusNotFound)
			return
		}
		if time.Since(o.ReceivedAt) > 10*time.Second {
			o.Connected = false
		}
		json.NewEncoder(w).Encode(o)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != authority {
			http.Error(w, "Host not permitted", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+authority {
			http.Error(w, "Origin not permitted", http.StatusForbidden)
			return
		}
		if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
			http.Error(w, "Cross-site request rejected", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}
