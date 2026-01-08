# Mobile WebApp Setup

Sense is now configured as a Progressive Web App (PWA) that can be installed on mobile devices.

## Features

- **Full-screen mode**: No browser chrome when running as an installed app
- **Offline support**: Service worker caches resources for offline access
- **Touch-optimized**: Proper touch targets and gestures
- **Virtual keyboard handling**: Smart viewport adjustments when keyboard appears
- **Cross-device sync**: Single global session works across all devices
- **Safe area support**: Respects notches and rounded corners on modern devices

## Installation

### iOS (iPhone/iPad)

1. Open Safari and navigate to your Sense server (e.g., `http://192.168.1.x:8080`)
2. Tap the Share button (square with arrow pointing up)
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" in the top right
5. The app icon will appear on your home screen

### Android

1. Open Chrome and navigate to your Sense server
2. Tap the three-dot menu
3. Tap "Add to Home Screen" or "Install App"
4. Confirm the installation
5. The app icon will appear in your app drawer

## Icon Generation

Icons have been generated as SVG files. To create PNG versions:

**Option 1: Use the HTML generator**
```bash
open scripts/generate-icons.html
```
Then click the download buttons to save `icon-192.png` and `icon-512.png` to the `client/` directory.

**Option 2: Use ImageMagick**
```bash
convert client/icon-192.svg client/icon-192.png
convert client/icon-512.svg client/icon-512.png
```

**Option 3: Online converter**
Upload the SVG files to an online converter like cloudconvert.com

## Mobile Optimizations

### Virtual Keyboard
- Automatically adjusts layout when keyboard opens
- No scrollbars appear when typing
- Header stays visible
- Smooth transitions

### Touch Interactions
- Large touch targets (minimum 44px)
- Haptic feedback on button presses (if supported)
- Prevent accidental zoom
- Swipe gestures work naturally

### Cross-Device
- Start a task on your Mac
- Continue on your iPhone
- All changes sync in real-time
- No need to reload or reconnect

## Technical Details

- **Manifest**: `/client/manifest.json` - PWA configuration
- **Service Worker**: `/client/sw.js` - Offline support and caching
- **Icons**: SVG sources in `/client/`, PNG versions needed for installation
- **Viewport**: Uses `100dvh` for dynamic viewport height (handles mobile browsers)

## Troubleshooting

**App won't install**
- Make sure you're using HTTPS or localhost
- Check that icon files exist (icon-192.png and icon-512.png)
- Clear browser cache and try again

**Keyboard issues**
- The app uses visual viewport API for best keyboard handling
- On older devices, fallback to resize events
- Disable "Request Desktop Site" if enabled

**Connection issues**
- App works offline after first load
- WebSocket reconnects automatically when connection drops
- Check firewall allows port 8080
