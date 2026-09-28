# Mini leaderboard ticker

Experimental marquee for recent wins. It duplicates the item row for a seamless CSS transform loop, pauses on hover/focus, and honors `prefers-reduced-motion`.

`wins` items contain `id`, `playerAddress`, `game`, `payout`, and `multiplier`; optional `gameIcon` and `avatarUrl` add visual context. `onSelectWin` receives the clicked item.
