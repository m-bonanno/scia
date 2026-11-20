// The file under dist/assets that the window shows as its icon. Windows reads every size it
// needs from the .ico — the title bar, the taskbar, Alt+Tab; Electron reads no .ico on Linux.
export function windowIconFile(platform: string): string {
  return platform === 'win32' ? 'icon.ico' : 'icon.png';
}
