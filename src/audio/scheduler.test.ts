import { expect, it } from 'vitest';
import { Scheduler, type AudioPort } from './scheduler';
import { diatonic, defaultKey } from '../music/harmony';
import { makeEvent, newSession } from '../state/session';
import { buildBridge } from '../music/modulation';
import { generateMelody, defaultMelody } from '../music/melody';
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
it('schedules and pauses both parts against the same clock and resumes partial melody notes', () => {
  let time = 0;
  const scheduled: { part: string; at: number; duration: number }[] = [];
  const scheduler = new Scheduler(
    {
      now: () => time,
      schedule: (_e, at, duration) =>
        scheduled.push({ part: 'chord', at, duration }),
      scheduleMelody: (_n, at, duration) =>
        scheduled.push({ part: 'melody', at, duration }),
      cancel: () => {
        scheduled.length = 0;
      },
    },
    () => {},
  );
  const events = generateMelody(
    [makeEvent(diatonic(defaultKey)[0], newSession(), 'chord')],
    { ...defaultMelody(), enabled: true },
  );
  scheduler.play(events, 60, false, () => events);
  expect(scheduled.map((n) => n.part)).toEqual(['chord', 'melody']);
  expect(scheduled[0].at).toBe(scheduled[1].at);
  time = 0.43;
  scheduler.tick();
  expect(scheduler.state.melody?.midi).toBe(events[0].melody![0].midi);
  scheduler.pause();
  expect(scheduled).toEqual([]);
  expect(scheduler.state.melody).toBeNull();
  time = 2;
  scheduler.resume();
  expect(scheduled[1].duration).toBeCloseTo(
    events[0].melody![0].duration - 0.4,
  );
  scheduler.stop();
  time = 10;
  scheduler.tick();
  expect(scheduled).toEqual([]);
});
it('keeps key and sound in the same snapshot through lookahead, pause, tempo, loop and Stop', () => {
  const f = fixture();
  const g = {
    tonic: { letter: 'G' as const, accidental: 0 },
    mode: 'major' as const,
  };
  const events = buildBridge({
    from: defaultKey,
    to: g,
    duration: 1,
    seventh: false,
    policy: 'root',
    cadence: false,
  });
  f.scheduler.play(events, 60, true, () => events);
  f.advance(2.95); // G is scheduled at 3.03, but D7 is still sounding.
  expect(f.scheduled.at(-1)?.id).toBe('bridge-3');
  expect(f.scheduler.state.key).toEqual(defaultKey);
  expect(f.scheduler.state.event?.chord.quality).toBe('7');
  f.scheduler.pause();
  expect(f.scheduler.state.key).toEqual(defaultKey);
  f.advance(5);
  f.scheduler.configure(120, true);
  f.scheduler.resume();
  f.advance(5.075);
  expect(f.scheduler.state.key).toEqual(g);
  expect(f.scheduler.state.event?.id).toBe('bridge-3');
  events[0].key = g; // Already playing snapshot cannot be rewritten by edits.
  f.advance(5.54);
  expect(f.scheduler.state.cycle).toBe(0);
  f.advance(5.58);
  expect(f.scheduler.state.cycle).toBe(1);
  expect(f.scheduler.state.event?.id).toBe('bridge-0');
  expect(f.scheduler.state.key).toEqual(g); // Updated next snapshot.
  f.scheduler.stop();
  f.advance(20);
  expect(f.scheduler.state.key).toBeUndefined();
  expect(f.scheduled).toEqual([]);
});
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
it('pauses after missing a loop rather than replaying accumulated cycles', () => {
  const f = fixture();
  f.scheduler.play(f.events, 60, true, () => f.events);
  f.advance(10);
  expect(f.scheduler.state.status).toBe('paused');
  expect(f.scheduled).toHaveLength(0);
  f.scheduler.resume();
  expect(f.scheduled[0].time).toBeGreaterThan(10);
});
it('schedules short loops through the whole lookahead window', () => {
  const f = fixture();
  const short = [{ ...f.events[0], duration: 0.25 }];
  f.scheduler.play(short, 200, true, () => short);
  expect(f.scheduled).toHaveLength(2);
  expect(f.scheduled[1].time).toBeCloseTo(0.105);
});
it('keeps the prepared next phrase across pause/resume and tempo changes at a boundary', () => {
  const f = fixture();
  const requests: number[] = [];
  const source = (cycle: number) => {
    requests.push(cycle);
    return f.events.map((e) => ({ ...e, id: `phrase-${cycle}-${e.id}` }));
  };
  f.scheduler.play(f.events, 60, true, source);
  f.advance(1.95); // Phrase 1 is already reserved, but phrase 0 still sounds.
  expect(requests).toEqual([1]);
  expect(f.scheduler.state.cycle).toBe(0);
  f.scheduler.pause();
  f.advance(4);
  f.scheduler.resume();
  expect(requests).toEqual([1, 1]);
  f.advance(4.12);
  expect(f.scheduler.state.cycle).toBe(1);
  expect(f.scheduler.state.event?.id).toBe('phrase-1-0');
  f.scheduler.configure(120, true);
  expect(f.scheduler.state.cycle).toBe(1);
  f.advance(5.08);
  expect(requests.at(-1)).toBe(2);
  f.scheduler.stop();
  f.advance(10);
  expect(f.scheduled).toHaveLength(0);
});
it('shows the prepared next phrase before reservation and retains the preceding chord at its boundary', () => {
  const f = fixture();
  const next = f.events.map((e) => ({ ...e, id: `next-${e.id}` }));
  let reads = 0;
  f.scheduler.play(
    f.events,
    60,
    true,
    () => {
      reads++;
      return next;
    },
    0,
    0,
    () => next,
  );
  f.advance(1.2);
  expect(reads).toBe(0);
  expect(f.scheduler.state.next?.id).toBe('next-0');
  f.advance(1.95);
  expect(reads).toBe(1);
  f.advance(2.04);
  expect(f.scheduler.state.previous?.id).toBe('1');
  f.advance(2.2);
  expect(f.scheduler.state.previous?.id).toBe('1');
});
