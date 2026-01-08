// Generate app icons for Sense PWA
// Run with: deno run --allow-write scripts/generate-icons.ts

function generateSVGIcon(size: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${size}" height="${size}" fill="#1e1e1e"/>

  <!-- Border -->
  <rect x="${size * 0.1}" y="${size * 0.1}"
        width="${size * 0.8}" height="${size * 0.8}"
        fill="none" stroke="#4ec9b0" stroke-width="${size * 0.02}"/>

  <!-- Letter S -->
  <text x="50%" y="50%"
        font-family="Arial, sans-serif"
        font-size="${size * 0.6}"
        font-weight="bold"
        fill="#4ec9b0"
        text-anchor="middle"
        dominant-baseline="central">S</text>
</svg>`;
}

async function generateIcons() {
  const sizes = [192, 512];

  for (const size of sizes) {
    const svg = generateSVGIcon(size);
    const filename = `client/icon-${size}.svg`;

    await Deno.writeTextFile(filename, svg);
    console.log(`✓ Generated ${filename}`);
  }

  console.log('\nTo convert SVG to PNG, you can:');
  console.log('1. Open scripts/generate-icons.html in a browser and download the PNGs');
  console.log('2. Or use ImageMagick: convert icon-192.svg icon-192.png');
  console.log('3. Or use an online converter');
}

generateIcons();
