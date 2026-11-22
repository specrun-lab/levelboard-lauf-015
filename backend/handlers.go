package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
)

type handler struct {
	store *Store
}

func NewHandler(store *Store) http.Handler {
	return &handler{store: store}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		body = []byte(`{"error":"interner Fehler"}`)
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeRawJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
}

func parseLevel(segment string) (int, bool) {
	number, err := strconv.Atoi(segment)
	if err != nil || number < 1 || number > 10 || strconv.Itoa(number) != segment {
		return 0, false
	}
	return number, true
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		writeError(w, http.StatusNotFound, "unbekannter Pfad")
		return
	}
	segments := strings.Split(path, "/")

	if len(segments) == 2 && segments[0] == "api" && segments[1] == "health" {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		writeJSON(w, http.StatusOK, h.store.Health())
		return
	}

	if len(segments) == 2 && segments[0] == "api" && segments[1] == "levels" {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		results, err := h.store.Snapshot()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "interner Fehler")
			return
		}
		writeJSON(w, http.StatusOK, results)
		return
	}
	if len(segments) == 2 && segments[0] == "api" && segments[1] == "usage" {
		h.handleUsage(w, r)
		return
	}

	if len(segments) >= 3 && segments[0] == "api" && segments[1] == "levels" {
		number, ok := parseLevel(segments[2])
		if !ok {
			writeError(w, http.StatusNotFound, "unbekanntes Level")
			return
		}
		if len(segments) == 3 {
			if r.Method != http.MethodGet {
				methodNotAllowed(w, http.MethodGet)
				return
			}
			level, found, err := h.store.Level(number)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "interner Fehler")
				return
			}
			if !found {
				writeError(w, http.StatusNotFound, "unbekanntes Level")
				return
			}
			writeJSON(w, http.StatusOK, level)
			return
		}
		if len(segments) == 4 && segments[3] == "result" {
			h.handleResult(w, r, number)
			return
		}
		if len(segments) == 4 && segments[3] == "history" {
			h.handleHistory(w, r, number)
			return
		}
		writeError(w, http.StatusNotFound, "unbekannter Pfad")
		return
	}

	writeError(w, http.StatusNotFound, "unbekannter Pfad")
}

func checkContentType(r *http.Request) bool {
	contentType := r.Header.Get("Content-Type")
	mediaType, _, err := mime.ParseMediaType(contentType)
	return err == nil && strings.EqualFold(mediaType, "application/json")
}

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	reader := http.MaxBytesReader(w, r.Body, 65536)
	data, err := io.ReadAll(reader)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "Anfrage zu groß")
			return nil, false
		}
		writeError(w, http.StatusBadRequest, "Anfrage nicht lesbar")
		return nil, false
	}
	return data, true
}

