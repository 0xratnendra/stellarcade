import { WebSocket, WebSocketServer } from 'ws';
import { RoomManager } from './roomManager';
import { ClientMessage, SocketLike } from './types';

export interface MockWebSocketServerOptions {
  port?: number;
  botEnabled?: boolean;
  botDelayMs?: number;
}

export class MockWebSocketServer {
  public readonly manager: RoomManager;
  private server: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly port: number;

  constructor(options: MockWebSocketServerOptions = {}) {
    this.port = options.port ?? 8089;
    this.manager = new RoomManager({
      botEnabled: options.botEnabled ?? true,
      botDelayMs: options.botDelayMs ?? 3000,
    });
  }

  public start(): WebSocketServer {
    if (this.server) {
      return this.server;
    }

    this.server = new WebSocketServer({ port: this.port });

    this.server.on('connection', (socket: WebSocket) => {
      const socketLike: SocketLike = {
        id: undefined,
        readyState: socket.readyState,
        send: (data: string) => socket.send(data),
        close: () => socket.close(),
        ping: () => socket.ping(),
        on: (event, handler) => socket.on(event, handler),
      };

      socket.on('message', (rawMessage) => {
        try {
          const parsed = JSON.parse(rawMessage.toString()) as ClientMessage;
          this.manager.handleMessage(parsed, socketLike);
        } catch (error) {
          socket.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Invalid JSON message' } }));
        }
      });

      socket.on('close', () => {
        this.manager.removeSocket(socketLike);
      });

      socket.on('pong', () => {
        socketLike.readyState = socket.readyState;
      });
    });

    this.heartbeat = setInterval(() => {
      if (!this.server) {
        return;
      }

      this.server.clients.forEach((socket: WebSocket) => {
        if (socket.readyState !== WebSocket.OPEN) {
          socket.terminate();
          return;
        }

        socket.ping();
      });
    }, 30000);

    return this.server;
  }

  public close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

export const createMockWebSocketServer = (options: MockWebSocketServerOptions = {}): MockWebSocketServer =>
  new MockWebSocketServer(options);

if (require.main === module) {
  const server = createMockWebSocketServer({
    port: Number(process.env.PORT ?? 8089),
    botEnabled: process.env.BOT_ENABLED !== 'false',
    botDelayMs: Number(process.env.BOT_DELAY_MS ?? 3000),
  });
  server.start();
  console.log(`Mock WebSocket server started on port ${server['port'] ?? Number(process.env.PORT ?? 8089)}`);
}
