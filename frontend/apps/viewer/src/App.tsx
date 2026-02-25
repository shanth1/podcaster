import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './App.css';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('🔴 WAITING FOR STREAM...');
  const [isMuted, setIsMuted] = useState(true);

  const STREAM_URL = 'http://localhost:8888/live/test/index.m3u8';

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !Hls.isSupported()) return;

    const hls = new Hls({
      manifestLoadingMaxRetry: -1,
      manifestLoadingRetryDelay: 2000,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 4,
    });

    hls.loadSource(STREAM_URL);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setStatus('🟢 LIVE');
      video.play().catch(() => console.log('Autoplay blocked by browser'));
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setStatus('🟡 WAITING FOR STREAM...');
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setStatus('🔴 OFFLINE');
        }
      }
    });

    return () => {
      hls.destroy();
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
        muted={isMuted}
        playsInline
      />
    </div>
  );
}

export default App;
