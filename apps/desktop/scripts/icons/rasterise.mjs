// Run with Electron by draw-icons.ts: Chromium draws the SVG at each size, as vectors, and writes
// its pixels raw (<size>.rgba, not premultiplied). Usage: electron rasterise.mjs <svg> <out> <size>…
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const [svgPath, outDir, ...sizes] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

// Drawn by the CPU, so that a run is repeatable: the lock turns any change of pixels into a diff.
app.disableHardwareAcceleration();

async function draw() {
  const window = new BrowserWindow({ show: false });
  await window.loadURL('about:blank');
  const svg = readFileSync(svgPath).toString('base64');
  for (const size of sizes.map(Number)) {
    const pixels = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = 'data:image/svg+xml;base64,${svg}';
      // A DOMException crosses executeJavaScript as an empty object: say it as a sentence.
      await image.decode().catch((error) => {
        throw new Error('the SVG does not decode: ' + String(error?.message ?? error));
      });
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
}

// Every way out ends the process: a rejection left alone keeps Electron alive with its window.
app
  .whenReady()
  .then(draw)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(`Chromium could not draw ${svgPath}: ${error?.message ?? String(error)}`);
      app.exit(1);
    },
  );
