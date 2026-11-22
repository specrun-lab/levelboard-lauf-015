package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		writer := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(writer, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, writer.status, time.Since(start))
	})
}

func main() {
	address := os.Getenv("LEVELBOARD_ADDR")
	if address == "" {
		address = "127.0.0.1:8081"
	}
	runID := os.Getenv("RUN_ID")
	if runID == "" {
		runID = "lokal"
	}
	dbPath := os.Getenv("LEVELBOARD_DB")
	if dbPath == "" {
		dbPath = ".run/levelboard.db"
	}
	store, err := OpenStore(dbPath, runID, os.Getenv("LEVELBOARD_COMMIT"))
	if err != nil {
		log.Fatalf("Datenbank konnte nicht geöffnet werden: %v", err)
	}
	defer func() { _ = store.Close() }()

	server := &http.Server{
		Addr:    address,
		Handler: withLogging(NewHandler(store)),
	}

	go func() {
		log.Printf("Levelboard-Backend läuft auf %s", address)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Serverfehler: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Shutdown-Fehler: %v", err)
	}
}
