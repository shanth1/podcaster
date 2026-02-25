use async_nats::connect;
use futures::stream::StreamExt;
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::webrtc::prelude::*;
use livekit::webrtc::video_frame::{VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::webrtc::video_stream::native::NativeVideoStream;
use serde::Deserialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Deserialize, Debug)]
struct AdapterContract {
    action: String,
    room_name: String,
    livekit_url: String,
    token: String,
    rtmp_output: String,
}

struct AppState {
    active_rooms: Mutex<HashMap<String, Arc<Room>>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Starting Rust Render Adapter...");
    let state = Arc::new(AppState { active_rooms: Mutex::new(HashMap::new()) });
    let client = connect("nats://localhost:4222").await?;
    let mut subscriber = client.subscribe("adapter.commands").await?;

    while let Some(msg) = subscriber.next().await {
        let payload = String::from_utf8_lossy(&msg.payload);
        if let Ok(contract) = serde_json::from_str::<AdapterContract>(&payload) {
            if contract.action == "START" {
                let _ = start_render_session(contract, state.clone()).await;
            } else if contract.action == "STOP" {
                let _ = stop_render_session(contract, state.clone()).await;
            }
        }
    }
    Ok(())
}

async fn stop_render_session(contract: AdapterContract, state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error>> {
    println!("🛑 Stopping render session for room: {}", contract.room_name);
    let mut rooms = state.active_rooms.lock().await;

    if let Some(room) = rooms.remove(&contract.room_name) {
        let _ = room.close().await;
        println!("✅ Bot left room. Cleanup initiated.");
    } else {
        println!("⚠️ Room {} not found or already stopped.", contract.room_name);
    }
    Ok(())
}

async fn start_render_session(contract: AdapterContract, state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error>> {
    let mut rooms = state.active_rooms.lock().await;
    if rooms.contains_key(&contract.room_name) {
        return Ok(());
    }

    println!("🎬 Starting render session for room: {}", contract.room_name);
    let mut room_opts = RoomOptions::default();
    room_opts.auto_subscribe = true;

    let (room, mut room_events) = Room::connect(&contract.livekit_url, &contract.token, room_opts).await?;
    let room_arc = Arc::new(room);
    rooms.insert(contract.room_name.clone(), room_arc.clone());

    let video_source = NativeVideoSource::new(VideoResolution { width: 1280, height: 720 }, false);
    let local_track = LocalVideoTrack::create_video_track("processed_video", RtcVideoSource::Native(video_source.clone()));

    let mut publish_opts = TrackPublishOptions::default();
    publish_opts.source = TrackSource::Camera;

    room_arc.local_participant()
        .publish_track(LocalTrack::Video(local_track), publish_opts)
        .await?;

    let has_main_video = Arc::new(Mutex::new(false));

    tokio::spawn(async move {
        while let Some(event) = room_events.recv().await {
            if let RoomEvent::TrackSubscribed { track, participant, .. } = event {
                if let RemoteTrack::Video(video_track) = track {
                    let mut has_main = has_main_video.lock().await;
                    let is_main_speaker = if !*has_main {
                        *has_main = true;
                        true
                    } else {
                        false
                    };

                    spawn_video_processor(
                        video_track,
                        participant.identity().to_string(),
                        video_source.clone(),
                        contract.rtmp_output.clone(),
                        is_main_speaker,
                    );
                }
            }
        }
    });

    Ok(())
}

fn spawn_video_processor(
    video_track: RemoteVideoTrack,
    identity: String,
    source_clone: NativeVideoSource,
    rtmp_output: String,
    is_main_speaker: bool,
) {
    tokio::spawn(async move {
        let mut video_stream = NativeVideoStream::new(video_track.rtc_track());
        let mut ffmpeg_child: Option<tokio::process::Child> = None;
        let mut ffmpeg_stdin: Option<tokio::process::ChildStdin> = None;
        let mut current_width = 0;
        let mut current_height = 0;

        while let Some(frame) = video_stream.next().await {
            let i420 = frame.buffer.to_i420();
            let width = i420.width();
            let height = i420.height();

            if is_main_speaker {
                if width != current_width || height != current_height {
                    println!("🎥 Смена разрешения у {}: {}x{}", identity, width, height);
                    current_width = width;
                    current_height = height;

                    drop(ffmpeg_stdin.take());
                    if let Some(mut child) = ffmpeg_child.take() {
                        let _ = child.kill().await;
                    }

                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

                    let mut child = Command::new("ffmpeg")
                        .kill_on_drop(true)
                        .args(&[
                            "-hide_banner",
                            "-loglevel", "error",
                            "-y",
                            "-use_wallclock_as_timestamps", "1",
                            "-f", "rawvideo", "-pixel_format", "yuv420p",
                            "-video_size", &format!("{}x{}", width, height),
                            "-framerate", "30", "-i", "-",
                            "-an",
                            "-vf", "vflip,hflip",
                            "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                            "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
                            "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
                            "-pix_fmt", "yuv420p", "-f", "flv", &rtmp_output,
                        ])
                        .stdin(Stdio::piped())
                        .stdout(Stdio::null())
                        .stderr(Stdio::inherit())
                        .spawn()
                        .expect("Failed to start FFmpeg");

                    ffmpeg_stdin = Some(child.stdin.take().unwrap());
                    ffmpeg_child = Some(child);
                }

                let (stride_y, stride_u, stride_v) = i420.strides();
                let (y_data, u_data, v_data) = i420.data();
                let mut raw_bytes = Vec::with_capacity((width * height * 3 / 2) as usize);

                for row in 0..(height as usize) {
                    let start = row * (stride_y as usize);
                    raw_bytes.extend_from_slice(&y_data[start..start + (width as usize)]);
                }
                for row in 0..((height / 2) as usize) {
                    let start = row * (stride_u as usize);
                    raw_bytes.extend_from_slice(&u_data[start..start + ((width / 2) as usize)]);
                }
                for row in 0..((height / 2) as usize) {
                    let start = row * (stride_v as usize);
                    raw_bytes.extend_from_slice(&v_data[start..start + ((width / 2) as usize)]);
                }

                if let Some(stdin) = ffmpeg_stdin.as_mut() {
                    let _ = stdin.write_all(&raw_bytes).await;
                }
            }

            let processed_frame = VideoFrame {
                rotation: VideoRotation::VideoRotation180,
                timestamp_us: frame.timestamp_us,
                buffer: i420,
            };
            source_clone.capture_frame(&processed_frame);
        }

        drop(ffmpeg_stdin.take());
        if let Some(mut child) = ffmpeg_child.take() {
            let _ = child.kill().await;
        }
    });
}
