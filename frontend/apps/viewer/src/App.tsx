import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './App.css';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [clientId] = useState(() => {
    const savedId = localStorage.getItem('viewerId');
    if (savedId) return savedId;

    const newId = crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36);
    localStorage.setItem('viewerId', newId);
    return newId;
  });

  const [isLive, setIsLive] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);

  const env = import.meta.env;
  const API_URL = env.VITE_API_URL || 'http://localhost:8080';
  const STREAM_URL = 'http://localhost:8888/live/test/index.m3u8';

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/api/stats?clientId=${clientId}`);
        if (res.ok) {
          const data = await res.json();
          setViewerCount(data.viewers);
        }
      } catch (e) {
        console.error(e);
      }
    };

    fetchStats();
    const intervalId = window.setInterval(fetchStats, 3000);

    return () => window.clearInterval(intervalId);
  }, [API_URL, clientId]);

  useEffect(() => {
    if (isLive) return;

    const intervalId = window.setInterval(async () => {
      try {
        const res = await fetch(`${STREAM_URL}?t=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
        });

        if (res.ok) {
          setIsLive(true);
        }
      } catch (e) {
        console.error(e);
      }
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [isLive, STREAM_URL]);

  useEffect(() => {
    if (!isLive || !videoRef.current) return;

    if (!Hls.isSupported()) {
      console.error('HLS is not supported in this browser');
      return;
    }

    const hls = new Hls({
      liveSyncDurationCount: 2,
      manifestLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 2,
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
  }, [isLive, STREAM_URL]);

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
        <p>Status: {isLive ? '🟢 LIVE' : '🔴 OFFLINE'}</p>
        <p style={{ color: '#fff', fontSize: '0.9rem', marginTop: '5px' }}>
          👁️ Viewers: {viewerCount}
        </p>
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
