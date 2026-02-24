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
	APIKey     = "devkey"
	APISecret  = "devsecret"
	NatsUrl    = "nats://localhost:4222"
	LiveKitURL = "ws://localhost:7880"
)

type CommandRequest struct {
	Action string `json:"action"` // "START" или "STOP"
	Room   string `json:"room"`   // "Studio1"
}

type AdapterContract struct {
	Action     string `json:"action"`
	RoomName   string `json:"room_name"`
	LiveKitURL string `json:"livekit_url"`
	Token      string `json:"token"`
	RTMPOutput string `json:"rtmp_output"`
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

		token, _ := createLiveKitToken(roomName, identity, false) // TODO: ??
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	})

	// Эндпоинт управления (Mixer)
	http.HandleFunc("/api/command", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		var req CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		contract := AdapterContract{
			Action:   req.Action,
			RoomName: req.Room,
		}

		if req.Action == "START" {
			botToken, _ := createLiveKitToken(req.Room, "Adapter-Bot", false)
			contract.LiveKitURL = LiveKitURL
			contract.Token = botToken
			contract.RTMPOutput = "rtmp://localhost:1935/live/test" // TODO
		}

		payload, _ := json.Marshal(contract)
		nc.Publish("adapter.commands", payload)

		fmt.Printf("📢 Published Desired State to NATS: %s\n", string(payload))

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	fmt.Println("🚀 Core Backend is running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func createLiveKitToken(room, identity string, hidden bool) (string, error) {
	at := auth.NewAccessToken(APIKey, APISecret)

	canPub := true
	canSub := true

	grant := &auth.VideoGrant{
		RoomJoin:     true,
		Room:         room,
		Hidden:       hidden,
		CanPublish:   &canPub,
		CanSubscribe: &canSub,
	}

	at.SetVideoGrant(grant).SetIdentity(identity).SetValidFor(time.Hour)
	return at.ToJWT()
}
