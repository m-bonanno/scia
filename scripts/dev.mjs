import { spawn } from 'node:child_process';

const processes = [
  ['server', ['run', 'dev', '-w', '@scia/server']],
  ['renderer', ['run', 'dev', '-w', '@scia/renderer']],
].map(([name, args]) => {
  // Run npm's CLI through node: npm.cmd cannot be spawned on Windows without a shell.
  const child = spawn(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    stopAll();
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill();
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
