package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	lksdk "github.com/livekit/server-sdk-go"
	"github.com/nats-io/nats.go"
	"github.com/pion/webrtc/v3"
)

const (
	LKUrl      = "ws://localhost:7880"
	LKKey      = "devkey"
	LKSecret   = "devsecret"
	RoomName   = "Studio1"
	NatsUrl    = "nats://localhost:4222"
	RtmpOutput = "rtmp://localhost:1935/live/test"
)

var ffmpegCmd *exec.Cmd

func main() {
	fmt.Println("🚀 Starting local Adapter on Mac...")

	// 1. NATS
	nc, err := nats.Connect(NatsUrl)
	if err != nil {
		log.Fatalf("❌ NATS error: %v", err)
	}
	defer nc.Close()
	fmt.Println("✅ Connected to NATS")

	nc.Subscribe("adapter.command", func(m *nats.Msg) {
		cmd := string(m.Data)
		fmt.Printf("📬 Command: %s\n", cmd)
		if cmd == "START_RENDER" {
			startFFmpeg()
		} else if cmd == "STOP_RENDER" {
			stopFFmpeg()
		}
	})

	// 2. LIVEKIT
	roomCB := lksdk.NewRoomCallback()

	roomCB.OnParticipantConnected = func(participant *lksdk.RemoteParticipant) {
		fmt.Printf("👋 Participant joined: %s\n", participant.Identity())
	}

	roomCB.OnParticipantDisconnected = func(participant *lksdk.RemoteParticipant) {
		fmt.Printf("🚪 Participant left: %s\n", participant.Identity())
	}

	roomCB.OnTrackSubscribed = func(track *webrtc.TrackRemote, publication *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
		fmt.Printf("📹 Received Video/Audio Track from: %s (Type: %s)\n", rp.Identity(), track.Kind().String())
	}

	room, err := lksdk.ConnectToRoom(LKUrl, lksdk.ConnectInfo{
		APIKey:              LKKey,
		APISecret:           LKSecret,
		RoomName:            RoomName,
		ParticipantIdentity: "Render-Adapter-Bot",
	}, roomCB)

	if err != nil {
		log.Fatalf("❌ LiveKit error: %v", err)
	}
	defer room.Disconnect()
	fmt.Println("✅ Connected to LiveKit Room:", room.Name())

	startFFmpeg()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	fmt.Println("\nShutting down...")
	stopFFmpeg()
}

func startFFmpeg() {
	if ffmpegCmd != nil && ffmpegCmd.Process != nil {
		return
	}
	fmt.Println("🎬 Starting FFmpeg...")

	ffmpegCmd = exec.Command("ffmpeg",
		"-y", "-re",
		"-f", "lavfi", "-i", "smptebars=size=1280x720:rate=30",
		"-f", "lavfi", "-i", "sine=frequency=440:beep_factor=4",
		"-c:v", "libx264", "-preset", "ultrafast", "-b:v", "2000k", "-pix_fmt", "yuv420p", "-g", "60",
		"-c:a", "aac", "-b:a", "128k",
		"-f", "flv", RtmpOutput,
	)

	ffmpegCmd.Stderr = os.Stderr

	if err := ffmpegCmd.Start(); err != nil {
		fmt.Printf("❌ FFmpeg start failed: %v\n", err)
		return
	}
	fmt.Println("✅ FFmpeg is streaming to MediaMTX (localhost:8888)")
}

func stopFFmpeg() {
	if ffmpegCmd != nil && ffmpegCmd.Process != nil {
		fmt.Println("🛑 Stopping FFmpeg...")
		ffmpegCmd.Process.Signal(syscall.SIGTERM)
		ffmpegCmd.Wait()
		ffmpegCmd = nil
	}
}
