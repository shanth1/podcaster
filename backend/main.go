package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/livekit/protocol/auth"
)

const (
	APIKey    = "devkey"
	APISecret = "devsecret"
)

func main() {
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

	fmt.Println("🚀 Backend is running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
