package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/nats-io/nats.go"
)

const (
	APIKey    = "devkey"
	APISecret = "devsecret"
	NatsUrl   = "nats://localhost:4222"
)

type CommandRequest struct {
	Command string `json:"command"`
}

func main() {
	nc, err := nats.Connect(NatsUrl)
	if err != nil {
		log.Fatalf("❌ Failed to connect to NATS: %v", err)
	}
	defer nc.Close()
	fmt.Println("✅ Core API connected to NATS")

	http.HandleFunc("/api/join", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")

		roomName := r.URL.Query().Get("room")
		identity := r.URL.Query().Get("identity")

		if roomName == "" || identity == "" {
			http.Error(w, "room and identity are required", http.StatusBadRequest)
			return
		}

		at := auth.NewAccessToken(APIKey, APISecret)
		grant := &auth.VideoGrant{
			RoomJoin: true,
			Room:     roomName,
		}

		at.SetVideoGrant(grant).
			SetIdentity(identity).
			SetValidFor(time.Hour)

		token, err := at.ToJWT()
		if err != nil {
			http.Error(w, "failed to generate token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"token": token,
		})
	})

	http.HandleFunc("/api/command", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		err = nc.Publish("adapter.command", []byte(req.Command))
		if err != nil {
			http.Error(w, "Failed to publish to NATS", http.StatusInternalServerError)
			return
		}

		fmt.Printf("📢 Published to NATS: %s\n", req.Command)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	fmt.Println("🚀 Core Backend is running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
