use async_nats::connect;
use futures::stream::StreamExt;
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::webrtc::audio_stream::native::NativeAudioStream;
use livekit::webrtc::prelude::*;
use livekit::webrtc::video_frame::{VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::webrtc::video_stream::native::NativeVideoStream;
use serde::Deserialize;
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::UdpSocket;
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

static UDP_PORT_COUNTER: AtomicU16 = AtomicU16::new(5000);

struct ParticipantState {
    latest_video: Option<livekit::webrtc::video_frame::I420Buffer>,
    audio_buffer: VecDeque<i16>,
}

struct RoomMixerState {
    participants: HashMap<String, ParticipantState>,
    quadrants: HashMap<String, usize>,
    next_quadrant: usize,
}

impl RoomMixerState {
    fn assign_quadrant(&mut self, id: &str) -> usize {
        if let Some(&q) = self.quadrants.get(id) { return q; }
        let q = self.next_quadrant % 4;
        self.quadrants.insert(id.to_string(), q);
        self.next_quadrant += 1;
        q
    }
}

struct AppState {
    active_rooms: Mutex<HashMap<String, Arc<Room>>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 Starting Rust TRUE Engine (Grid 2x2 + Audio + Loopback)...");

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
        println!("✅ Bot left room. Pipelines terminated.");
    }
    Ok(())
}

