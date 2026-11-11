package history

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func pointer(s string) *string { return &s }

func header(id string) string {
	return fmt.Sprintf(`{"type":"session","version":3,"id":%q}`, id)
}

func entry(id string, parent *string, kind string, fields string) string {
	p, _ := json.Marshal(parent)
	return fmt.Sprintf(`{"type":%q,"id":%q,"parentId":%s%s}`, kind, id, p, fields)
}

func message(id string, parent *string, text string) string {
	var content bytes.Buffer
	encoder := json.NewEncoder(&content)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(text)
	return entry(id, parent, "message", `,"message":{"role":"user","content":`+strings.TrimSuffix(content.String(), "\n")+`}`)
}

func fixture(t *testing.T, sessionID string, leaf *string, records ...string) Source {
	t.Helper()
	path := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(append([]string{header(sessionID)}, records...), "\n")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	return Source{Key: sessionID + "/association", SessionID: sessionID, File: path, Leaf: leaf}
}

func appendBytes(t *testing.T, path string, data []byte) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.Write(data); err != nil {
		t.Fatal(err)
	}
}

func pageIDs(page Page) []string {
	ids := make([]string, 0, len(page.Entries))
	for _, e := range page.Entries {
		ids = append(ids, e.ID)
	}
	return ids
}

func TestUncreatedFileIsEmptyOnlyForAuthoritativeEmptyUnobservedPath(t *testing.T) {
	r := NewReader()
	source := Source{Key: "fresh", SessionID: "session", File: filepath.Join(t.TempDir(), "not-created-yet.jsonl")}
	page, err := r.Page(context.Background(), source, "")
	if err != nil || len(page.Entries) != 0 || page.Entries == nil {
		t.Fatal(page, err)
	}
	if _, err := os.Stat(source.File); !os.IsNotExist(err) {
		t.Fatal("reader created a source", err)
	}
	if _, err := r.Page(context.Background(), source, "old-cursor"); err == nil {
		t.Fatal("empty path accepted cursor")
	}
	source.Leaf = pointer("saved")
	if _, err := r.Page(context.Background(), source, ""); err == nil {
		t.Fatal("missing saved history treated as empty")
	}
	if err := os.WriteFile(source.File, []byte(header("session")+"\n"+message("saved", nil, "first message")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	page, err = r.Page(context.Background(), source, "")
	if err != nil || len(page.Entries) != 1 {
		t.Fatal(page, err)
	}
	if err := os.Remove(source.File); err != nil {
		t.Fatal(err)
	}
	source.Leaf = nil
	if _, err := r.Page(context.Background(), source, ""); err == nil {
		t.Fatal("previously observed missing file treated as new")
	}
}
func TestSelectedAncestryRetainsOriginals(t *testing.T) {
	root := message("root", nil, "original retained text")
	sibling := message("sibling", pointer("root"), "abandoned branch secret")
	compaction := entry("compact", pointer("root"), "compaction", `,"summary":"summary only","firstKeptEntryId":"compact"`)
	edit := entry("edit", pointer("compact"), "context_edit", `,"targetId":"root","replacement":null`)
	branch := entry("branch", pointer("edit"), "branch_summary", `,"fromId":"sibling","summary":"do not follow fromId"`)
	unknown := entry("unknown", pointer("branch"), "future_kind", `,"message":["unknown future shape"],"extra":{"x":true}`)
	tool := entry("tool", pointer("unknown"), "message", `,"message":{"role":"toolResult","toolName":"test","isError":true,"content":[{"type":"text","text":"failure"}]}`)
	source := fixture(t, "session", pointer("tool"), root, sibling, compaction, edit, branch, unknown, tool)
	before, err := os.ReadFile(source.File)
	if err != nil {
		t.Fatal(err)
	}
	statBefore, err := os.Stat(source.File)
	if err != nil {
		t.Fatal(err)
	}
	r := NewReader()
	page, err := r.Page(context.Background(), source, "")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"root", "compact", "edit", "branch", "unknown", "tool"}
	if !reflect.DeepEqual(pageIDs(page), want) || page.Before != "" {
		t.Fatalf("wrong ancestry: %+v", page)
	}
	for i, raw := range []string{root, compaction, edit, branch, unknown, tool} {
		if string(page.Entries[i].Data) != raw {
			t.Fatalf("original raw entry changed at %d", i)
		}
	}
	result := page.Entries[5]
	if result.Role != "toolResult" || result.ToolName != "test" || !result.IsError {
		t.Fatalf("missing error metadata: %+v", result)
	}
	if _, err := r.Page(context.Background(), source, "sibling"); err == nil {
		t.Fatal("accepted sibling cursor")
	}
	if _, err := r.Chunk(context.Background(), source, "sibling", 0); err == nil {
		t.Fatal("expanded sibling")
	}
	source.Leaf = pointer("root")
	page, err = r.Page(context.Background(), source, "")
	if err != nil || !reflect.DeepEqual(pageIDs(page), []string{"root"}) {
		t.Fatalf("cutoff ignored: %+v, %v", page, err)
	}
	if _, err := r.Chunk(context.Background(), source, "tool", 0); err == nil {
		t.Fatal("expanded beyond cutoff")
	}
	source.Leaf = nil
	page, err = r.Page(context.Background(), source, "")
	if err != nil || len(page.Entries) != 0 || page.Before != "" {
		t.Fatalf("nil cutoff must be empty, not latest: %+v, %v", page, err)
	}
	if _, err := r.Chunk(context.Background(), source, "root", 0); err == nil {
		t.Fatal("nil cutoff expanded content")
	}
	after, err := os.ReadFile(source.File)
	if err != nil {
		t.Fatal(err)
	}
	statAfter, err := os.Stat(source.File)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) || statBefore.Size() != statAfter.Size() || !statBefore.ModTime().Equal(statAfter.ModTime()) {
		t.Fatal("reader mutated source")
	}
}

