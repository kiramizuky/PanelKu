/**
 * Generate custom background images for midnight & dracula themes
 * Run: node scripts/generate-bg.js
 */
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';


const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'src', 'public', 'images');

// ── Midnight Theme ──────────────────────────────────────
// Deep navy blue -> dark indigo gradient with subtle dots
const midnightSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0e1a" />
      <stop offset="35%" stop-color="#0f1a2e" />
      <stop offset="65%" stop-color="#0d1a33" />
      <stop offset="100%" stop-color="#070b14" />
    </linearGradient>
    <radialGradient id="glow1" cx="20%" cy="20%" r="50%">
      <stop offset="0%" stop-color="rgba(59,130,246,0.08)" />
      <stop offset="100%" stop-color="rgba(59,130,246,0)" />
    </radialGradient>
    <radialGradient id="glow2" cx="80%" cy="80%" r="50%">
      <stop offset="0%" stop-color="rgba(99,102,241,0.06)" />
      <stop offset="100%" stop-color="rgba(99,102,241,0)" />
    </radialGradient>
    <pattern id="dots" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
      <circle cx="30" cy="30" r="1" fill="rgba(59,130,246,0.04)" />
    </pattern>
    <pattern id="grid" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="120" y2="0" stroke="rgba(59,130,246,0.015)" stroke-width="1" />
      <line x1="0" y1="0" x2="0" y2="120" stroke="rgba(59,130,246,0.015)" stroke-width="1" />
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  <rect width="1920" height="1080" fill="url(#glow1)" />
  <rect width="1920" height="1080" fill="url(#glow2)" />
  <rect width="1920" height="1080" fill="url(#dots)" />
  <rect width="1920" height="1080" fill="url(#grid)" />
</svg>`;

// ── Dracula Theme ───────────────────────────────────────
// Dark purple -> magenta gradient with dracula-style patterns
const draculaSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1f2c" />
      <stop offset="30%" stop-color="#282a36" />
      <stop offset="60%" stop-color="#2d1f3a" />
      <stop offset="100%" stop-color="#1a1b26" />
    </linearGradient>
    <radialGradient id="glow1" cx="15%" cy="15%" r="45%">
      <stop offset="0%" stop-color="rgba(189,147,249,0.10)" />
      <stop offset="100%" stop-color="rgba(189,147,249,0)" />
    </radialGradient>
    <radialGradient id="glow2" cx="85%" cy="75%" r="40%">
      <stop offset="0%" stop-color="rgba(255,85,85,0.06)" />
      <stop offset="100%" stop-color="rgba(255,85,85,0)" />
    </radialGradient>
    <radialGradient id="glow3" cx="50%" cy="40%" r="35%">
      <stop offset="0%" stop-color="rgba(80,250,123,0.04)" />
      <stop offset="100%" stop-color="rgba(80,250,123,0)" />
    </radialGradient>
    <pattern id="dots" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
      <circle cx="40" cy="40" r="1.2" fill="rgba(189,147,249,0.04)" />
    </pattern>
    <pattern id="plus" x="0" y="0" width="160" height="160" patternUnits="userSpaceOnUse">
      <line x1="80" y1="76" x2="80" y2="84" stroke="rgba(139,233,253,0.025)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="76" y1="80" x2="84" y2="80" stroke="rgba(139,233,253,0.025)" stroke-width="1.5" stroke-linecap="round" />
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  <rect width="1920" height="1080" fill="url(#glow1)" />
  <rect width="1920" height="1080" fill="url(#glow2)" />
  <rect width="1920" height="1080" fill="url(#glow3)" />
  <rect width="1920" height="1080" fill="url(#dots)" />
  <rect width="1920" height="1080" fill="url(#plus)" />
</svg>`;

async function generate() {
  console.log('Generating bg2.png (Midnight theme)...');
  await sharp(Buffer.from(midnightSvg))
    .resize(1920, 1080)
    .png()
    .toFile(join(outDir, 'bg2.png'));
  console.log('  ✓ bg2.png created');

  console.log('Generating bg3.png (Dracula theme)...');
  await sharp(Buffer.from(draculaSvg))
    .resize(1920, 1080)
    .png()
    .toFile(join(outDir, 'bg3.png'));
  console.log('  ✓ bg3.png created');

  console.log('\nDone! Both background images generated.');
}

generate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
