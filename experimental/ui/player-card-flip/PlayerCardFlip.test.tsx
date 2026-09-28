import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlayerCardFlip } from './PlayerCardFlip';
const player = { gamertag: 'Nova', rank: 'Gold', winRate: 64, badges: [{ id: '1', name: 'First win' }], totalWagered: '100 XLM', joinDate: '2025-01-01' };
describe('PlayerCardFlip', () => { it('renders front stats and toggles faces', () => { render(<PlayerCardFlip player={player} />); expect(screen.getByText('Nova')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Show achievements' })); expect(screen.getByText("Nova's achievements")).toBeTruthy(); }); it('renders badges on back', () => { render(<PlayerCardFlip player={{ ...player, badges: [{ id: 'b', name: 'Lucky' }] }} defaultFlipped />); expect(screen.getByText('Lucky')).toBeTruthy(); }); });
