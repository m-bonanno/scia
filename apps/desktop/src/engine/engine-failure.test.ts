import { describe, expect, it } from 'vitest';
import { EngineFailure, engineFailureNotice } from './engine-failure.ts';

const details = { port: 47821, logPath: 'C:\\Scia\\logs\\main.log' };

describe('engineFailureNotice', () => {
  it('names the port to an engine that never started, the one remedy that is known', () => {
    expect(engineFailureNotice(EngineFailure.NeverStarted, details)).toEqual({
      title: 'Scia cannot start',
      body: 'The download engine did not start. If another program is using port 47821, close it and open Scia again.\n\nTechnical details: C:\\Scia\\logs\\main.log',
    });
  });

  it('does not blame the network for an engine that started and keeps stopping', () => {
    const notice = engineFailureNotice(EngineFailure.KeepsStopping, details);

    expect(notice).toEqual({
      title: 'Scia has to close',
      body: 'The download engine keeps stopping, and Scia gave up starting it again. Open Scia again.\n\nTechnical details: C:\\Scia\\logs\\main.log',
    });
    expect(notice.body).not.toMatch(/port|network/);
  });
});
