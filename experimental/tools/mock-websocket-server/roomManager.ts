import type { ClientMessage, Room, RoomManagerOptions, SocketLike } from './types';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketRoomIndex = new Map<string, string>();
  private botTimers = new Map<string, NodeJS.Timeout>();

  constructor(private options: RoomManagerOptions = { botEnabled: false, botDelayMs: 3000 }) {}

  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  public joinRoom(roomId: string, playerId: string, socket?: SocketLike): Room {
    const room = this.rooms.get(roomId) ?? {
      id: roomId,
      players: [],
      state: {
        roomId,
        status: 'waiting',
        players: [],
      },
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };

    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) {
      room.players.push({
        id: playerId,
        name: playerId,
        joinedAt: Date.now(),
        socket,
      });
    } else if (socket) {
      player.socket = socket;
    }

    room.state = {
      ...room.state,
      roomId,
      players: room.players.map((entry) => ({ id: entry.id, name: entry.name })),
      status: room.players.length > 1 ? 'active' : 'waiting',
      lastUpdated: Date.now(),
    };
    room.lastUpdated = Date.now();

    if (socket) {
      socket.id = playerId;
      this.socketRoomIndex.set(playerId, roomId);
    }

    this.rooms.set(roomId, room);
    this.broadcast(roomId, {
      type: 'STATE_UPDATE',
      roomId,
      payload: {
        action: 'JOIN_ROOM',
        playerId,
        room: room.state,
      },
    });

    return room;
  }

  public leaveRoom(roomId: string, playerId: string): Room | undefined {
    const room = this.rooms.get(roomId);
    if (!room) {
      return undefined;
    }

    room.players = room.players.filter((entry) => entry.id !== playerId);
    room.state = {
      ...room.state,
      players: room.players.map((entry) => ({ id: entry.id, name: entry.name })),
      status: room.players.length > 1 ? 'active' : 'waiting',
      lastUpdated: Date.now(),
    };
    room.lastUpdated = Date.now();

    this.socketRoomIndex.delete(playerId);
    this.broadcast(roomId, {
      type: 'STATE_UPDATE',
      roomId,
      payload: {
        action: 'LEAVE_ROOM',
        playerId,
        room: room.state,
      },
    });

    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      return undefined;
    }

    this.rooms.set(roomId, room);
    return room;
  }

  public handleMessage(message: ClientMessage, socket?: SocketLike): void {
    if (!message.roomId) {
      return;
    }

    switch (message.type) {
      case 'JOIN_ROOM': {
        const playerId = message.playerId ?? socket?.id ?? `player-${Date.now()}`;
        this.joinRoom(message.roomId, playerId, socket);
        break;
      }
      case 'LEAVE_ROOM': {
        this.leaveRoom(message.roomId, message.playerId ?? socket?.id ?? 'unknown');
        break;
      }
      case 'PLAYER_ACTION': {
        const room = this.rooms.get(message.roomId);
        if (!room) {
          return;
        }
        const playerId = message.playerId ?? socket?.id ?? 'unknown';
        room.state = {
          ...room.state,
          lastAction: message.payload,
          actor: playerId,
          players: room.players.map((entry) => ({ id: entry.id, name: entry.name })),
          lastUpdated: Date.now(),
        };
        room.lastUpdated = Date.now();
        this.broadcast(message.roomId, {
          type: 'STATE_UPDATE',
          roomId: message.roomId,
          payload: {
            action: 'PLAYER_ACTION',
            playerId,
            state: room.state,
          },
        });
        break;
      }
      case 'CHAT_MESSAGE': {
        const room = this.rooms.get(message.roomId);
        if (!room) {
          return;
        }
        this.broadcast(message.roomId, {
          type: 'CHAT_MESSAGE',
          roomId: message.roomId,
          payload: {
            playerId: message.playerId ?? socket?.id ?? 'system',
            message: message.payload,
            sentAt: Date.now(),
          },
        });
        break;
      }
      case 'PING': {
        if (socket && typeof socket.send === 'function') {
          socket.send(JSON.stringify({ type: 'PONG', roomId: message.roomId }));
        }
        break;
      }
      default:
        break;
    }
  }

  public removeSocket(socket: SocketLike): void {
    const playerId = socket.id ?? 'unknown';
    const roomId = this.socketRoomIndex.get(playerId);
    if (!roomId) {
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.socketRoomIndex.delete(playerId);
      return;
    }

    room.players = room.players.filter((entry) => entry.id !== playerId);
    room.state = {
      ...room.state,
      players: room.players.map((entry) => ({ id: entry.id, name: entry.name })),
      status: room.players.length > 1 ? 'active' : 'waiting',
      lastUpdated: Date.now(),
    };
    room.lastUpdated = Date.now();

    this.socketRoomIndex.delete(playerId);
    this.broadcast(roomId, {
      type: 'STATE_UPDATE',
      roomId,
      payload: { action: 'DISCONNECT', playerId, room: room.state },
    });

    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      this.scheduleBotJoin(roomId);
      return;
    }

    this.rooms.set(roomId, room);
  }

  public scheduleBotJoin(roomId: string): void {
    if (!this.options.botEnabled) {
      return;
    }

    const existingTimer = this.botTimers.get(roomId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.addBotPlayer(roomId);
      this.botTimers.delete(roomId);
    }, this.options.botDelayMs);
    this.botTimers.set(roomId, timer);
  }

  public addBotPlayer(roomId: string): void {
    if (!this.options.botEnabled) {
      return;
    }

    const room = this.rooms.get(roomId);
    if (room && room.players.length > 0) {
      return;
    }

    const botPlayerId = `bot-${roomId}`;
    const socket: SocketLike = {
      id: botPlayerId,
      readyState: 1,
      send: () => undefined,
    };

    this.joinRoom(roomId, botPlayerId, socket);
    this.broadcast(roomId, {
      type: 'STATE_UPDATE',
      roomId,
      payload: {
        action: 'BOT_JOIN',
        playerId: botPlayerId,
        room: this.rooms.get(roomId)?.state,
      },
    });
  }

  private broadcast(roomId: string, message: ClientMessage & { payload?: unknown }): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const payload = JSON.stringify(message);
    room.players.forEach((player) => {
      if (player.socket && typeof player.socket.send === 'function') {
        player.socket.send(payload);
      }
    });
  }
}

export const createRoomManager = (options: Partial<RoomManagerOptions> = {}): RoomManager =>
  new RoomManager({
    botEnabled: false,
    botDelayMs: 3000,
    ...options,
  });