async fn start_render_session(contract: AdapterContract, state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error>> {
    let mut rooms = state.active_rooms.lock().await;
    if rooms.contains_key(&contract.room_name) { return Ok(()); }

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

    // Публикуем трек от имени обернутого в Arc room
    room_arc.local_participant().publish_track(LocalTrack::Video(local_track), publish_opts).await?;
    println!("✅ Bot is broadcasting Grid back to the Conference");

    let mixer_state = Arc::new(Mutex::new(RoomMixerState {
        participants: HashMap::new(),
        quadrants: HashMap::new(),
        next_quadrant: 0,
    }));

    let audio_udp_port = UDP_PORT_COUNTER.fetch_add(1, Ordering::SeqCst);

    let mut ffmpeg = Command::new("ffmpeg")
        .kill_on_drop(true)
        .args(&[
            "-hide_banner", "-loglevel", "warning", "-y",
            "-use_wallclock_as_timestamps", "1",

            "-thread_queue_size", "4096",
            "-f", "s16le", "-ar", "48000", "-ac", "1",
            "-i", &format!("udp://127.0.0.1:{}?fifo_size=1000000&overrun_nonfatal=1", audio_udp_port),

            "-thread_queue_size", "4096",
            "-f", "rawvideo", "-pixel_format", "yuv420p", "-video_size", "1280x720", "-framerate", "30",
            "-i", "-",

            "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
            "-c:a", "aac", "-b:a", "128k",
            "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
            "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
            "-pix_fmt", "yuv420p", "-f", "flv", &contract.rtmp_output,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("Failed to start FFmpeg Engine");

    let ffmpeg_stdin = ffmpeg.stdin.take().unwrap();

    spawn_video_engine(mixer_state.clone(), ffmpeg_stdin, video_source);
    spawn_audio_engine(mixer_state.clone(), audio_udp_port);

    tokio::spawn(async move {
        while let Some(event) = room_events.recv().await {
            match event {
                RoomEvent::TrackSubscribed { track, participant, .. } => {
                    let id = participant.identity().to_string();
                    let mut st = mixer_state.lock().await;

                    if !st.participants.contains_key(&id) {
                        st.assign_quadrant(&id);
                        st.participants.insert(id.clone(), ParticipantState {
                            latest_video: None,
                            audio_buffer: VecDeque::new()
                        });
                    }
                    drop(st);

                    match track {
                        RemoteTrack::Video(v) => spawn_video_receiver(v, id, mixer_state.clone()),
                        RemoteTrack::Audio(a) => spawn_audio_receiver(a, id, mixer_state.clone()),
                    }
                },
                RoomEvent::TrackUnsubscribed { participant, .. } => {
                    let id = participant.identity().to_string();
                    let mut st = mixer_state.lock().await;
                    st.participants.remove(&id);
                    st.quadrants.remove(&id);
                }
                _ => {}
            }
        }
        let _ = ffmpeg.kill().await;
    });

    Ok(())
}

fn spawn_video_receiver(track: RemoteVideoTrack, id: String, state: Arc<Mutex<RoomMixerState>>) {
    tokio::spawn(async move {
        let mut stream = NativeVideoStream::new(track.rtc_track());
        while let Some(frame) = stream.next().await {
            let i420 = frame.buffer.to_i420();
            let mut st = state.lock().await;
            if let Some(p) = st.participants.get_mut(&id) {
                p.latest_video = Some(i420);
            }
        }
    });
}

fn spawn_audio_receiver(track: RemoteAudioTrack, id: String, state: Arc<Mutex<RoomMixerState>>) {
    tokio::spawn(async move {
        let mut stream = NativeAudioStream::new(track.rtc_track(), 48000, 1);
        while let Some(frame) = stream.next().await {
            let samples = frame.data.as_ref();
            let mut st = state.lock().await;
            if let Some(p) = st.participants.get_mut(&id) {
                if p.audio_buffer.len() > 48000 { p.audio_buffer.drain(0..4000); }
                p.audio_buffer.extend(samples.iter());
            }
        }
    });
}

fn spawn_audio_engine(state: Arc<Mutex<RoomMixerState>>, udp_port: u16) {
    tokio::spawn(async move {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let target = format!("127.0.0.1:{}", udp_port);
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(10));
        let samples_per_10ms = 480;

        loop {
            interval.tick().await;
            let mut st = state.lock().await;
            let mut mixed_chunk = vec![0i32; samples_per_10ms];

            for p in st.participants.values_mut() {
                for i in 0..samples_per_10ms {
                    if let Some(sample) = p.audio_buffer.pop_front() {
                        mixed_chunk[i] += sample as i32;
                    }
                }
            }
            drop(st);

            let final_audio: Vec<i16> = mixed_chunk.into_iter()
                .map(|s| s.clamp(i16::MIN as i32, i16::MAX as i32) as i16)
                .collect();

            let mut byte_buffer = Vec::with_capacity(samples_per_10ms * 2);
            for sample in final_audio {
                byte_buffer.extend_from_slice(&sample.to_le_bytes());
            }

            let _ = socket.send_to(&byte_buffer, &target).await;
        }
    });
}

fn spawn_video_engine(
    state: Arc<Mutex<RoomMixerState>>,
    mut ffmpeg_stdin: tokio::process::ChildStdin,
    video_source: NativeVideoSource,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(33));
        let start_time = std::time::Instant::now();

        loop {
            interval.tick().await;

            let mut out_buffer = livekit::webrtc::video_frame::I420Buffer::new(1280, 720);

            let (dst_stride_y, dst_stride_u, dst_stride_v) = out_buffer.strides();
            let (dst_y, dst_u, dst_v) = out_buffer.data_mut();

            dst_y.fill(0);
            dst_u.fill(128);
            dst_v.fill(128);

            let st = state.lock().await;

            for (id, p) in st.participants.iter() {
                if let Some(i420) = &p.latest_video {
                    if let Some(&quadrant) = st.quadrants.get(id) {
                        let (offset_x, offset_y) = match quadrant {
                            0 => (0, 0),
                            1 => (640, 0),
                            2 => (0, 360),
                            _ => (640, 360),
                        };

                        let src_w = i420.width() as usize;
                        let src_h = i420.height() as usize;
                        if src_w == 0 || src_h == 0 { continue; }

                        let (src_stride_y, src_stride_u, src_stride_v) = i420.strides();
                        let (src_y, src_u, src_v) = i420.data();

                        for dy in 0..360 {
                            let sy = dy * src_h / 360;
                            let dst_row = (offset_y + dy) * (dst_stride_y as usize) + offset_x;
                            let src_row = sy * (src_stride_y as usize);
                            for dx in 0..640 {
                                let sx = dx * src_w / 640;
                                if dst_row + dx < dst_y.len() && src_row + sx < src_y.len() {
                                    dst_y[dst_row + dx] = src_y[src_row + sx];
                                }
                            }
                        }

                        for dy in 0..180 {
                            let sy = dy * (src_h / 2) / 180;
                            let dst_row_u = (offset_y / 2 + dy) * (dst_stride_u as usize) + (offset_x / 2);
                            let dst_row_v = (offset_y / 2 + dy) * (dst_stride_v as usize) + (offset_x / 2);
                            let src_row_u = sy * (src_stride_u as usize);
                            let src_row_v = sy * (src_stride_v as usize);

                            for dx in 0..320 {
                                let sx = dx * (src_w / 2) / 320;
                                if dst_row_u + dx < dst_u.len() && src_row_u + sx < src_u.len() {
                                    dst_u[dst_row_u + dx] = src_u[src_row_u + sx];
                                    dst_v[dst_row_v + dx] = src_v[src_row_v + sx];
                                }
                            }
                        }
                    }
                }
            }
            drop(st);

            let mut final_bytes = Vec::with_capacity(1280 * 720 * 3 / 2);
            final_bytes.extend_from_slice(dst_y);
            final_bytes.extend_from_slice(dst_u);
            final_bytes.extend_from_slice(dst_v);

            if let Err(_) = ffmpeg_stdin.write_all(&final_bytes).await {
                break;
            }

            let timestamp_us = start_time.elapsed().as_micros() as i64;
            let processed_frame = VideoFrame {
                rotation: VideoRotation::VideoRotation0,
                timestamp_us,
                buffer: out_buffer,
            };
            video_source.capture_frame(&processed_frame);
        }
    });
}
