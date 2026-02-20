# NATS Event Bus Contracts

## `adapter.command`
Controls the rendering engine state.
- **Publisher:** CLI / NATS Client
- **Subscriber:** Adapter
- **Payload:** `String`
  - `START_RENDER`: Starts the FFmpeg streaming process.
  - `STOP_RENDER`: Terminates the FFmpeg process gracefully.
