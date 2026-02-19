import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './App.css';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Connecting...');

  const STREAM_URL = 'http://localhost:8888/live/test/index.m3u8';

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls;

    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
      });

      hls.loadSource(STREAM_URL);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus('Live');
        video.play().catch((e) => console.log('Autoplay blocked:', e));
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setStatus('Stream offline');
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = STREAM_URL;
      video.addEventListener('loadedmetadata', () => {
        setStatus('Live');
        video.play();
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, []);

  return (
    <div className="viewer-container">
      <div className="ui-layer">
        <h1>Viewer App</h1>
        <p>Status: {status}</p>
        <p>100k+ Scale Ready</p>
      </div>

      <video
        ref={videoRef}
        className="video-layer"
        controls
        muted
        autoPlay
        playsInline
      />
    </div>
  );
}

export default App;
