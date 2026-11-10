package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rai/internal/bridge"
)

func TestDiagnosticSecurityAndNoHTTPControls(t *testing.T) {
	handler := Diagnostic(bridge.New(), "127.0.0.1:8484", func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("fixture unavailable")
	})
	for _, tc := range []struct {
		method, path, host, origin string
		want                       int
	}{
		{"GET", "/health", "127.0.0.1:8484", "", 200},
		{"GET", "/sessions", "127.0.0.1:8484", "http://127.0.0.1:8484", 200},
		{"GET", "/health", "attacker.example", "", 403},
		{"GET", "/health", "127.0.0.1:8484", "https://attacker.example", 403},
		{"POST", "/sessions", "127.0.0.1:8484", "", 405},
		{"POST", "/send", "127.0.0.1:8484", "", 404},
		{"GET", "/sessions/missing", "127.0.0.1:8484", "", 404},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.Host = tc.host
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s %s: %d", tc.method, tc.path, w.Code)
		}
		if w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("permissive CORS")
		}
		if tc.path == "/sessions" && w.Code == http.StatusOK && !strings.Contains(w.Body.String(), "failures") {
			t.Fatal("failure presented as authoritative empty list")
		}
	}
}
