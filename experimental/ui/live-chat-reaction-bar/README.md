# Live Chat Reaction Bar

Arcade-themed live match reaction bar component for experimental workspace.

## Usage
```tsx
import { LiveChatReactionBar } from "./LiveChatReactionBar";

<LiveChatReactionBar
  onSendReaction={(emoji) => console.log(emoji)}
  cooldownMs={1500}
/>
```
