import { useState } from 'react';
import './App.css';

function App() {
  const env = import.meta.env;
  const apiUrl = env.VITE_API_URL || 'http://localhost:8080';

  const [logMsgs, setLogMsgs] = useState<string[]>(['System Ready.']);
  const roomToControl = 'Studio1';

  const addLog = (msg: string) => {
    setLogMsgs((prev) =>
      [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 5)
    );
  };

  const sendCommand = async (action: 'START' | 'STOP') => {
    try {
      addLog(`Sending desired state: ${action}...`);
      const res = await fetch(`${apiUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, room: roomToControl }),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      addLog(`✅ State ${action} accepted by Core.`);
    } catch (error) {
      addLog(`❌ Failed to send ${action}: ${error}`);
    }
  };

  return (
    <div className="mixer-container">
      <h1>Director's Mixer</h1>
      <p style={{ color: '#888' }}>Control Plane (Room: {roomToControl})</p>

      <div className="controls-grid">
        <button className="btn btn-start" onClick={() => sendCommand('START')}>
          START GLOBAL STREAM
        </button>
        <button className="btn btn-stop" onClick={() => sendCommand('STOP')}>
          STOP STREAM
        </button>
      </div>

      <div className="status-panel">
        {logMsgs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
