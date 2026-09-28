# Mock WebSocket Server

A lightweight local multiplayer socket server for testing lobby flows without backend services.

## Features

- Starts a WebSocket listener on port `8089` by default
- Supports `JOIN_ROOM`, `LEAVE_ROOM`, and `PLAYER_ACTION` messages
- Broadcasts state updates to all participants in the same room
- Auto-joins empty rooms with a bot after the configured delay
- Sends periodic ping/pong heartbeats and removes dead sockets automatically

## Usage

```bash
cd experimental/tools/mock-websocket-server
npm install
npm run build
npm start
```

### Environment variables

- `PORT` - socket port (default `8089`)
- `BOT_ENABLED` - enable or disable mock bot joins (`true`/`false`)
- `BOT_DELAY_MS` - delay before an empty room gets a mock opponent

### Sample client payload

```json
{ "type": "JOIN_ROOM", "roomId": "arena-1", "playerId": "p1" }
```

```json
{ "type": "PLAYER_ACTION", "roomId": "arena-1", "playerId": "p1", "payload": { "kind": "move", "x": 10, "y": 20 } }
```

## Tests

```bash
npm test
```
