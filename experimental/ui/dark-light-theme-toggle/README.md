# Arcade Theme Switcher

## Overview

The **ThemeSwitcher** is an arcade-themed, segmented dock component for selecting cyberpunk-inspired color palettes. It provides a visually striking interface with four distinct theme variants and full keyboard accessibility.

## Features

✨ **Four Cyberpunk Palette Variants:**
- **Neon Cyan** - Bright cyan glow on dark background (💎)
- **Synthwave Sunset** - Pink-to-gold gradient retro feel (🌅)
- **Matrix Green** - Classic green-on-black hacker aesthetic (🔢)
- **High Contrast** - Yellow-on-black for WCAG AAA accessibility (♿)

🎮 **Arcade Aesthetics:**
- Segmented dock with color dot previews
- Icon indicators for each theme
- Smooth CSS color transitions on theme change
- Glowing border and box shadow effects
- Backdrop blur for modern glass-morphism look

⌨️ **Full Keyboard Navigation:**
- **Left/Right Arrow Keys**: Navigate between themes
- **Home Key**: Jump to first theme (Neon Cyan)
- **End Key**: Jump to last theme (High Contrast)
- Circular navigation (wraps around at edges)

♿ **Accessibility:**
- ARIA `radiogroup` and `radio` roles
- Proper `aria-checked` attributes
- Semantic HTML with focus management
- High-contrast mode supports WCAG AAA standards

💾 **Local Storage Persistence:**
- Theme selection saved to `localStorage` (scoped to experimental namespace)
- Syncs across browser tabs
- Uses `useThemeStorage` hook for easy integration

## Installation

```bash
npm install @stellarcade/theme-switcher
# or
yarn add @stellarcade/theme-switcher
```

## Usage

### Basic Example

```tsx
import { ThemeSwitcher } from './ThemeSwitcher';
import { useThemeStorage } from './useThemeStorage';

export function App() {
  const { theme, saveTheme } = useThemeStorage();

  return (
    <ThemeSwitcher
      currentTheme={theme}
      onChangeTheme={saveTheme}
    />
  );
}
```

### Compact Mode

For tighter spaces, use the `compact` prop to hide labels and show only icons:

```tsx
<ThemeSwitcher
  currentTheme={theme}
  onChangeTheme={saveTheme}
  compact={true}
/>
```

### Manual Theme Management

If you prefer to manage theme state externally:

```tsx
const [theme, setTheme] = useState<ArcadeTheme>('neon-cyan');

<ThemeSwitcher
  currentTheme={theme}
  onChangeTheme={setTheme}
/>
```

### Custom Styling

```tsx
<ThemeSwitcher
  currentTheme={theme}
  onChangeTheme={saveTheme}
  className="my-custom-class"
  testId="custom-theme-switcher"
/>
```

## API

### ThemeSwitcher Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `currentTheme` | `ArcadeTheme` | ✓ | - | Currently active theme |
| `onChangeTheme` | `(theme: ArcadeTheme) => void` | ✓ | - | Callback when theme changes |
| `compact` | `boolean` | - | `false` | Icon-only layout mode |
| `className` | `string` | - | `''` | Additional CSS classes |
| `testId` | `string` | - | `'theme-switcher'` | Custom test ID |

### ArcadeTheme Type

```tsx
type ArcadeTheme = 'neon-cyan' | 'synthwave-sunset' | 'matrix-green' | 'high-contrast';
```

### useThemeStorage Hook

Manages theme persistence to local storage:

```tsx
const { theme, saveTheme, isHydrated } = useThemeStorage();

// theme: Current theme from storage
// saveTheme: Function to update and persist theme
// isHydrated: Whether localStorage has been loaded (hydration state)
```

## Theme Configuration

Each theme includes:
- **name**: Display name
- **color**: Primary accent color
- **bgColor**: Background color
- **textColor**: Text color for contrast
- **icon**: Emoji/symbol representation
- **cssVars**: CSS custom properties for easy integration

Access theme configs:

```tsx
import { THEME_CONFIGS } from './types';

const cyanConfig = THEME_CONFIGS['neon-cyan'];
console.log(cyanConfig.color); // '#00D9FF'
```

## Styling & Theming

The component uses **inline styles only** (no Tailwind classes) to prevent conflicts with global styles. The dock container dynamically updates its border color and glow effect based on the active theme.

### CSS Variables Available

Each theme provides CSS variables that can be accessed in your own styles:

```css
/* When 'neon-cyan' theme is active */
--theme-primary: #00D9FF;
--theme-secondary: #0A0E27;
--theme-accent: #00FFFF;
--theme-text: #FFFFFF;
--theme-bg: #0A0E27;
```

## Accessibility

### WCAG Compliance

- ✓ **ARIA Roles**: `radiogroup` and `radio` for semantic navigation
- ✓ **Keyboard Navigation**: Full arrow key support
- ✓ **Focus Management**: Proper tabindex handling
- ✓ **High Contrast Mode**: Meets WCAG AAA standards (21:1 contrast ratio)
- ✓ **Color Independence**: Icons and text don't rely solely on color

### Screen Reader Support

The component provides:
- Descriptive aria-labels for each theme button
- Proper `aria-checked` states
- Clear radiogroup labeling

## Testing

The component includes comprehensive unit tests using Vitest and React Testing Library:

```bash
# Run tests
vitest run

# Watch mode
vitest
```

### Test Coverage

- ✓ Renders all theme segments
- ✓ Theme switching via click
- ✓ Active state indicators
- ✓ Keyboard navigation (arrows, Home, End)
- ✓ Wraparound navigation
- ✓ Compact mode rendering
- ✓ Custom styling and test IDs
- ✓ Smooth color transitions

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Modern mobile browsers

## Limitations

- Does **not** affect global Tailwind or Next.js themes in `apps/web/`
- Confined to `experimental/ui/dark-light-theme-toggle/` directory
- Component-scoped styling only
- LocalStorage required for persistence (no SSR persistence)

## Future Enhancements

- [ ] Custom theme creation UI
- [ ] Theme import/export
- [ ] Animation customization options
- [ ] Synchronized state management (Context/Redux)
- [ ] Theme preview before switching

## Contributing

See the main repository's CONTRIBUTING.md for guidelines.

## License

MIT - See LICENSE file in root directory