func decodeResultBody(data []byte) (*ResultReport, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, errors.New("kein JSON-Objekt")
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	var raw map[string]json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, errors.New("mehr als ein JSON-Wert")
	}
	for key := range raw {
		if key != "checks" && key != "durationMs" && key != "metrics" {
			return nil, fmt.Errorf("unbekanntes Feld %s", key)
		}
	}
	checksRaw, hasChecks := raw["checks"]
	if !hasChecks {
		return nil, errors.New("checks fehlt")
	}
	durationRaw, hasDuration := raw["durationMs"]
	if !hasDuration {
		return nil, errors.New("durationMs fehlt")
	}

	checksBytes := bytes.TrimSpace(checksRaw)
	if len(checksBytes) == 0 || checksBytes[0] != '[' {
		return nil, errors.New("checks ist kein Array")
	}
	var rawChecks []json.RawMessage
	if err := json.Unmarshal(checksBytes, &rawChecks); err != nil {
		return nil, err
	}
	if len(rawChecks) < 1 || len(rawChecks) > 100 {
		return nil, errors.New("falsche Anzahl Checks")
	}
	checks := make([]Check, 0, len(rawChecks))
	for _, rawCheck := range rawChecks {
		var checkObject map[string]json.RawMessage
		if err := json.Unmarshal(rawCheck, &checkObject); err != nil {
			return nil, err
		}
		if len(checkObject) != 2 {
			return nil, errors.New("unbekanntes Feld im Check")
		}
		nameRaw, hasName := checkObject["name"]
		okRaw, hasOk := checkObject["ok"]
		if !hasName || !hasOk {
			return nil, errors.New("Check unvollständig")
		}
		var name string
		if err := json.Unmarshal(nameRaw, &name); err != nil || name == "" {
			return nil, errors.New("ungültiger Checkname")
		}
		var ok bool
		if !bytes.Equal(bytes.TrimSpace(okRaw), []byte("true")) && !bytes.Equal(bytes.TrimSpace(okRaw), []byte("false")) {
			return nil, errors.New("ungültiges ok")
		}
		if err := json.Unmarshal(okRaw, &ok); err != nil {
			return nil, errors.New("ungültiges ok")
		}
		checks = append(checks, Check{Name: name, Ok: ok})
	}

	var durationNumber json.Number
	if err := json.Unmarshal(durationRaw, &durationNumber); err != nil {
		return nil, errors.New("ungültige Dauer")
	}
	duration, err := strconv.ParseInt(durationNumber.String(), 10, 64)
	if err != nil || duration < 0 {
		return nil, errors.New("ungültige Dauer")
	}

	metrics := map[string]any{}
	if metricsRaw, hasMetrics := raw["metrics"]; hasMetrics {
		metricsBytes := bytes.TrimSpace(metricsRaw)
		if !bytes.Equal(metricsBytes, []byte("null")) {
			if len(metricsBytes) == 0 || metricsBytes[0] != '{' {
				return nil, errors.New("metrics ist kein Objekt")
			}
			if err := json.Unmarshal(metricsBytes, &metrics); err != nil {
				return nil, err
			}
		}
	}

	return &ResultReport{Checks: checks, DurationMs: duration, Metrics: metrics}, nil
}

func (h *handler) handleUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		w.Header().Set("Allow", "GET, PUT")
		writeError(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	if r.Method == http.MethodGet {
		data, err := h.store.GetUsage()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "interner Fehler")
			return
		}
		writeRawJSON(w, http.StatusOK, data)
		return
	}

	if !checkContentType(r) {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type muss application/json sein")
		return
	}
	data, ok := readBody(w, r)
	if !ok {
		return
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	var object map[string]any
	if err := json.Unmarshal(trimmed, &object); err != nil {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	if err := h.store.SetUsage(trimmed); err != nil {
		writeError(w, http.StatusInternalServerError, "interner Fehler")
		return
	}
	writeRawJSON(w, http.StatusOK, trimmed)
}

func (h *handler) handleHistory(w http.ResponseWriter, r *http.Request, number int) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	limit := 50
	if values, present := r.URL.Query()["limit"]; present {
		if len(values) != 1 {
			writeError(w, http.StatusBadRequest, "ungültiges limit")
			return
		}
		parsed, err := strconv.Atoi(values[0])
		if err != nil || parsed < 1 || parsed > 500 {
			writeError(w, http.StatusBadRequest, "ungültiges limit")
			return
		}
		limit = parsed
	}
	history, err := h.store.History(number, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "interner Fehler")
		return
	}
	writeJSON(w, http.StatusOK, history)
}

func (h *handler) handleResult(w http.ResponseWriter, r *http.Request, number int) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if !checkContentType(r) {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type muss application/json sein")
		return
	}
	data, ok := readBody(w, r)
	if !ok {
		return
	}
	report, err := decodeResultBody(data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	results, err := h.store.Report(number, *report)
	if err != nil {
		var conflict ConflictError
		if errors.As(err, &conflict) {
			writeError(w, http.StatusConflict, conflict.Error())
			return
		}
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	writeJSON(w, http.StatusOK, results)
}
