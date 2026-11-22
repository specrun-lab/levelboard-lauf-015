package main

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
)

func reportPass(store *Store, level int, duration int64) error {
	_, err := store.Report(level, ResultReport{
		Checks:     []Check{{Name: "a", Ok: true}},
		DurationMs: duration,
		Metrics:    map[string]any{},
	})
	return err
}

func TestHistoryOrderAndLimit(t *testing.T) {
	store := testStore(t)
	if err := reportPass(store, 1, 101); err != nil {
		t.Fatal(err)
	}
	if err := reportPass(store, 1, 102); err != nil {
		t.Fatal(err)
	}
	history, err := store.History(1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Entries) != 2 {
		t.Fatalf("entries = %d", len(history.Entries))
	}
	if history.Entries[0].DurationMs != 102 || history.Entries[1].DurationMs != 101 {
		t.Fatalf("reihenfolge = %#v", history.Entries)
	}
	if history.Entries[0].ID <= history.Entries[1].ID {
		t.Fatal("IDs nicht aufsteigend")
	}
	limited, err := store.History(1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(limited.Entries) != 1 || limited.Entries[0].DurationMs != 102 {
		t.Fatalf("limit = %#v", limited.Entries)
	}
}

func TestRejectedReportLeavesNoHistory(t *testing.T) {
	store := testStore(t)
	if _, err := store.Report(1, ResultReport{
		Checks:  []Check{{Name: "a", Ok: false}},
		Metrics: map[string]any{},
	}); err != nil {
		t.Fatal(err)
	}
	before, err := store.History(2, 500)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Report(2, ResultReport{
		Checks:  []Check{{Name: "b", Ok: true}},
		Metrics: map[string]any{},
	}); err == nil {
		t.Fatal("409 erwartet")
	}
	after, err := store.History(2, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Entries) != len(after.Entries) {
		t.Fatalf("history = %d -> %d", len(before.Entries), len(after.Entries))
	}
}

func TestPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "levelboard.db")
	store, err := OpenStore(path, "test", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := reportPass(store, 1, 101); err != nil {
		t.Fatal(err)
	}
	before, err := store.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	historyBefore, err := store.History(1, 500)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore(path, "test", "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	after, err := reopened.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	historyAfter, err := reopened.History(1, 500)
	if err != nil {
		t.Fatal(err)
	}
	if before.Levels[0].Status != after.Levels[0].Status || before.Run.UpdatedAt == nil || after.Run.UpdatedAt == nil {
		t.Fatalf("stand = %#v / %#v", before, after)
	}
	if *before.Run.UpdatedAt != *after.Run.UpdatedAt || len(historyBefore.Entries) != len(historyAfter.Entries) {
		t.Fatal("Historie oder Stand nach Neustart verändert")
	}
}

func TestConcurrentReportsCreateAllHistoryEntries(t *testing.T) {
	store := testStore(t)
	var waitGroup sync.WaitGroup
	errorsChannel := make(chan error, 100)
	for index := 0; index < 100; index++ {
		waitGroup.Add(1)
		go func(index int) {
			defer waitGroup.Done()
			if err := reportPass(store, 1, int64(index)); err != nil {
				errorsChannel <- err
			}
		}(index)
	}
	waitGroup.Wait()
	close(errorsChannel)
	for err := range errorsChannel {
		t.Fatal(err)
	}
	history, err := store.History(1, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Entries) != 100 {
		t.Fatalf("entries = %d", len(history.Entries))
	}
}

func TestSchemaColumns(t *testing.T) {
	store := testStore(t)
	var userVersion int
	if err := store.db.QueryRow("PRAGMA user_version").Scan(&userVersion); err != nil {
		t.Fatal(err)
	}
	if userVersion != 1 {
		t.Fatalf("user_version = %d", userVersion)
	}
	expected := map[string][]string{
		"levels":  {"level", "status", "checked_at", "duration_ms", "checks", "metrics"},
		"reports": {"id", "level", "status", "checked_at", "duration_ms", "checks", "metrics"},
		"meta":    {"key", "value"},
	}
	for table, columns := range expected {
		rows, err := store.db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for rows.Next() {
			var cid, notNull, primaryKey int
			var name, columnType string
			var defaultValue any
			if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
				t.Fatal(err)
			}
			names = append(names, name)
		}
		rows.Close()
		if len(names) != len(columns) {
			t.Fatalf("%s: %v", table, names)
		}
		for index, name := range columns {
			if names[index] != name {
				t.Fatalf("%s: %v", table, names)
			}
		}
	}
	var count int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM levels").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 10 {
		t.Fatalf("levels = %d", count)
	}
}
