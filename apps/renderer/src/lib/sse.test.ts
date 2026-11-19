import { describe, expect, it } from 'vitest';
import { SseParser } from './sse.ts';

describe('SseParser', () => {
  it('reads an event with its name and data', () => {
    expect(new SseParser().push('event: snapshot\ndata: {"a":1}\n\n')).toEqual([
      { event: 'snapshot', data: '{"a":1}' },
    ]);
  });

  it('waits for the rest of an event cut by the network', () => {
    const parser = new SseParser();
    expect(parser.push('event: snap')).toEqual([]);
    expect(parser.push('shot\ndata: {"a"')).toEqual([]);
    expect(parser.push(':1}\n')).toEqual([]);
    expect(parser.push('\nevent: snapshot\ndata: 2\n\n')).toEqual([
      { event: 'snapshot', data: '{"a":1}' },
      { event: 'snapshot', data: '2' },
    ]);
  });

  it('joins the lines of a long data field and names an unnamed event "message"', () => {
    expect(new SseParser().push('data: one\r\ndata: two\r\n\r\n')).toEqual([
      { event: 'message', data: 'one\ntwo' },
    ]);
  });

  it('ignores comments and blank keep-alives', () => {
    expect(new SseParser().push(': ping\n\n\n')).toEqual([]);
  });
});
