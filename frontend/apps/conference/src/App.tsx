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

  const [roomName, setRoomName] = useState('Studio1');
  const [identity, setIdentity] = useState(
    `Podcaster_${Math.floor(Math.random() * 1000)}`
  );
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const apiUrl = env.VITE_API_URL || 'http://localhost:8080';
      const res = await fetch(
        `${apiUrl}/api/join?room=${roomName}&identity=${identity}`
      );

      if (!res.ok) throw new Error('Failed to fetch token');

      const data = await res.json();
      setToken(data.token);
    } catch (err) {
      console.error(err);
      alert('Error fetching token. Is backend running?');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setToken('');
  };

  if (token) {
    return (
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={env.VITE_LIVEKIT_URL || 'ws://localhost:7880'}
        data-lk-theme="default"
        style={{ height: '100vh', width: '100vw' }}
        onDisconnected={handleDisconnect}
      >
        <VideoConference />
        <RoomAudioRenderer />
        <button
          onClick={handleDisconnect}
          style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000 }}
        >
          Leave
        </button>
      </LiveKitRoom>
    );
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Podcaster Setup</h1>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          maxWidth: '300px',
          margin: '0 auto',
          padding: '2rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
        }}
      >
        <label style={{ textAlign: 'left' }}>
          Room Name:
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <label style={{ textAlign: 'left' }}>
          Your Name (Identity):
          <input
            type="text"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <button
          onClick={handleConnect}
          disabled={connecting}
          style={{ padding: '0.75rem' }}
        >
          {connecting ? 'Connecting...' : 'Join Room'}
        </button>
      </div>
    </div>
  );
}

export default App;
