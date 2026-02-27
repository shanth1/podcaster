package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/nats-io/nats.go"
)

const (
	APIKey      = "devkey"
	APISecret   = "devsecret"
	NatsUrl     = "nats://localhost:4222"
	LiveKitURL  = "ws://localhost:7880"
	MediaMtxAPI = "http://localhost:9997"
)

var (
	viewersMutex sync.Mutex
	viewers      = make(map[string]time.Time)

	streamStateMutex sync.Mutex
	isStreamActive   bool
)

type CommandRequest struct {
	Action string `json:"action"`
	Room   string `json:"room"`
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
		token, _ := createLiveKitToken(roomName, identity)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	})

	http.HandleFunc("/api/command", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		var req CommandRequest
		json.NewDecoder(r.Body).Decode(&req)

		contract := AdapterContract{Action: req.Action, RoomName: req.Room}
		if req.Action == "START" {
			streamStateMutex.Lock()
			isStreamActive = true
			streamStateMutex.Unlock()

			botToken, _ := createLiveKitToken(req.Room, "Adapter-Bot")
			contract.LiveKitURL = LiveKitURL
			contract.Token = botToken
			contract.RTMPOutput = "rtmp://localhost:1935/live/test"
		} else if req.Action == "STOP" {
			streamStateMutex.Lock()
			isStreamActive = false
			streamStateMutex.Unlock()

			clearMediaMtxStream()
		}

		payload, _ := json.Marshal(contract)
		nc.Publish("adapter.commands", payload)
		fmt.Printf("📢 Published NATS Command: %s\n", req.Action)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	http.HandleFunc("/api/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		clientId := r.URL.Query().Get("clientId")
		now := time.Now()

		viewersMutex.Lock()
		if clientId != "" {
			viewers[clientId] = now
		}

		activeCount := 0
		for id, lastSeen := range viewers {
			if now.Sub(lastSeen) > 5*time.Second {
				delete(viewers, id)
			} else {
				activeCount++
			}
		}
		viewersMutex.Unlock()

		json.NewEncoder(w).Encode(map[string]int{"viewers": activeCount})
	})

	http.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		streamStateMutex.Lock()
		live := isStreamActive
		streamStateMutex.Unlock()

		json.NewEncoder(w).Encode(map[string]bool{"live": live})
	})

	fmt.Println("🚀 Core Backend is running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func clearMediaMtxStream() {
	req, err := http.NewRequest(http.MethodDelete, MediaMtxAPI+"/v3/paths/delete/live/test", nil)
	if err == nil {
		client := &http.Client{Timeout: 2 * time.Second}
		client.Do(req)
	}
}

func createLiveKitToken(room, identity string) (string, error) {
	at := auth.NewAccessToken(APIKey, APISecret)
	canPub, canSub := true, true
	grant := &auth.VideoGrant{RoomJoin: true, Room: room, CanPublish: &canPub, CanSubscribe: &canSub}
	at.SetVideoGrant(grant).SetIdentity(identity).SetValidFor(time.Hour)
	return at.ToJWT()
}
