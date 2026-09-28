export type RoomMessageType =
  | 'JOIN_ROOM'
  | 'LEAVE_ROOM'
  | 'PLAYER_ACTION'
  | 'CHAT_MESSAGE'
  | 'STATE_UPDATE'
  | 'PING'
  | 'PONG';

export interface SocketLike {
  id?: string;
  readyState?: number;
  send: (data: string) => void;
  close?: () => void;
  ping?: () => void;
  on?: (event: 'pong', handler: () => void) => void;
}

export interface ClientMessage<T = unknown> {
  type: RoomMessageType;
  roomId?: string;
  playerId?: string;
  payload?: T;
  timestamp?: number;
}

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  socket?: SocketLike;
}

export interface Room {
  id: string;
  players: Player[];
  state: Record<string, unknown>;
  createdAt: number;
  lastUpdated: number;
}

export interface RoomManagerOptions {
  botEnabled: boolean;
  botDelayMs: number;
}
