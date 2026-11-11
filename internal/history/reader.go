// Package history reads retained Pi v3 JSONL as data, never through Pi's loading
// or model-context projection helpers. It never writes or repairs source files.
package history

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"unicode/utf8"
)

const (
	maxFileBytes     = 64 << 20
	maxRecordBytes   = 16 << 20
	maxEntries       = 100_000
	maxSources       = 1024
	maxIDBytes       = 256
	maxMetadataBytes = 1024
	pageEntries      = 32
	pageBytes        = 256 << 10
	inlineBytes      = 16 << 10
	chunkBytes       = 64 << 10
)

// Source must come from the service's selected extension association, not browser
// paths. Key identifies endpoint+association, including session/file identity.
// Leaf is an authoritative completed cutoff; nil means an empty selected path.
type Source struct {
	Key       string
	SessionID string
	File      string
	Leaf      *string
}

type Page struct {
	Entries []Entry `json:"entries"`
	Before  string  `json:"before"`
}

type Entry struct {
	ID       string          `json:"id"`
	ParentID *string         `json:"parentId"`
	Type     string          `json:"type"`
	Role     string          `json:"role,omitempty"`
	ToolName string          `json:"toolName,omitempty"`
	IsError  bool            `json:"isError,omitempty"`
	Display  *bool           `json:"display,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
	Deferred bool            `json:"deferred"`
	Bytes    int             `json:"bytes"`
}

type Chunk struct {
	Data string `json:"data"`
	Next int    `json:"next"`
	Done bool   `json:"done"`
}

// Reader serializes reads and remembers file identity/high-water size per key.
// A digest of the observed prefix also detects same-inode truncate-and-regrow
// between reads. Only constant-size observations persist for each association.
// Each request builds and discards one bounded offset index, not a transcript
// cache. Unsupported limits are explicit errors: 64 MiB files, 16 MiB records,
// 100,000 entries, 1024 associations, 256-byte IDs and 1024-byte metadata fields.
// A changed/truncated source remains invalid for that key; resynchronization
// requires a new authoritative association. Ordinary append is supported.
type Reader struct {
	mu      sync.Mutex
	sources map[string]*observed
}

type observed struct {
	file        string
	sessionID   string
	info        os.FileInfo
	size        int64
	hashedBytes int64
	digest      [sha256.Size]byte
	invalid     bool
}

type record struct {
	entry  Entry
	offset int64
}

type snapshot struct {
	file  *os.File
	index map[string]record
	path  []string // Newest to oldest, following parentId only.
}

func NewReader() *Reader {
	return &Reader{sources: make(map[string]*observed)}
}

// Page returns chronological ancestors before the supplied oldest-entry cursor.
// Before is the oldest returned ID when older ancestors remain, otherwise empty.
func (r *Reader) Page(ctx context.Context, source Source, before string) (Page, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, err := r.open(ctx, source)
	if err != nil {
		// A new Pi session has no file until its first conversation message.
		// Only an authoritative empty cutoff, with no previously observed file,
		// permits this; missing saved history and invalid cursors remain errors.
		if source.Leaf == nil && before == "" && r.sources[source.Key] == nil && errors.Is(err, os.ErrNotExist) {
			return Page{Entries: []Entry{}}, nil
		}
		return Page{}, err
	}
	defer s.file.Close()
	start := 0
	if before != "" {
		start = -1
		for i, id := range s.path {
			if id == before {
				start = i + 1
				break
			}
		}
		if start < 0 {
			return Page{}, errors.New("history cursor is not on the selected ancestry")
		}
	}
	page := Page{Entries: []Entry{}}
	for i := start; i < len(s.path) && len(page.Entries) < pageEntries; i++ {
		if err := ctx.Err(); err != nil {
			return Page{}, err
		}
		rec := s.index[s.path[i]]
		entry := rec.entry
		if !entry.Deferred {
			entry.Data = make([]byte, entry.Bytes)
			if _, err := s.file.ReadAt(entry.Data, rec.offset); err != nil {
				return Page{}, fmt.Errorf("history entry unavailable: %w", err)
			}
		}
		candidate := Page{Entries: append([]Entry{entry}, page.Entries...)}
		if i+1 < len(s.path) {
			candidate.Before = entry.ID
		}
		encoded, err := json.Marshal(candidate)
		if err != nil {
			return Page{}, fmt.Errorf("history page: %w", err)
		}
		if len(encoded) > pageBytes {
			break
		}
		page = candidate
	}
	if err := r.check(source, s.file); err != nil {
		return Page{}, err
	}
	return page, nil
}

// Chunk expands only records on the selected completed ancestry. Offsets and
// Next are byte positions in the original JSON entry (excluding its LF).
func (r *Reader) Chunk(ctx context.Context, source Source, entryID string, offset int) (Chunk, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, err := r.open(ctx, source)
	if err != nil {
		return Chunk{}, err
	}
	defer s.file.Close()
	allowed := false
	for _, id := range s.path {
		if id == entryID {
			allowed = true
			break
		}
	}
	if !allowed {
		return Chunk{}, errors.New("history entry is not on the selected ancestry")
	}
	rec := s.index[entryID]
	if offset < 0 || offset > rec.entry.Bytes {
		return Chunk{}, errors.New("invalid history chunk offset")
	}
	end := min(offset+chunkBytes, rec.entry.Bytes)
	data := make([]byte, end-offset)
	if len(data) > 0 {
		if _, err := s.file.ReadAt(data, rec.offset+int64(offset)); err != nil {
			return Chunk{}, fmt.Errorf("history entry unavailable: %w", err)
		}
		if !utf8.RuneStart(data[0]) {
			return Chunk{}, errors.New("history chunk offset is not a UTF-8 boundary")
		}
		// The indexed record is valid UTF-8, so only the final rune may be
		// split. Do not turn an unexpected in-place corruption into an empty,
		// non-advancing chunk.
		for trimmed := 0; !utf8.Valid(data) && trimmed < utf8.UTFMax-1; trimmed++ {
			data = data[:len(data)-1]
		}
		if !utf8.Valid(data) {
			return Chunk{}, errors.New("history entry changed or has invalid UTF-8")
		}
	}
	if err := ctx.Err(); err != nil {
		return Chunk{}, err
	}
	if err := r.check(source, s.file); err != nil {
		return Chunk{}, err
	}
	next := offset + len(data)
	return Chunk{Data: string(data), Next: next, Done: next == rec.entry.Bytes}, nil
}

func (r *Reader) open(ctx context.Context, source Source) (*snapshot, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if source.Key == "" || source.SessionID == "" {
		return nil, errors.New("history source is unavailable")
	}
	if len(source.Key) > maxMetadataBytes || len(source.SessionID) > maxIDBytes || len(source.File) > 4096 {
		return nil, errors.New("history source metadata exceeds supported bounds")
	}
	previous := r.sources[source.Key]
	if previous != nil && (previous.invalid || previous.file != source.File || previous.sessionID != source.SessionID) {
		return nil, errors.New("history source changed; a fresh association is required")
	}
	f, err := os.Open(source.File)
	if err != nil {
		return nil, fmt.Errorf("history source unavailable: %w", err)
	}
	ok := false
	defer func() {
		if !ok {
			f.Close()
		}
	}()
	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("history source unavailable: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("history source is not a regular file")
	}
	if previous != nil && (!os.SameFile(previous.info, info) || info.Size() < previous.size) {
		previous.invalid = true
		return nil, errors.New("history source replaced or truncated; a fresh association is required")
	}
	if previous == nil {
		if len(r.sources) >= maxSources {
			return nil, errors.New("history association count exceeds supported bound (1024)")
		}
		previous = &observed{file: source.File, sessionID: source.SessionID, info: info}
		r.sources[source.Key] = previous
	}
	previous.size = info.Size()
	if info.Size() > maxFileBytes {
		return nil, errors.New("history file exceeds supported bound (64 MiB)")
	}
	s := &snapshot{file: f, index: make(map[string]record)}
	// A fixed-size section avoids chasing a growing file. Only LF-complete
	// records are interpreted; even invalid UTF-8 in an incomplete tail waits.
	reader := bufio.NewReaderSize(io.NewSectionReader(f, 0, info.Size()), 64<<10)
	var offset int64
	var line []byte
	prefixHash := sha256.New()
	var hashed int64
	header := false
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		fragment, err := reader.ReadSlice('\n')
		// Pi appends only. Verify all previously observed bytes, including an
		// incomplete tail, before trusting a new snapshot under the same key.
		if hashed < previous.hashedBytes && hashed+int64(len(fragment)) >= previous.hashedBytes {
			boundary := int(previous.hashedBytes - hashed)
			_, _ = prefixHash.Write(fragment[:boundary])
			if !bytes.Equal(prefixHash.Sum(nil), previous.digest[:]) {
				previous.invalid = true
				return nil, errors.New("history source content changed; a fresh association is required")
			}
			_, _ = prefixHash.Write(fragment[boundary:])
		} else {
			_, _ = prefixHash.Write(fragment)
		}
		hashed += int64(len(fragment))
		if len(line)+len(fragment) > maxRecordBytes+1 {
			return nil, errors.New("history record exceeds supported bound (16 MiB)")
		}
		line = append(line, fragment...)
		if err == bufio.ErrBufferFull {
			continue
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("history read: %w", err)
		}
		raw := line[:len(line)-1]
		if !utf8.Valid(raw) {
			return nil, fmt.Errorf("history record at byte %d has invalid UTF-8", offset)
		}
		if !header {
			var h struct {
				Type    string `json:"type"`
				Version int    `json:"version"`
				ID      string `json:"id"`
			}
			if err := json.Unmarshal(raw, &h); err != nil {
				return nil, fmt.Errorf("malformed history header: %w", err)
			}
			if h.Type != "session" || h.Version != 3 {
				return nil, errors.New("unsupported history format: expected Pi session version 3")
			}
			if h.ID != source.SessionID {
				return nil, errors.New("history session ID does not match selected source")
			}
			header = true
		} else {
			if len(s.index) >= maxEntries {
				return nil, errors.New("history entry count exceeds supported bound (100000)")
			}
			entry, err := parseEntry(raw)
			if err != nil {
				return nil, fmt.Errorf("history record at byte %d: %w", offset, err)
			}
			if _, exists := s.index[entry.ID]; exists {
				return nil, errors.New("history contains duplicate entry IDs")
			}
			s.index[entry.ID] = record{entry: entry, offset: offset}
		}
		offset += int64(len(line))
		line = line[:0]
	}
	if !header {
		return nil, errors.New("history header is not yet complete")
	}
	if source.Leaf != nil {
		id := *source.Leaf
		if id == "" {
			return nil, errors.New("history cutoff ID is empty")
		}
		seen := make(map[string]bool)
		for {
			if seen[id] {
				return nil, errors.New("history ancestry contains a cycle")
			}
			seen[id] = true
			rec, exists := s.index[id]
			if !exists {
				return nil, errors.New("history cutoff or ancestor is unavailable in completed records")
			}
			s.path = append(s.path, id)
			if rec.entry.ParentID == nil {
				break
			}
			id = *rec.entry.ParentID
		}
	}
	if err := r.check(source, f); err != nil {
		return nil, err
	}
	previous.hashedBytes = hashed
	copy(previous.digest[:], prefixHash.Sum(nil))
	ok = true
	return s, nil
}

func parseEntry(raw []byte) (Entry, error) {
	var wire struct {
		Type   string          `json:"type"`
		ID     string          `json:"id"`
		Parent json.RawMessage `json:"parentId"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return Entry{}, fmt.Errorf("malformed completed JSON: %w", err)
	}
	if wire.ID == "" || len(wire.ID) > maxIDBytes || wire.Type == "" || wire.Type == "session" || len(wire.Parent) == 0 {
		return Entry{}, errors.New("invalid history entry identity/type/parent")
	}
	var parent *string
	if err := json.Unmarshal(wire.Parent, &parent); err != nil {
		return Entry{}, errors.New("invalid history parent ID")
	}
	if parent != nil && (*parent == "" || len(*parent) > maxIDBytes) {
		return Entry{}, errors.New("invalid history parent ID")
	}
	var message struct {
		Message struct {
			Role       string `json:"role"`
			ToolName   string `json:"toolName"`
			IsError    bool   `json:"isError"`
			StopReason string `json:"stopReason"`
		} `json:"message"`
	}
	// Unknown entry types retain their raw data without imposing today's
	// message shape on an unrelated future payload named "message".
	if wire.Type == "message" {
		if err := json.Unmarshal(raw, &message); err != nil {
			return Entry{}, fmt.Errorf("malformed history message: %w", err)
		}
		if message.Message.Role == "" {
			return Entry{}, errors.New("history message role is missing")
		}
	}
	var custom struct {
		Display *bool `json:"display"`
	}
	if wire.Type == "custom_message" {
		if err := json.Unmarshal(raw, &custom); err != nil {
			return Entry{}, fmt.Errorf("malformed custom message: %w", err)
		}
	}
	if len(wire.Type) > maxMetadataBytes || len(message.Message.Role) > maxMetadataBytes || len(message.Message.ToolName) > maxMetadataBytes {
		return Entry{}, errors.New("history metadata exceeds supported bound (1024 bytes)")
	}
	return Entry{ID: wire.ID, ParentID: parent, Type: wire.Type,
		Role: message.Message.Role, ToolName: message.Message.ToolName,
		IsError:  message.Message.IsError || message.Message.StopReason == "error",
		Display:  custom.Display,
		Deferred: len(raw) > inlineBytes, Bytes: len(raw)}, nil
}

// Check both the open descriptor and current pathname; never silently switch to
// a replacement inode during a read. Appending after the snapshot is harmless.
func (r *Reader) check(source Source, f *os.File) error {
	previous := r.sources[source.Key]
	current, err := f.Stat()
	if err != nil {
		return fmt.Errorf("history source unavailable: %w", err)
	}
	pathInfo, err := os.Stat(source.File)
	if err != nil {
		return fmt.Errorf("history source unavailable: %w", err)
	}
	if !os.SameFile(previous.info, pathInfo) || !os.SameFile(previous.info, current) || current.Size() < previous.size || pathInfo.Size() < previous.size {
		previous.invalid = true
		return errors.New("history source replaced or truncated; a fresh association is required")
	}
	return nil
}
