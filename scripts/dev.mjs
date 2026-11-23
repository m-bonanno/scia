import { spawn } from 'node:child_process';
import { ENGINE_THREADPOOL_SIZE } from '@scia/contracts';

// The engine gets the threads it gets in the app (#182): Node reads them once, as it starts.
const engineEnv = { ...process.env, UV_THREADPOOL_SIZE: String(ENGINE_THREADPOOL_SIZE) };

const processes = [
  ['server', ['run', 'dev', '-w', '@scia/server'], engineEnv],
  ['renderer', ['run', 'dev', '-w', '@scia/renderer'], process.env],
].map(([name, args, env]) => {
  // Run npm's CLI through node: npm.cmd cannot be spawned on Windows without a shell.
  const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
    stdio: 'inherit',
    env,
  });
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
