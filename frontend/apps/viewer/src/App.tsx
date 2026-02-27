import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './App.css';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

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

  // 1. СЧЕТЧИК ЗРИТЕЛЕЙ
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
    const interval = window.setInterval(fetchStats, 3000);
    return () => window.clearInterval(interval);
  }, [API_URL, clientId]);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/status`);
        if (res.ok) {
          const data = await res.json();
          setIsLive(data.live);
        }
      } catch (e) {
        console.error(e);
        setIsLive(false);
      }
    };

    // Спрашиваем бэкенд каждую секунду
    const interval = window.setInterval(checkStatus, 1000);
    return () => window.clearInterval(interval);
  }, [API_URL]);

  // 3. ЖЕСТКОЕ УПРАВЛЕНИЕ ПЛЕЕРОМ
  useEffect(() => {
    // Если бэкенд сказал, что стрима нет -> убиваем всё
    if (!isLive) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load(); // Очищаем экран в черный цвет
      }
      return;
    }

    if (!videoRef.current || !Hls.isSupported()) return;

    const hls = new Hls({
      liveSyncDurationCount: 2,
      manifestLoadingMaxRetry: -1,
    });

    hls.loadSource(`${STREAM_URL}?t=${Date.now()}`);
    hls.attachMedia(videoRef.current);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoRef.current?.play().catch(() => console.log('Autoplay blocked'));
    });

    hlsRef.current = hls;

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
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
