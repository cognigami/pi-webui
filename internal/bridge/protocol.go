// Package bridge implements the private, local RAI socket boundary.
package bridge

import "encoding/json"

const Version = 1
const MaxFrame = 1 << 20

type Target struct {
	EndpointID    string `json:"endpointId"`
	AssociationID string `json:"associationId"`
}
type Host struct {
	PID         int    `json:"pid"`
	Cwd         string `json:"cwd"`
	Mode        string `json:"mode"`
	HerdrPane   string `json:"herdrPane,omitempty"`
	HerdrSocket string `json:"herdrSocket,omitempty"`
	TMUXPane    string `json:"tmuxPane,omitempty"`
	TMUXSocket  string `json:"tmuxSocket,omitempty"`
}
type EntryRef struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parentId"`
}
type Session struct {
	ID     string     `json:"id"`
	File   *string    `json:"file"`
	Leaf   *string    `json:"leaf"`
	Cutoff *string    `json:"cutoff"`
	Sample []EntryRef `json:"sample"`
}
type State struct {
	Activity           string `json:"activity"`
	Pending            bool   `json:"pending"`
	Prompt             string `json:"prompt,omitempty"`
	ManualCompaction   bool   `json:"manualCompaction"`
	SendSupported      bool   `json:"sendSupported"`
	ControlUnavailable string `json:"controlUnavailable,omitempty"`
}
type Snapshot struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	Target
	Seq             uint64          `json:"seq"`
	ObservedAt      string          `json:"observedAt"`
	Host            Host            `json:"host"`
	Session         Session         `json:"session"`
	State           State           `json:"state"`
	Provisional     json.RawMessage `json:"provisional"`
	PersistedIDs    []string        `json:"persistedIds"`
	Gap             bool            `json:"gap"`
	HistoryReady    bool            `json:"historyReady"`
	TurnOpen        bool            `json:"turnOpen"`
	LiveUnavailable string          `json:"liveUnavailable,omitempty"`
}
type Control struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	Target
	RequestID string `json:"requestId"`
	Operation string `json:"operation"`
	Text      string `json:"text,omitempty"`
}
type Result struct {
	Type      string `json:"type"`
	Version   int    `json:"version"`
	RequestID string `json:"requestId"`
	Status    string `json:"status"`
	Detail    string `json:"detail"`
}

func Rejected(id, reason string) Result {
	return Result{Type: "result", Version: Version, RequestID: id, Status: "rejected", Detail: reason}
}
func Unknown(id string) Result {
	return Result{Type: "result", Version: Version, RequestID: id, Status: "outcome_unknown", Detail: "Check the conversation or terminal before sending again."}
}