func TestForksReuseEntryIDsWithoutCrossSessionContent(t *testing.T) {
	r := NewReader()
	first := fixture(t, "first", pointer("same"), message("same", nil, "first original"))
	fork := fixture(t, "fork", pointer("same"), message("same", nil, "fork original"))
	for _, source := range []Source{first, fork, first} {
		page, err := r.Page(context.Background(), source, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Entries) != 1 || !strings.Contains(string(page.Entries[0].Data), source.SessionID+" original") {
			t.Fatalf("cross-session ID reuse: %+v", page)
		}
	}
	fork.Key = first.Key
	if _, err := r.Page(context.Background(), fork, ""); err == nil {
		t.Fatal("accepted changed association identity")
	}
}

func TestBoundedPagingAndFullExpansion(t *testing.T) {
	for _, text := range []string{"small", strings.Repeat("x", 12<<10), strings.Repeat("<", 12<<10)} {
		t.Run(fmt.Sprintf("text-bytes-%d-escaped-%t", len(text), strings.Contains(text, "<")), func(t *testing.T) {
			var records []string
			var parent *string
			for i := 0; i < 75; i++ {
				id := fmt.Sprintf("e%d", i)
				records = append(records, message(id, parent, text))
				parent = pointer(id)
			}
			source := fixture(t, "pages", parent, records...)
			r := NewReader()
			var collected []string
			cursor := ""
			for rounds := 0; ; rounds++ {
				if rounds > 75 {
					t.Fatal("pagination did not advance")
				}
				page, err := r.Page(context.Background(), source, cursor)
				if err != nil {
					t.Fatal(err)
				}
				encoded, err := json.Marshal(page)
				if err != nil {
					t.Fatal(err)
				}
				if len(page.Entries) == 0 || len(page.Entries) > 32 || len(encoded) > 256<<10 {
					t.Fatalf("page bounds: entries=%d bytes=%d", len(page.Entries), len(encoded))
				}
				for _, e := range page.Entries {
					if e.Deferred || len(e.Data) == 0 {
						t.Fatal("small entry should be inline")
					}
				}
				collected = append(pageIDs(page), collected...)
				if page.Before == "" {
					break
				}
				if page.Before != page.Entries[0].ID || page.Before == cursor {
					t.Fatal("invalid before cursor")
				}
				cursor = page.Before
			}
			if len(collected) != len(records) {
				t.Fatalf("lost/repeated entries: %d", len(collected))
			}
			for i, id := range collected {
				if id != fmt.Sprintf("e%d", i) {
					t.Fatalf("wrong chronological ID %d: %s", i, id)
				}
			}
		})
	}

	// Keep literal multibyte runes in the file so 64 KiB chunks genuinely split
	// UTF-8 sequences, rather than JSON's ASCII escape representation.
	raw := entry("large", nil, "message", `,"message":{"role":"toolResult","toolName":"large_tool","isError":true,"content":[{"type":"text","text":"`+strings.Repeat("🧪é界", 35_000)+`"}]}`)
	source := fixture(t, "large", pointer("large"), raw)
	r := NewReader()
	page, err := r.Page(context.Background(), source, "")
	if err != nil {
		t.Fatal(err)
	}
	e := page.Entries[0]
	if !e.Deferred || len(e.Data) != 0 || e.Bytes != len(raw) || !e.IsError || e.ToolName != "large_tool" || e.Role != "toolResult" {
		t.Fatalf("bad deferred metadata: %+v", e)
	}
	var expanded strings.Builder
	offset := 0
	for rounds := 0; ; rounds++ {
		if rounds > 20 {
			t.Fatal("chunks did not advance")
		}
		chunk, err := r.Chunk(context.Background(), source, "large", offset)
		if err != nil {
			t.Fatal(err)
		}
		if len(chunk.Data) > 64<<10 || !utf8.ValidString(chunk.Data) || chunk.Next != offset+len(chunk.Data) || chunk.Next <= offset {
			t.Fatalf("bad chunk at %d: next=%d bytes=%d", offset, chunk.Next, len(chunk.Data))
		}
		expanded.WriteString(chunk.Data)
		offset = chunk.Next
		if chunk.Done {
			break
		}
	}
	if expanded.String() != raw || !json.Valid([]byte(expanded.String())) {
		t.Fatal("full expansion did not retain original JSON")
	}
	end, err := r.Chunk(context.Background(), source, "large", len(raw))
	if err != nil || !end.Done || end.Next != len(raw) || end.Data != "" {
		t.Fatalf("end offset: %+v, %v", end, err)
	}
	insideRune := strings.Index(raw, "🧪") + 1
	for _, invalid := range []int{-1, len(raw) + 1, insideRune} {
		if _, err := r.Chunk(context.Background(), source, "large", invalid); err == nil {
			t.Fatalf("accepted invalid offset %d", invalid)
		}
	}
}

