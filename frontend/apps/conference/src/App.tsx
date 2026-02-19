import { useState } from 'react';
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';
import './App.css';

function App() {
  const env = import.meta.env;

  const [url, setUrl] = useState(env.VITE_LIVEKIT_URL || 'ws://localhost:7880');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);

  if (connected) {
    return (
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={url}
        data-lk-theme="default"
        style={{ height: '100vh', width: '100vw' }}
        onDisconnected={() => setConnected(false)}
      >
        <VideoConference />
        <RoomAudioRenderer />

        <button
          onClick={() => setConnected(false)}
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}
        >
          Leave Room
        </button>
      </LiveKitRoom>
    );
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{env.VITE_APP_NAME}</h1>
      <p>Enter connection details to join the podcaster room.</p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          maxWidth: '400px',
          margin: '0 auto',
          padding: '2rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
        }}
      >
        <label style={{ textAlign: 'left' }}>
          LiveKit server URL:
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', marginTop: '0.5rem' }}
          />
        </label>

        <label style={{ textAlign: 'left' }}>
          Access Token:
          <input
            type="password"
            placeholder="ey..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', marginTop: '0.5rem' }}
          />
        </label>

        <button
          onClick={() => setConnected(true)}
          disabled={!token || !url}
          style={{ padding: '0.75rem', marginTop: '1rem' }}
        >
          Connect to LiveKit
        </button>
      </div>
    </div>
  );
}

export default App;
