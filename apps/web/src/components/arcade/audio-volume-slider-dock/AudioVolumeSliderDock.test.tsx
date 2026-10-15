import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AudioVolumeSliderDock } from './AudioVolumeSliderDock';

describe('AudioVolumeSliderDock', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders closed dock with trigger button and correct wave icon when unmuted', () => {
    render(
      <AudioVolumeSliderDock
        initialVolume={80}
        isMuted={false}
        onVolumeChange={vi.fn()}
        onToggleMute={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('audio-volume-slider-dock-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Popover closed initially
    expect(
      screen.queryByTestId('audio-volume-slider-dock-popover'),
    ).not.toBeInTheDocument();

    // Wave icon present
    expect(
      screen.getByTestId('audio-volume-slider-dock-wave-icon'),
    ).toBeInTheDocument();
  });

  it('renders muted icon when isMuted is true', () => {
    render(
      <AudioVolumeSliderDock
        initialVolume={80}
        isMuted={true}
        onVolumeChange={vi.fn()}
        onToggleMute={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId('audio-volume-slider-dock-muted-icon'),
    ).toBeInTheDocument();
  });

  it('toggles popover open and closed on trigger button click', () => {
    render(
      <AudioVolumeSliderDock
        initialVolume={75}
        isMuted={false}
        onVolumeChange={vi.fn()}
        onToggleMute={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('audio-volume-slider-dock-trigger');

    // Click to open
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByTestId('audio-volume-slider-dock-popover'),
    ).toBeInTheDocument();

    // Click to close
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByTestId('audio-volume-slider-dock-popover'),
    ).not.toBeInTheDocument();
  });

  it('slider change calls onVolumeChange and updates localStorage', () => {
    const handleVolumeChange = vi.fn();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(
      <AudioVolumeSliderDock
        initialVolume={50}
        isMuted={false}
        onVolumeChange={handleVolumeChange}
        onToggleMute={vi.fn()}
        storageKey="test_volume_key"
      />,
    );

    // Open popover
    fireEvent.click(screen.getByTestId('audio-volume-slider-dock-trigger'));

    const slider = screen.getByTestId('audio-volume-slider-dock-slider');
    fireEvent.change(slider, { target: { value: '90' } });

    expect(handleVolumeChange).toHaveBeenCalledWith(90);
    expect(setItemSpy).toHaveBeenCalledWith('test_volume_key', '90');
  });

  it('clicking mute button calls onToggleMute without resetting volume', () => {
    const handleToggleMute = vi.fn();

    render(
      <AudioVolumeSliderDock
        initialVolume={60}
        isMuted={false}
        onVolumeChange={vi.fn()}
        onToggleMute={handleToggleMute}
      />,
    );

    // Open popover
    fireEvent.click(screen.getByTestId('audio-volume-slider-dock-trigger'));

    const muteBtn = screen.getByTestId('audio-volume-slider-dock-mute-button');
    fireEvent.click(muteBtn);

    expect(handleToggleMute).toHaveBeenCalledTimes(1);
  });

  it('clicking outside the popover closes it', () => {
    render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <AudioVolumeSliderDock
          initialVolume={50}
          isMuted={false}
          onVolumeChange={vi.fn()}
          onToggleMute={vi.fn()}
        />
      </div>,
    );

    const trigger = screen.getByTestId('audio-volume-slider-dock-trigger');
    fireEvent.click(trigger);
    expect(
      screen.getByTestId('audio-volume-slider-dock-popover'),
    ).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside-area'));
    expect(
      screen.queryByTestId('audio-volume-slider-dock-popover'),
    ).not.toBeInTheDocument();
  });

  it('pressing Escape key inside popover closes it', () => {
    render(
      <AudioVolumeSliderDock
        initialVolume={50}
        isMuted={false}
        onVolumeChange={vi.fn()}
        onToggleMute={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('audio-volume-slider-dock-trigger');
    fireEvent.click(trigger);

    const popover = screen.getByTestId('audio-volume-slider-dock-popover');
    fireEvent.keyDown(popover, { key: 'Escape' });

    expect(
      screen.queryByTestId('audio-volume-slider-dock-popover'),
    ).not.toBeInTheDocument();
  });

  it('preset buttons change volume level', () => {
    const handleVolumeChange = vi.fn();

    render(
      <AudioVolumeSliderDock
        initialVolume={50}
        isMuted={false}
        onVolumeChange={handleVolumeChange}
        onToggleMute={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('audio-volume-slider-dock-trigger'));

    const preset100 = screen.getByTestId('audio-volume-slider-dock-preset-100');
    fireEvent.click(preset100);

    expect(handleVolumeChange).toHaveBeenCalledWith(100);
  });
});
