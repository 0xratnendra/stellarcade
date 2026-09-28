# Asset Bundle Analyzer

A small CLI for auditing game asset folders and highlighting oversized or inefficient files.

## What it checks

- `.png`, `.webp`, `.mp3`, `.wav`, `.ogg`, and `.svg` assets
- Large uncompressed audio files (`.wav`) above the configured threshold
- Large textures (`.png`) without a `.webp` counterpart
- Total bundle payload size and per-category totals

## Usage

```bash
cd experimental/tools/asset-bundle-analyzer
npm install
npm run build
node dist/cli.js --dir ./public --max-image-kb 500 --max-audio-kb 1000
```

## Output

The CLI prints a category table such as:

```text
Asset bundle summary
Category | Files | Total
--- | ---: | ---:
Images | 12 | 1.3 MB
Audio | 4 | 800 KB
Vectors | 2 | 128 KB
Total bundle size | 18 | 2.2 MB
```
