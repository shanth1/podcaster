import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './App.css';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Waiting for stream...');
  const [isMuted, setIsMuted] = useState(true);

  const STREAM_URL = 'http://localhost:8888/live/test/index.m3u8';

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls;
    let retryInterval: ReturnType<typeof setTimeout>;

    const initPlayer = () => {
      if (Hls.isSupported()) {
        hls = new Hls({
          lowLatencyMode: true,
          liveSyncDurationCount: 2,
          manifestLoadingMaxRetry: 2,
          manifestLoadingMaxRetryTimeout: 2000,
        });

        hls.loadSource(STREAM_URL);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus('🟢 LIVE');
          video.play().catch(() => console.log('Autoplay blocked'));
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setStatus('🔴 OFFLINE');
            hls.destroy();
            retryInterval = setTimeout(initPlayer, 3000);
          }
        });
      }
    };

    initPlayer();

    return () => {
      if (hls) hls.destroy();
      clearTimeout(retryInterval);
    };
  }, []);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  return (
    <div className="viewer-container">
      <div className="ui-layer">
        <h1>Global Stream</h1>
        <p>Status: {status}</p>
        <button
          onClick={toggleMute}
          style={{ marginTop: '10px', cursor: 'pointer' }}
        >
          {isMuted ? '🔇 Unmute' : '🔊 Mute'}
        </button>
      </div>

      <video
        ref={videoRef}
        className="video-layer"
        muted
        autoPlay
        playsInline
      />
    </div>
  );
}

export default App;
