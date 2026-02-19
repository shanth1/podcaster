import './App.css';

function App() {
  const env = import.meta.env;

  return (
    <div
      style={{
        fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
        textAlign: 'center',
      }}
    >
      <h1>{env.VITE_APP_NAME}</h1>
      <div
        style={{
          padding: '2rem',
          border: '1px solid #ccc',
          borderRadius: '8px',
          maxWidth: '600px',
          margin: '0 auto',
        }}
      >
        <h2>System Status</h2>
        <p>
          Frontend Architecture: <strong>Monorepo / Yarn Workspaces</strong>
        </p>

        <div
          style={{
            textAlign: 'left',
            background: '#f0f0f0',
            padding: '1rem',
            borderRadius: '4px',
            color: '#333',
          }}
        >
          <code>
            API_URL: {env.VITE_API_URL}
            <br />
            MODE: {env.MODE}
            <br />
            BASE_URL: {env.BASE_URL}
          </code>
        </div>

        <p style={{ marginTop: '1rem', color: '#666' }}>
          Это приложение Viewer. В будущем здесь будет PixiJS слой и HLS плеер.
        </p>
      </div>
    </div>
  );
}

export default App;