func TestIncompleteUTF8TailWaitsForLF(t *testing.T) {
	first := message("first", nil, "complete")
	second := entry("second", pointer("first"), "message", `,"message":{"role":"user","content":"hello 🧪"}`)
	source := fixture(t, "append", pointer("first"), first)
	r := NewReader()
	cut := strings.Index(second, "🧪") + 2
	appendBytes(t, source.File, []byte(second[:cut]))
	page, err := r.Page(context.Background(), source, "")
	if err != nil || !reflect.DeepEqual(pageIDs(page), []string{"first"}) {
		t.Fatalf("incomplete UTF-8 should wait: %+v, %v", page, err)
	}
	source.Leaf = pointer("second")
	if _, err := r.Page(context.Background(), source, ""); err == nil {
		t.Fatal("uncompleted cutoff silently fell back")
	}
	appendBytes(t, source.File, []byte(second[cut:]))
	if _, err := r.Page(context.Background(), source, ""); err == nil {
		t.Fatal("record without LF became visible")
	}
	appendBytes(t, source.File, []byte("\n"))
	page, err = r.Page(context.Background(), source, "")
	if err != nil || !reflect.DeepEqual(pageIDs(page), []string{"first", "second"}) || string(page.Entries[1].Data) != second {
		t.Fatalf("completed append missing: %+v, %v", page, err)
	}
}

