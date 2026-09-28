import { describe, expect, it } from 'vitest';
import { RoomManager } from './roomManager';
import type { SocketLike } from './types';

const makeSocket = (id: string): SocketLike & { messages: string[] } => {
  const messages: string[] = [];
  return {
    id,
    readyState: 1,
    send: (data: string) => {
      messages.push(data);
    },
    messages,
  };
};

describe('RoomManager', () => {
  it('accepts a client connection and room join protocol', () => {
    const manager = new RoomManager({ botEnabled: false, botDelayMs: 3000 });
    const socket = makeSocket('player-1');

    manager.joinRoom('room-a', 'player-1', socket);

    const room = manager.getRoom('room-a');
    expect(room).toBeDefined();
    expect(room?.players).toHaveLength(1);
    expect(room?.state.status).toBe('waiting');
    expect(socket.messages.some((entry) => entry.includes('JOIN_ROOM'))).toBe(true);
  });

  it('broadcasts state updates to all clients in a room', () => {
    const manager = new RoomManager({ botEnabled: false, botDelayMs: 3000 });
    const socketA = makeSocket('player-1');
    const socketB = makeSocket('player-2');

    manager.joinRoom('room-a', 'player-1', socketA);
    manager.joinRoom('room-a', 'player-2', socketB);
    manager.handleMessage({ type: 'PLAYER_ACTION', roomId: 'room-a', playerId: 'player-1', payload: { action: 'move', x: 10, y: 20 } });

    const allMessages = [...socketA.messages, ...socketB.messages];
    expect(allMessages.some((entry) => entry.includes('PLAYER_ACTION'))).toBe(true);
    expect(manager.getRoom('room-a')?.state.lastAction).toEqual({ action: 'move', x: 10, y: 20 });
  });

  it('cleans up disconnected users without affecting other rooms', () => {
    const manager = new RoomManager({ botEnabled: false, botDelayMs: 3000 });
    const socketA = makeSocket('player-1');
    const socketB = makeSocket('player-2');
    const socketC = makeSocket('player-3');

    manager.joinRoom('room-a', 'player-1', socketA);
    manager.joinRoom('room-a', 'player-2', socketB);
    manager.joinRoom('room-b', 'player-3', socketC);

    manager.removeSocket(socketA);

    expect(manager.getRoom('room-a')?.players.map((player) => player.id)).toEqual(['player-2']);
    expect(manager.getRoom('room-b')?.players.map((player) => player.id)).toEqual(['player-3']);
  });
});
