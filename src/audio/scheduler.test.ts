import { expect, it } from 'vitest';
import { Scheduler, type AudioPort } from './scheduler';
import { diatonic, defaultKey } from '../music/harmony';
import { makeEvent, newSession } from '../state/session';
function fixture() {
  let time = 0;
  let cancellations = 0;
  const scheduled: { id: string; time: number; duration: number }[] = [];
  const port: AudioPort = {
    now: () => time,
    schedule: (e, t, d) => scheduled.push({ id: e.id, time: t, duration: d }),
    cancel: () => {
      cancellations++;
      scheduled.length = 0;
    },
  };
  const scheduler = new Scheduler(port, () => {});
  const events = diatonic(defaultKey)
    .slice(0, 2)
    .map((c, i) => ({ ...makeEvent(c, newSession(), String(i)), duration: 1 }));
  return {
    scheduler,
    events,
    scheduled,
    advance: (value: number) => {
      time = value;
      scheduler.tick();
    },
    get cancellations() {
      return cancellations;
    },
  };
}
it('schedules with audio timestamps and cancels pending events on Stop', () => {
  const f = fixture();
  f.scheduler.play(f.events, 60, false, () => f.events);
  expect(f.scheduled[0]).toEqual({ id: '0', time: 0.03, duration: 1 });
  f.advance(0.95);
  expect(f.scheduled[1].time).toBeCloseTo(1.03);
  f.scheduler.stop();
  f.advance(10);
  expect(f.scheduled).toHaveLength(0);
  expect(f.scheduler.state.beat).toBe(0);
});
it('pause/resume rearticulates the active chord for its remaining duration', () => {
  const f = fixture();
  f.scheduler.play(f.events, 60, false, () => f.events);
  f.advance(0.53);
  f.scheduler.pause();
  expect(f.scheduler.state.beat).toBeCloseTo(0.5);
  expect(f.scheduled).toHaveLength(0);
  f.advance(5);
  f.scheduler.resume();
  expect(f.scheduled[0].id).toBe('0');
  expect(f.scheduled[0].duration).toBeCloseTo(0.5);
});
it('tempo changes preserve beat and invalidate the old schedule', () => {
  const f = fixture();
  f.scheduler.play(f.events, 60, false, () => f.events);
  f.advance(0.53);
  f.scheduler.configure(120, false);
  expect(f.scheduled[0].duration).toBeCloseTo(0.25);
  expect(f.scheduler.state.beat).toBeCloseTo(0.5);
});
it('loop edits apply as a new snapshot without altering the current pass', () => {
  const f = fixture();
  let next = f.events;
  f.scheduler.play(f.events, 60, true, () => next);
  next = [{ ...f.events[0], id: 'edited', duration: 2 }];
  f.advance(1.95);
  expect(f.scheduled.at(-1)!.id).toBe('edited');
  expect(f.scheduled.at(-1)!.time).toBeCloseTo(2.03);
  expect(f.scheduler.state.event?.id).toBe('1');
  f.advance(2.04);
  expect(f.scheduler.state.event?.id).toBe('edited');
});
it('natural completion stops; stale events are skipped after a clock jump', () => {
  const f = fixture();
  f.scheduler.play(f.events, 60, false, () => f.events);
  f.advance(10);
  expect(f.scheduler.state.status).toBe('stopped');
  expect(f.scheduled).toHaveLength(0);
});