func TestMalformedCompletedRecordsAndUnsupportedFormats(t *testing.T) {
	valid := message("root", nil, "hello")
	tests := map[string]string{
		"malformed JSON":         header("s") + "\n{" + "\n",
		"malformed UTF8":         header("s") + "\n" + entry("root", nil, "unknown", `,"text":"`+string([]byte{0xff})+`"`) + "\n",
		"blank completed line":   header("s") + "\n\n",
		"legacy version":         strings.Replace(header("s"), `"version":3`, `"version":2`, 1) + "\n" + valid + "\n",
		"wrong session":          header("other") + "\n" + valid + "\n",
		"missing parent":         header("s") + "\n" + `{"type":"unknown","id":"root"}` + "\n",
		"bad parent type":        header("s") + "\n" + `{"type":"unknown","id":"root","parentId":42}` + "\n",
		"missing ancestor":       header("s") + "\n" + message("root", pointer("absent"), "x") + "\n",
		"duplicate ID":           header("s") + "\n" + valid + "\n" + valid + "\n",
		"cycle":                  header("s") + "\n" + message("root", pointer("other"), "x") + "\n" + message("other", pointer("root"), "x") + "\n",
		"malformed after cutoff": header("s") + "\n" + valid + "\nnot JSON\n",
		"missing message role":   header("s") + "\n" + entry("root", nil, "message", `,"message":{}`) + "\n",
		"incomplete header":      header("s"),
	}
	for name, content := range tests {
		t.Run(name, func(t *testing.T) {
			source := fixture(t, "s", pointer("root"))
			if err := os.WriteFile(source.File, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := NewReader().Page(context.Background(), source, ""); err == nil {
				t.Fatal("expected explicit error")
			}
			after, err := os.ReadFile(source.File)
			if err != nil || string(after) != content {
				t.Fatal("malformed source was modified/repaired")
			}
		})
	}
}

func TestReplacementTruncationAndUnavailability(t *testing.T) {
	for _, fault := range []string{"replace", "truncate", "truncate and regrow", "unavailable"} {
		t.Run(fault, func(t *testing.T) {
			source := fixture(t, "s", pointer("root"), message("root", nil, "original content"))
			r := NewReader()
			if _, err := r.Page(context.Background(), source, ""); err != nil {
				t.Fatal(err)
			}
			switch fault {
			case "replace":
				other := fixture(t, "s", pointer("root"), message("root", nil, "replacement content at least as long"))
				if err := os.Rename(other.File, source.File); err != nil {
					t.Fatal(err)
				}
			case "truncate":
				if err := os.Truncate(source.File, int64(len(header("s"))+1)); err != nil {
					t.Fatal(err)
				}
			case "truncate and regrow":
				// WriteFile truncates and rewrites the same inode. The replacement
				// is longer, so size/inode checks alone cannot detect it.
				changed := header("s") + "\n" + message("root", nil, "changed content longer than original content") + "\n"
				if err := os.WriteFile(source.File, []byte(changed), 0600); err != nil {
					t.Fatal(err)
				}
			case "unavailable":
				if err := os.Remove(source.File); err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < 2; i++ {
				if _, err := r.Page(context.Background(), source, ""); err == nil {
					t.Fatal("source fault silently accepted")
				}
				if _, err := r.Chunk(context.Background(), source, "root", 0); err == nil {
					t.Fatal("source fault allowed expansion")
				}
			}
			if fault != "unavailable" {
				source.Key += "/fresh-authoritative-association"
				if fault == "truncate" {
					source.Leaf = nil
				}
				if _, err := r.Page(context.Background(), source, ""); err != nil {
					t.Fatalf("fresh association could not resynchronize: %v", err)
				}
			}
		})
	}
}

func TestExplicitBoundsAndCancellation(t *testing.T) {
	t.Run("file", func(t *testing.T) {
		source := fixture(t, "s", nil)
		if err := os.Truncate(source.File, maxFileBytes+1); err != nil {
			t.Fatal(err)
		}
		if _, err := NewReader().Page(context.Background(), source, ""); err == nil || !strings.Contains(err.Error(), "64 MiB") {
			t.Fatalf("expected file bound, got %v", err)
		}
	})
	t.Run("record", func(t *testing.T) {
		source := fixture(t, "s", nil)
		appendBytes(t, source.File, []byte(strings.Repeat(" ", maxRecordBytes+1)+"\n"))
		if _, err := NewReader().Page(context.Background(), source, ""); err == nil || !strings.Contains(err.Error(), "16 MiB") {
			t.Fatalf("expected record bound, got %v", err)
		}
	})
	t.Run("entries", func(t *testing.T) {
		var content strings.Builder
		content.WriteString(header("s") + "\n")
		for i := 0; i <= maxEntries; i++ {
			content.WriteString(entry(fmt.Sprint(i), nil, "future", "") + "\n")
		}
		source := fixture(t, "s", nil)
		if err := os.WriteFile(source.File, []byte(content.String()), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := NewReader().Page(context.Background(), source, ""); err == nil || !strings.Contains(err.Error(), "100000") {
			t.Fatalf("expected entry bound, got %v", err)
		}
	})
	t.Run("associations", func(t *testing.T) {
		r := NewReader()
		source := fixture(t, "s", nil)
		for i := 0; i < maxSources; i++ {
			source.Key = fmt.Sprintf("association-%d", i)
			if _, err := r.Page(context.Background(), source, ""); err != nil {
				t.Fatal(err)
			}
		}
		source.Key = "over-limit"
		if _, err := r.Page(context.Background(), source, ""); err == nil || !strings.Contains(err.Error(), "1024") {
			t.Fatalf("expected association bound, got %v", err)
		}
		// Hitting the limit must not evict old source observations silently.
		source.Key = "association-0"
		if _, err := r.Page(context.Background(), source, ""); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("metadata", func(t *testing.T) {
		source := fixture(t, "s", pointer("root"), entry("root", nil, strings.Repeat("x", maxMetadataBytes+1), ""))
		if _, err := NewReader().Page(context.Background(), source, ""); err == nil || !strings.Contains(err.Error(), "metadata") {
			t.Fatalf("expected metadata bound, got %v", err)
		}
	})
	t.Run("cancelled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		source := fixture(t, "s", pointer("root"), message("root", nil, "x"))
		if _, err := NewReader().Page(ctx, source, ""); err != context.Canceled {
			t.Fatalf("cancellation lost: %v", err)
		}
		if _, err := NewReader().Chunk(ctx, source, "root", 0); err != context.Canceled {
			t.Fatalf("cancellation lost: %v", err)
		}
	})
}
