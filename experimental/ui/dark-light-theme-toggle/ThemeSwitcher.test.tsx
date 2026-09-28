/**
 * Unit tests for ThemeSwitcher component.
 * Tests keyboard navigation, theme switching, and accessibility features.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ThemeSwitcher } from './ThemeSwitcher';

describe('ThemeSwitcher', () => {
  it('renders all theme segments with color dot previews', () => {
    render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={vi.fn()}
      />
    );

    const radiogroup = screen.getByRole('radiogroup', {
      name: /arcade theme selector/i,
    });
    expect(radiogroup).toBeInTheDocument();

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(4);

    expect(screen.getByTestId('theme-button-neon-cyan')).toBeInTheDocument();
    expect(screen.getByTestId('theme-button-synthwave-sunset')).toBeInTheDocument();
    expect(screen.getByTestId('theme-button-matrix-green')).toBeInTheDocument();
    expect(screen.getByTestId('theme-button-high-contrast')).toBeInTheDocument();
  });

  it('clicking a theme segment calls onChangeTheme with correct theme', () => {
    const handleChange = vi.fn();

    render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={handleChange}
      />
    );

    const matrixButton = screen.getByTestId('theme-button-matrix-green');
    fireEvent.click(matrixButton);

    expect(handleChange).toHaveBeenCalledWith('matrix-green');
  });

  it('marks active theme with aria-checked="true"', () => {
    render(
      <ThemeSwitcher
        currentTheme="synthwave-sunset"
        onChangeTheme={vi.fn()}
      />
    );

    const sunsetButton = screen.getByTestId('theme-button-synthwave-sunset');
    expect(sunsetButton).toHaveAttribute('aria-checked', 'true');

    const cyanButton = screen.getByTestId('theme-button-neon-cyan');
    expect(cyanButton).toHaveAttribute('aria-checked', 'false');
  });

  it('keyboard right arrow navigates to next theme', () => {
    const handleChange = vi.fn();

    render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={handleChange}
      />
    );

    const cyanButton = screen.getByTestId('theme-button-neon-cyan');
    cyanButton.focus();

    fireEvent.keyDown(cyanButton, { key: 'ArrowRight' });

    expect(handleChange).toHaveBeenCalledWith('synthwave-sunset');
  });

  it('keyboard left arrow navigates to previous theme', () => {
    const handleChange = vi.fn();

    render(
      <ThemeSwitcher
        currentTheme="synthwave-sunset"
        onChangeTheme={handleChange}
      />
    );

    const sunsetButton = screen.getByTestId('theme-button-synthwave-sunset');
    sunsetButton.focus();

    fireEvent.keyDown(sunsetButton, { key: 'ArrowLeft' });

    expect(handleChange).toHaveBeenCalledWith('neon-cyan');
  });

  it('keyboard Home key navigates to first theme', () => {
    const handleChange = vi.fn();

    render(
      <ThemeSwitcher
        currentTheme="matrix-green"
        onChangeTheme={handleChange}
      />
    );

    const greenButton = screen.getByTestId('theme-button-matrix-green');
    greenButton.focus();

    fireEvent.keyDown(greenButton, { key: 'Home' });

    expect(handleChange).toHaveBeenCalledWith('neon-cyan');
  });

  it('keyboard End key navigates to last theme', () => {
    const handleChange = vi.fn();

    render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={handleChange}
      />
    );

    const cyanButton = screen.getByTestId('theme-button-neon-cyan');
    cyanButton.focus();

    fireEvent.keyDown(cyanButton, { key: 'End' });

    expect(handleChange).toHaveBeenCalledWith('high-contrast');
  });

  it('left arrow wraps from first theme to last', () => {
    const handleChange = vi.fn();

    render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={handleChange}
      />
    );

    const cyanButton = screen.getByTestId('theme-button-neon-cyan');
    cyanButton.focus();

    fireEvent.keyDown(cyanButton, { key: 'ArrowLeft' });

    expect(handleChange).toHaveBeenCalledWith('high-contrast');
  });

  it('right arrow wraps from last theme to first', () => {
    const handleChange = vi.fn();

    render(
      <ThemeSwitcher
        currentTheme="high-contrast"
        onChangeTheme={handleChange}
      />
    );

    const contrastButton = screen.getByTestId('theme-button-high-contrast');
    contrastButton.focus();

    fireEvent.keyDown(contrastButton, { key: 'ArrowRight' });

    expect(handleChange).toHaveBeenCalledWith('neon-cyan');
  });

  it('compact mode renders icon-only layout', () => {
    const { container } = render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={vi.fn()}
        compact={true}
      />
    );

    const buttons = screen.getAllByRole('radio');
    buttons.forEach((button) => {
      // In compact mode, buttons should be smaller and only show icon
      expect(button).toHaveStyle({ padding: '8px' });
    });
  });

  it('does not render global Tailwind styles', () => {
    const { container } = render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={vi.fn()}
      />
    );

    // Verify that the component uses inline styles, not Tailwind classes
    const dock = container.querySelector('[role="radiogroup"]');
    expect(dock).toHaveStyle({ display: 'inline-flex' });
    expect(dock?.className).not.toMatch(/bg-|text-|border-/);
  });

  it('applies custom className to dock container', () => {
    const { container } = render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={vi.fn()}
        className="custom-class"
      />
    );

    const dock = container.querySelector('[role="radiogroup"]');
    expect(dock?.className).toContain('custom-class');
  });

  it('uses custom test ID when provided', () => {
    render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={vi.fn()}
        testId="custom-theme-switcher"
      />
    );

    expect(screen.getByTestId('custom-theme-switcher')).toBeInTheDocument();
  });

  it('active theme button has smooth color transition', () => {
    const { rerender } = render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={vi.fn()}
      />
    );

    const cyanButton = screen.getByTestId('theme-button-neon-cyan');
    expect(cyanButton).toHaveStyle({ transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' });

    rerender(
      <ThemeSwitcher
        currentTheme="matrix-green"
        onChangeTheme={vi.fn()}
      />
    );

    const greenButton = screen.getByTestId('theme-button-matrix-green');
    expect(greenButton).toHaveStyle({ transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' });
  });

  it('dock border and glow reflect current theme color', () => {
    const { container, rerender } = render(
      <ThemeSwitcher
        currentTheme="neon-cyan"
        onChangeTheme={vi.fn()}
      />
    );

    let dock = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(dock.style.borderColor).toBe('#00D9FF');
    expect(dock.style.boxShadow).toContain('#00D9FF');

    rerender(
      <ThemeSwitcher
        currentTheme="matrix-green"
        onChangeTheme={vi.fn()}
      />
    );

    dock = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(dock.style.borderColor).toBe('#00FF00');
    expect(dock.style.boxShadow).toContain('#00FF00');
  });
});
