import { expect, it } from 'vitest';
import { LiveScheduler, type LivePort } from './live';
import { defaultMelody, type MelodyNote } from '../music/melody';
import { diatonic, defaultKey } from '../music/harmony';
import {
  makeEvent,
  newSession,
  exportSession,
  importSession,
  editSession,
} from '../state/session';
function fixture() {
  let time = 0;
  const scheduled: { id: string; start: number; end: number; part: string }[] =
    [];
  const cuts: number[] = [];
  const port: LivePort = {
    now: () => time,
    schedule: (e, start, duration) =>
      scheduled.push({ id: e.id, start, end: start + duration, part: 'chord' }),
    scheduleMelody: (n: MelodyNote, start, duration) =>
      scheduled.push({
        id: String(n.midi),
        start,
        end: start + duration,
        part: 'melody',
      }),
    cancel: () => {
      scheduled.length = 0;
    },
    cancelAt: (at) => {
      cuts.push(at);
      for (const s of scheduled) s.end = Math.min(s.end, at);
    },
  };
  const live = new LiveScheduler(port, () => {});
  const events = diatonic(defaultKey).map((chord, i) =>
    makeEvent(chord, newSession(), `live${i}`),
  );
  return {
    live,
    events,
    scheduled,
    cuts,
    advance: (now: number) => {
      time = now;
      live.tick();
    },
  };
}
it('replaces a reserved Next beat choice until its boundary; both parts use the latest harmony', () => {
  const f = fixture();
  f.live.start(f.events[0], 60, { ...defaultMelody(), enabled: true }, true);
  f.advance(0.95);
  f.live.change(f.events[1], 'nextBeat', true);
  expect(f.live.state.event?.id).toBe('live0');
  expect(f.live.state.live?.pending?.id).toBe('live1');
  f.advance(1.01); // Previous choice is already in the audio lookahead window.
  f.live.change(f.events[4], 'nextBeat', true);
  expect(f.cuts.at(-1)).toBeCloseTo(1.03);
  expect(
    f.scheduled.filter((s) => s.id === 'live1').every((s) => s.end <= s.start),
  ).toBe(true);
  f.advance(1.031);
  expect(f.live.state.event?.id).toBe('live4');
  expect(f.live.state.melody?.kind).toBe('chord');
  expect(f.live.state.live?.recorded[0].duration).toBeCloseTo(1);
  expect(f.live.state.live?.recorded[0].live?.appliedBeat).toBe(0);
  f.advance(1.53);
  f.live.stop();
  const final = f.live.state.live!.recorded[1];
  expect(final.duration).toBeCloseTo(0.5);
  expect(final.live?.requestedBeat).toBeCloseTo(0.98);
  expect(final.live?.appliedBeat).toBeCloseTo(1);
  expect(f.scheduled).toEqual([]);
  expect(() =>
    importSession(
      exportSession(
        editSession(newSession(), {
          type: 'liveCapture',
          events: f.live.state.live!.recorded,
        }),
      ),
    ),
  ).not.toThrow();
});
it('Immediate cancels old future melody and captures unquantized applied duration', () => {
  const f = fixture();
  f.live.start(
    f.events[0],
    60,
    { ...defaultMelody(), enabled: true, density: 1 },
    true,
  );
  f.advance(0.493);
  f.live.change(f.events[3], 'immediate', true);
  expect(f.cuts.at(-1)).toBeCloseTo(0.493);
  expect(f.live.state.event?.id).toBe('live3');
  expect(f.live.state.live?.recorded[0].duration).toBeCloseTo(0.463);
  expect(
    f.scheduled.filter((s) => s.start < 0.493).every((s) => s.end <= 0.493),
  ).toBe(true);
  f.advance(0.61);
  f.live.stop();
  expect(f.live.state.live?.recorded[1].duration).toBeCloseTo(0.117);
  f.advance(20);
  expect(f.scheduled).toEqual([]);
});
it('Stop before a queued boundary never records the unapplied choice', () => {
  const f = fixture();
  f.live.start(f.events[0], 60, defaultMelody(), true);
  f.advance(0.95);
  f.live.change(f.events[1], 'nextBeat', true);
  f.live.stop();
  expect(f.live.state.live?.recorded.map((e) => e.id)).toEqual(['live0-0']);
  f.advance(2);
  expect(f.scheduled).toEqual([]);
});
it('pause/resume and tempo changes preserve beat and the pending choice', () => {
  const f = fixture();
  f.live.start(f.events[0], 60, { ...defaultMelody(), enabled: true }, true);
  f.advance(0.53);
  f.live.change(f.events[4], 'nextBeat', true);
  f.live.pause();
  expect(f.scheduled).toEqual([]);
  f.advance(5);
  f.live.configure(120);
  f.live.resume();
  expect(f.live.state.beat).toBeCloseTo(0.5);
  expect(f.scheduled[0].start).toBeCloseTo(5.03);
  f.advance(5.281);
  expect(f.live.state.event?.id).toBe('live4');
  f.live.stop();
  expect(f.scheduled).toEqual([]);
});
it('repeats only current-harmony phrases, bounds recording and pauses after a clock stall', () => {
  const f = fixture();
  f.live.start(f.events[0], 60, { ...defaultMelody(), enabled: true }, true, 1);
  f.advance(7.95);
  f.advance(8.04);
  expect(f.live.state.event?.id).toBe('live0');
  f.advance(40);
  expect(f.live.state.status).toBe('paused');
  expect(f.scheduled).toEqual([]);
  f.live.resume();
  f.advance(40.1);
  f.live.stop();
  expect(f.live.state.live?.limit).toBe(true);
  expect(f.live.state.live?.recorded).toHaveLength(1);
});
