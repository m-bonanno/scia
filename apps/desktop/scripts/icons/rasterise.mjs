// Run with Electron by draw-icons.ts: Chromium draws the SVG at each size, as vectors, and writes
// its pixels raw (<size>.rgba, not premultiplied). Usage: electron rasterise.mjs <svg> <out> <size>…
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const [svgPath, outDir, ...sizes] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

// Drawn by the CPU, so that two machines draw the same pixels.
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('about:blank');
  const svg = readFileSync(svgPath).toString('base64');
  for (const size of sizes.map(Number)) {
    const pixels = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,${svg}';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = ${String(size)};
      canvas.height = ${String(size)};
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, ${String(size)}, ${String(size)});
      const data = context.getImageData(0, 0, ${String(size)}, ${String(size)}).data;
      let binary = '';
      for (let i = 0; i < data.length; i += 0x8000)
        binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(binary);
    })()`);
    writeFileSync(join(outDir, `${String(size)}.rgba`), Buffer.from(pixels, 'base64'));
  }
  app.exit(0);
});
