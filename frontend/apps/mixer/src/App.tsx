import { useState } from 'react';
import './App.css';

function App() {
  const env = import.meta.env;
  const apiUrl = env.VITE_API_URL || 'http://localhost:8080';

  const [logMsgs, setLogMsgs] = useState<string[]>(['System Ready.']);

  const addLog = (msg: string) => {
    setLogMsgs((prev) =>
      [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 5)
    );
  };

  const sendCommand = async (cmd: string) => {
    try {
      addLog(`Sending command: ${cmd}...`);
      const res = await fetch(`${apiUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });

      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      addLog(`✅ Command ${cmd} accepted by Core.`);
    } catch (error) {
      addLog(`❌ Failed to send ${cmd}: ${error}`);
    }
  };

  return (
    <div className="mixer-container">
      <h1>Director's Mixer</h1>
      <p style={{ color: '#888' }}>Control Plane for Render Adapter</p>

      <div className="controls-grid">
        <button
          className="btn btn-start"
          onClick={() => sendCommand('START_RENDER')}
        >
          START GLOBAL STREAM
        </button>
        <button
          className="btn btn-stop"
          onClick={() => sendCommand('STOP_RENDER')}
        >
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
