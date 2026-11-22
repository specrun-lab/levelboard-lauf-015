package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const version = "0.1.0"

var titles = [10]string{
	"Statische Seite",
	"Webserver",
	"REST-Backend",
	"Datenbank",
	"Frontend + Backend",
	"Repo + CI",
	"Images in der Pipeline",
	"Deployment",
	"Live-Prüfung",
	"Metriken veröffentlicht",
}

type Check struct {
	Name string `json:"name"`
	Ok   bool   `json:"ok"`
}

type LevelResult struct {
	Level      int            `json:"level"`
	Title      string         `json:"title"`
	Status     string         `json:"status"`
	CheckedAt  *string        `json:"checkedAt"`
	DurationMs *int64         `json:"durationMs"`
	Checks     []Check        `json:"checks"`
	Metrics    map[string]any `json:"metrics"`
}

type RunInfo struct {
	ID        string  `json:"id"`
	Version   string  `json:"version"`
	Commit    *string `json:"commit"`
	UpdatedAt *string `json:"updatedAt"`
}

type Results struct {
	Run    RunInfo       `json:"run"`
	Levels []LevelResult `json:"levels"`
}

type ResultReport struct {
	Checks     []Check
	DurationMs int64
	Metrics    map[string]any
}

type HistoryEntry struct {
	ID         int64          `json:"id"`
	Status     string         `json:"status"`
	CheckedAt  string         `json:"checkedAt"`
	DurationMs int64          `json:"durationMs"`
	Checks     []Check        `json:"checks"`
	Metrics    map[string]any `json:"metrics"`
}

type History struct {
	Level   int            `json:"level"`
	Entries []HistoryEntry `json:"entries"`
}

type ConflictError struct{}

func (ConflictError) Error() string { return "ein niedrigeres Level ist nicht bestanden" }

type Store struct {
	mu        sync.Mutex
	db        *sql.DB
	runID     string
	commit    *string
	usagePath string
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

const schema = `
CREATE TABLE levels (
  level        INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 10),
  status       TEXT    NOT NULL CHECK (status IN ('offen','bestanden','fehlgeschlagen','gesperrt')),
  checked_at   TEXT,
  duration_ms  INTEGER,
  checks       TEXT    NOT NULL DEFAULT '[]',
  metrics      TEXT    NOT NULL DEFAULT '{}'
);
CREATE TABLE reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        INTEGER NOT NULL REFERENCES levels(level),
  status       TEXT    NOT NULL CHECK (status IN ('bestanden','fehlgeschlagen')),
  checked_at   TEXT    NOT NULL,
  duration_ms  INTEGER NOT NULL,
  checks       TEXT    NOT NULL,
  metrics      TEXT    NOT NULL
);
CREATE INDEX reports_level ON reports(level, id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`

func OpenStore(path, runID, commit string) (*Store, error) {
	directory := filepath.Dir(path)
	if directory != "" && directory != "." {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)",
		path,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	store := &Store{db: db, runID: runID, usagePath: filepath.Join(filepath.Dir(path), "usage.json")}
	if commit != "" {
		value := commit
		store.commit = &value
	}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	var userVersion int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&userVersion); err != nil {
		return err
	}
	if userVersion == 1 {
		return nil
	}
	if userVersion != 0 {
		return fmt.Errorf("unbekannte Datenbankversion %d", userVersion)
	}
	transaction, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.Exec(schema); err != nil {
		return err
	}
	for number := 1; number <= 10; number++ {
		if _, err := transaction.Exec("INSERT INTO levels (level, status) VALUES (?, 'offen')", number); err != nil {
			return err
		}
	}
	if _, err := transaction.Exec("PRAGMA user_version = 1"); err != nil {
		return err
	}
	return transaction.Commit()
}

func buildLevel(number int, status string, checkedAt sql.NullString, duration sql.NullInt64, checksJSON, metricsJSON string) (LevelResult, error) {
	level := LevelResult{
		Level:   number,
		Title:   titles[number-1],
		Status:  status,
		Checks:  []Check{},
		Metrics: map[string]any{},
	}
	if checkedAt.Valid {
		value := checkedAt.String
		level.CheckedAt = &value
	}
	if duration.Valid {
		value := duration.Int64
		level.DurationMs = &value
	}
	if err := json.Unmarshal([]byte(checksJSON), &level.Checks); err != nil {
		return LevelResult{}, err
	}
	if err := json.Unmarshal([]byte(metricsJSON), &level.Metrics); err != nil {
		return LevelResult{}, err
	}
	return level, nil
}

func scanLevel(scanner interface{ Scan(...any) error }, number int) (LevelResult, error) {
	var status string
	var checkedAt sql.NullString
	var duration sql.NullInt64
	var checksJSON, metricsJSON string
	if err := scanner.Scan(&status, &checkedAt, &duration, &checksJSON, &metricsJSON); err != nil {
		return LevelResult{}, err
	}
	return buildLevel(number, status, checkedAt, duration, checksJSON, metricsJSON)
}

