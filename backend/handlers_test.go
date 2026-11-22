package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.db"), "test", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func testServer(t *testing.T) (*httptest.Server, *Store) {
	t.Helper()
	store := testStore(t)
	server := httptest.NewServer(NewHandler(store))
	t.Cleanup(server.Close)
	return server, store
}

func doRequest(t *testing.T, method, url, body string, contentType string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

func decodeMap(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestHealth(t *testing.T) {
	server, _ := testServer(t)
	response := doRequest(t, http.MethodGet, server.URL+"/api/health", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if got := response.Header.Get("Content-Type"); got != "application/json" {
		t.Fatalf("content-type = %q", got)
	}
	health := decodeMap(t, response)
	if health["status"] != "ok" || health["version"] != version {
		t.Fatalf("health = %#v", health)
	}
	if health["commit"] != nil {
		t.Fatalf("commit = %#v", health["commit"])
	}
}

func TestStartState(t *testing.T) {
	server, _ := testServer(t)
	response := doRequest(t, http.MethodGet, server.URL+"/api/levels", "", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var results Results
	if err := json.NewDecoder(response.Body).Decode(&results); err != nil {
		t.Fatal(err)
	}
	if len(results.Levels) != 10 {
		t.Fatalf("levels = %d", len(results.Levels))
	}
	if results.Run.UpdatedAt != nil || results.Run.ID != "test" {
		t.Fatalf("run = %#v", results.Run)
	}
	for index, level := range results.Levels {
		if level.Level != index+1 || level.Status != "offen" || level.CheckedAt != nil {
			t.Fatalf("level %d = %#v", index+1, level)
		}
	}
}

func TestReportAndLock(t *testing.T) {
	server, _ := testServer(t)
	body := `{"checks":[{"name":"a","ok":true}],"durationMs":10}`
	response := doRequest(t, http.MethodPost, server.URL+"/api/levels/1/result", body, "application/json")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var results Results
	if err := json.NewDecoder(response.Body).Decode(&results); err != nil {
		t.Fatal(err)
	}
	if results.Levels[0].Status != "bestanden" || results.Levels[0].CheckedAt == nil {
		t.Fatalf("level 1 = %#v", results.Levels[0])
	}
	if results.Levels[0].DurationMs == nil || *results.Levels[0].DurationMs != 10 {
		t.Fatalf("duration = %#v", results.Levels[0].DurationMs)
	}
	if results.Run.UpdatedAt == nil {
		t.Fatal("updatedAt fehlt")
	}

	failing := `{"checks":[{"name":"a","ok":false}],"durationMs":5}`
	response = doRequest(t, http.MethodPost, server.URL+"/api/levels/1/result", failing, "application/json")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(&results); err != nil {
		t.Fatal(err)
	}
	if results.Levels[0].Status != "fehlgeschlagen" {
		t.Fatalf("level 1 = %#v", results.Levels[0])
	}
	for _, level := range results.Levels[1:] {
		if level.Status != "gesperrt" {
			t.Fatalf("level %d = %s", level.Level, level.Status)
		}
	}

	conflict := doRequest(t, http.MethodPost, server.URL+"/api/levels/2/result", body, "application/json")
	if conflict.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d", conflict.StatusCode)
	}
}

func TestValidation(t *testing.T) {
	server, _ := testServer(t)
	cases := []string{
		`{kaputt`,
		`{}`,
		`{"checks":[],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true}]}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1.5}`,
		`{"checks":[{"name":"","ok":true}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":"ja"}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":null}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true,"extra":1}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1,"extra":1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1,"metrics":[]}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":-1}`,
		`[]`,
	}
	for _, body := range cases {
		response := doRequest(t, http.MethodPost, server.URL+"/api/levels/1/result", body, "application/json")
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d", body, response.StatusCode)
		}
	}
}

func TestMethodsAndUnknown(t *testing.T) {
	server, _ := testServer(t)
	cases := []struct {
		method string
		path   string
		status int
		allow  string
	}{
		{http.MethodDelete, "/api/levels", http.StatusMethodNotAllowed, "GET"},
		{http.MethodGet, "/api/levels/1/result", http.StatusMethodNotAllowed, "POST"},
		{http.MethodPost, "/api/health", http.StatusMethodNotAllowed, "GET"},
		{http.MethodGet, "/api/levels/0", http.StatusNotFound, ""},
		{http.MethodGet, "/api/levels/11", http.StatusNotFound, ""},
		{http.MethodGet, "/api/levels/abc", http.StatusNotFound, ""},
		{http.MethodGet, "/völlig/unbekannt", http.StatusNotFound, ""},
	}
	for _, testCase := range cases {
		response := doRequest(t, testCase.method, server.URL+testCase.path, "", "")
		if response.StatusCode != testCase.status {
			t.Fatalf("%s %s: status = %d", testCase.method, testCase.path, response.StatusCode)
		}
		if testCase.allow != "" && response.Header.Get("Allow") != testCase.allow {
			t.Fatalf("%s %s: Allow = %q", testCase.method, testCase.path, response.Header.Get("Allow"))
		}
		if got := response.Header.Get("Content-Type"); got != "application/json" {
			t.Fatalf("%s %s: content-type = %q", testCase.method, testCase.path, got)
		}
	}
}

func TestContentTypeAndSize(t *testing.T) {
	server, _ := testServer(t)
	body := `{"checks":[{"name":"a","ok":true}],"durationMs":1}`
	response := doRequest(t, http.MethodPost, server.URL+"/api/levels/1/result", body, "text/plain")
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d", response.StatusCode)
	}
	response = doRequest(t, http.MethodPost, server.URL+"/api/levels/1/result", body, "application/json; charset=utf-8")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	large := fmt.Sprintf(`{"checks":[{"name":"%s","ok":true}],"durationMs":1}`, strings.Repeat("x", 70000))
	response = doRequest(t, http.MethodPost, server.URL+"/api/levels/1/result", large, "application/json")
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestConcurrentReports(t *testing.T) {
	server, store := testServer(t)
	body := []byte(`{"checks":[{"name":"a","ok":true}],"durationMs":1}`)
	var waitGroup sync.WaitGroup
	errorsChannel := make(chan error, 100)
	for index := 0; index < 100; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			response, err := http.Post(server.URL+"/api/levels/1/result", "application/json", bytes.NewReader(body))
			if err != nil {
				errorsChannel <- err
				return
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				errorsChannel <- fmt.Errorf("status %d", response.StatusCode)
			}
		}()
	}
	waitGroup.Wait()
	close(errorsChannel)
	for err := range errorsChannel {
		t.Fatal(err)
	}
	level, ok, err := store.Level(1)
	if err != nil || !ok || level.Status != "bestanden" {
		t.Fatalf("level 1 = %#v", level)
	}
}
