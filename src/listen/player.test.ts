import { afterEach, expect, it, vi } from 'vitest';
import { ListenPlayer, type ListenPlayback } from './player';
import { buildListenPlan, defaultListen } from './plan';
class FakeAudio extends EventTarget {
  paused = true;
  ended = false;
  loop = false;
  currentTime = 0;
  src = '';
  play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  load = vi.fn();
  removeAttribute = vi.fn(() => {
    this.src = '';
  });
}
function setup() {
  const doc = new EventTarget();
  vi.stubGlobal('document', doc);
  const actions = new Map<string, MediaSessionActionHandler | null>();
  const media = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: (
      name: string,
      action: MediaSessionActionHandler | null,
    ) => actions.set(name, action),
    setPositionState: vi.fn(),
  };
  vi.stubGlobal('navigator', { mediaSession: media });
  const audio = new FakeAudio();
  let state: ListenPlayback | undefined;
  const player = new ListenPlayer(audio as unknown as HTMLAudioElement, (s) => {
    state = s;
  });
  const plan = buildListenPlan({ ...defaultListen(), mode: 'ambient' }, {});
  player.load(new Blob(['audio']), plan, 'Listen');
  return { player, audio, actions, media, doc, plan, state: () => state };
}
afterEach(() => vi.unstubAllGlobals());
it('keeps native file playback running when hidden and uses media time after seek/repeat', async () => {
  const { player, audio, doc, actions, state } = setup();
  await player.play();
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(audio.paused).toBe(false);
  expect(audio.loop).toBe(true);
  audio.currentTime = 75;
  audio.dispatchEvent(new Event('timeupdate'));
  expect(state()?.seconds).toBe(75);
  actions.get('pause')!({ action: 'pause' });
  expect(audio.paused).toBe(true);
  actions.get('seekto')!({ action: 'seekto', seekTime: 120 });
  expect(audio.currentTime).toBe(120);
  audio.currentTime = 0;
  audio.dispatchEvent(new Event('timeupdate'));
  expect(state()?.seconds).toBe(0);
  player.setLoop(false);
  expect(audio.loop).toBe(false);
  actions.get('stop')!({ action: 'stop' });
  expect(audio.currentTime).toBe(0);
  expect(state()?.status).toBe('ready');
  player.dispose();
  expect(audio.src).toBe('');
  expect([...actions.values()].every((action) => action === null)).toBe(true);
});
it('does not resume from a late play completion after Stop or disposal', async () => {
  const { player, audio } = setup();
  let finish = () => {};
  audio.play.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          audio.paused = false;
          resolve();
        };
      }),
  );
  const pending = player.play();
  player.stop();
  finish();
  await pending;
  expect(audio.paused).toBe(true);
  const pendingAgain = player.play();
  player.dispose();
  finish();
  await pendingAgain;
  expect(audio.paused).toBe(true);
});
