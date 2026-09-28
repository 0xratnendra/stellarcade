import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MiniLeaderboardTicker } from './MiniLeaderboardTicker';
import type { TickerWinItem } from './types';

const wins: TickerWinItem[] = [{ id: '1', playerAddress: 'GABC...123', game: 'Dice', payout: '10 XLM', multiplier: 2 }];
describe('MiniLeaderboardTicker', () => {
  it('renders win items', () => { render(<MiniLeaderboardTicker wins={wins} />); expect(screen.getAllByText('GABC...123').length).toBeGreaterThan(0); });
  it('pauses on mouse enter', () => { render(<MiniLeaderboardTicker wins={wins} />); const region = screen.getByRole('region'); fireEvent.mouseEnter(region); expect(region.querySelector('.mlt__track')).toBeTruthy(); });
  it('selects an item', () => { const onSelectWin = vi.fn(); render(<MiniLeaderboardTicker wins={wins} onSelectWin={onSelectWin} />); fireEvent.click(screen.getAllByRole('button')[0]); expect(onSelectWin).toHaveBeenCalledWith(wins[0]); });
});