func (s *Store) snapshotLocked() (Results, error) {
	rows, err := s.db.Query("SELECT level, status, checked_at, duration_ms, checks, metrics FROM levels ORDER BY level")
	if err != nil {
		return Results{}, err
	}
	defer rows.Close()

	levels := make([]LevelResult, 0, 10)
	for rows.Next() {
		var number int
		var status string
		var checkedAt sql.NullString
		var duration sql.NullInt64
		var checksJSON, metricsJSON string
		if err := rows.Scan(&number, &status, &checkedAt, &duration, &checksJSON, &metricsJSON); err != nil {
			return Results{}, err
		}
		level, err := buildLevel(number, status, checkedAt, duration, checksJSON, metricsJSON)
		if err != nil {
			return Results{}, err
		}
		levels = append(levels, level)
	}
	if err := rows.Err(); err != nil {
		return Results{}, err
	}

	var updatedAt *string
	var value string
	err = s.db.QueryRow("SELECT value FROM meta WHERE key = 'updated_at'").Scan(&value)
	if err == nil {
		updatedAt = &value
	} else if err != sql.ErrNoRows {
		return Results{}, err
	}

	return Results{
		Run: RunInfo{
			ID:        s.runID,
			Version:   version,
			Commit:    s.commit,
			UpdatedAt: updatedAt,
		},
		Levels: levels,
	}, nil
}

func (s *Store) Snapshot() (Results, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *Store) Level(number int) (LevelResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if number < 1 || number > 10 {
		return LevelResult{}, false, nil
	}
	level, err := scanLevel(s.db.QueryRow(
		"SELECT status, checked_at, duration_ms, checks, metrics FROM levels WHERE level = ?", number,
	), number)
	if err == sql.ErrNoRows {
		return LevelResult{}, false, nil
	}
	if err != nil {
		return LevelResult{}, false, err
	}
	return level, true, nil
}

func (s *Store) Report(number int, report ResultReport) (Results, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	transaction, err := s.db.Begin()
	if err != nil {
		return Results{}, err
	}
	defer func() { _ = transaction.Rollback() }()

	var blocked int
	if err := transaction.QueryRow(
		"SELECT COUNT(*) FROM levels WHERE level < ? AND status != 'bestanden'", number,
	).Scan(&blocked); err != nil {
		return Results{}, err
	}
	if blocked > 0 {
		return Results{}, ConflictError{}
	}

	status := "bestanden"
	for _, check := range report.Checks {
		if !check.Ok {
			status = "fehlgeschlagen"
			break
		}
	}
	metrics := report.Metrics
	if metrics == nil {
		metrics = map[string]any{}
	}
	checkedAt := nowISO()
	checksJSON, err := json.Marshal(report.Checks)
	if err != nil {
		return Results{}, err
	}
	metricsJSON, err := json.Marshal(metrics)
	if err != nil {
		return Results{}, err
	}

	if _, err := transaction.Exec(
		"UPDATE levels SET status = ?, checked_at = ?, duration_ms = ?, checks = ?, metrics = ? WHERE level = ?",
		status, checkedAt, report.DurationMs, string(checksJSON), string(metricsJSON), number,
	); err != nil {
		return Results{}, err
	}
	higherStatus := "offen"
	if status != "bestanden" {
		higherStatus = "gesperrt"
	}
	if _, err := transaction.Exec(
		"UPDATE levels SET status = ?, checked_at = NULL, duration_ms = NULL, checks = '[]', metrics = '{}' WHERE level > ?",
		higherStatus, number,
	); err != nil {
		return Results{}, err
	}
	if _, err := transaction.Exec(
		"INSERT INTO reports (level, status, checked_at, duration_ms, checks, metrics) VALUES (?, ?, ?, ?, ?, ?)",
		number, status, checkedAt, report.DurationMs, string(checksJSON), string(metricsJSON),
	); err != nil {
		return Results{}, err
	}
	if _, err := transaction.Exec(
		"INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		checkedAt,
	); err != nil {
		return Results{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Results{}, err
	}
	return s.snapshotLocked()
}

func (s *Store) History(number, limit int) (History, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rows, err := s.db.Query(
		"SELECT id, status, checked_at, duration_ms, checks, metrics FROM reports WHERE level = ? ORDER BY id DESC LIMIT ?",
		number, limit,
	)
	if err != nil {
		return History{}, err
	}
	defer rows.Close()

	entries := make([]HistoryEntry, 0)
	for rows.Next() {
		var entry HistoryEntry
		var checksJSON, metricsJSON string
		if err := rows.Scan(&entry.ID, &entry.Status, &entry.CheckedAt, &entry.DurationMs, &checksJSON, &metricsJSON); err != nil {
			return History{}, err
		}
		entry.Checks = []Check{}
		entry.Metrics = map[string]any{}
		if err := json.Unmarshal([]byte(checksJSON), &entry.Checks); err != nil {
			return History{}, err
		}
		if err := json.Unmarshal([]byte(metricsJSON), &entry.Metrics); err != nil {
			return History{}, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return History{}, err
	}
	return History{Level: number, Entries: entries}, nil
}

func (s *Store) GetUsage() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.usagePath)
	if os.IsNotExist(err) {
		return []byte("{}"), nil
	}
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(trimmed) {
		return []byte("{}"), nil
	}
	return trimmed, nil
}

func (s *Store) SetUsage(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	temporary := s.usagePath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, s.usagePath)
}

func (s *Store) Health() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	var commit any
	if s.commit != nil {
		commit = *s.commit
	}
	return map[string]any{
		"status":  "ok",
		"version": version,
		"commit":  commit,
	}
}
