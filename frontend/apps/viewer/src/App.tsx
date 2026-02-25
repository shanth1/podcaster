import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './App.css';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLive, setIsLive] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const STREAM_URL = 'http://localhost:8888/live/test/index.m3u8';

  useEffect(() => {
    if (isLive) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${STREAM_URL}?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          setIsLive(true);
        }
      } catch (e) {}
    }, 2000);

    return () => clearInterval(interval);
  }, [isLive]);

  useEffect(() => {
    if (!isLive || !videoRef.current) return;

    const hls = new Hls({
      liveSyncDurationCount: 2,
      manifestLoadingMaxRetry: 1,
      fragLoadingMaxRetry: 1,
    });

    hls.loadSource(`${STREAM_URL}?t=${Date.now()}`);
    hls.attachMedia(videoRef.current);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoRef.current?.play().catch(() => console.log('Autoplay blocked'));
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        hls.destroy();
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        }
        setIsLive(false);
      }
    });

    return () => {
      hls.destroy();
    };
  }, [isLive]);

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
        <p>Status: {isLive ? '🟢 LIVE' : '🔴 OFFLINE / WAITING'}</p>
        <button
          onClick={toggleMute}
          style={{ marginTop: '10px', cursor: 'pointer' }}
          disabled={!isLive}
        >
          {isMuted ? '🔇 Unmute' : '🔊 Mute'}
        </button>
      </div>
      <video
        ref={videoRef}
        className="video-layer"
        muted={isMuted}
        playsInline
        style={{ backgroundColor: '#000' }}
      />
    </div>
  );
}

export default App;
