import { LISTEN_RATE, type ListenPlan } from './plan';
export type ListenStatus = 'empty' | 'ready' | 'playing' | 'paused' | 'ended';
export interface ListenPlayback {
  status: ListenStatus;
  seconds: number;
}
export class ListenPlayer {
  private url: string | null = null;
  private plan: ListenPlan | null = null;
  private disposed = false;
  private handlers: MediaSessionAction[] = [];
  private stopped = true;
  private media =
    typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  constructor(
    private audio: HTMLAudioElement,
    private notify: (state: ListenPlayback) => void,
  ) {
    for (const event of [
      'play',
      'pause',
      'ended',
      'timeupdate',
      'seeked',
      'loadedmetadata',
    ])
      audio.addEventListener(event, this.changed);
    document.addEventListener('visibilitychange', this.changed);
  }
  private changed = (event?: Event) => {
    if (this.disposed) return;
    if (event?.type === 'play' && !this.audio.paused) this.stopped = false;
    const status: ListenStatus = !this.plan
      ? 'empty'
      : this.audio.ended
        ? 'ended'
        : !this.audio.paused
          ? 'playing'
          : this.stopped
            ? 'ready'
            : 'paused';
    this.notify({ status, seconds: this.audio.currentTime || 0 });
    if (this.media && this.plan) {
      this.media.playbackState =
        status === 'playing'
          ? 'playing'
          : status === 'paused'
            ? 'paused'
            : 'none';
      try {
        this.media.setPositionState?.({
          duration: this.plan.frames / LISTEN_RATE,
          playbackRate: 1,
          position: Math.min(
            this.plan.frames / LISTEN_RATE,
            this.audio.currentTime || 0,
          ),
        });
      } catch {
        /* OS-specific media controls are optional. */
      }
    }
  };
  load(blob: Blob, plan: ListenPlan, title: string) {
    this.clear();
    this.url = URL.createObjectURL(blob);
    this.plan = plan;
    this.audio.src = this.url;
    this.audio.loop = true;
    this.audio.load();
    if (this.media) {
      if (typeof MediaMetadata !== 'undefined')
        this.media.metadata = new MediaMetadata({
          title,
          artist: 'Chordscape',
          album: 'Listen',
        });
      const actions: Partial<
        Record<MediaSessionAction, MediaSessionActionHandler>
      > = {
        play: () => {
          void this.play().catch(() => this.changed());
        },
        pause: () => this.pause(),
        stop: () => this.stop(),
        seekto: (details) => this.seek(details.seekTime ?? 0),
        seekbackward: (details) =>
          this.seek(this.audio.currentTime - (details.seekOffset ?? 10)),
        seekforward: (details) =>
          this.seek(this.audio.currentTime + (details.seekOffset ?? 10)),
        previoustrack: () => this.step(-1),
        nexttrack: () => this.step(1),
      };
      for (const [action, handler] of Object.entries(actions)) {
        try {
          this.media.setActionHandler(action as MediaSessionAction, handler);
          this.handlers.push(action as MediaSessionAction);
        } catch {
          /* Unsupported action. */
        }
      }
    }
    this.changed();
  }
  async play() {
    if (!this.plan || this.disposed) return;
    this.stopped = false;
    // This file player never depends on the playground's AudioContext or timers.
    // Use the platform playback category where the browser exposes it.
    const session = (
      navigator as Navigator & { audioSession?: { type: string } }
    ).audioSession;
    if (session) {
      try {
        session.type = 'playback';
      } catch {
        /* Optional API. */
      }
    }
    await this.audio.play();
    if (this.disposed || !this.plan || this.stopped) this.audio.pause();
  }
  pause() {
    this.stopped = false;
    this.audio.pause();
    this.changed();
  }
  stop() {
    this.stopped = true;
    this.audio.pause();
    if (this.plan) this.audio.currentTime = 0;
    this.changed();
  }
  seek(seconds: number) {
    if (this.plan)
      this.audio.currentTime = Math.max(
        0,
        Math.min(this.plan.frames / LISTEN_RATE, seconds),
      );
    this.changed();
  }
  step(direction: -1 | 1) {
    if (!this.plan) return;
    const frame = this.audio.currentTime * LISTEN_RATE;
    const next =
      direction === 1
        ? this.plan.cues.find((c) => c.start > frame + LISTEN_RATE * 0.2)
        : [...this.plan.cues]
            .reverse()
            .find((c) => c.start < frame - LISTEN_RATE * 0.5);
    this.seek(
      next
        ? next.start / LISTEN_RATE
        : direction === 1
          ? this.plan.frames / LISTEN_RATE - 0.01
          : 0,
    );
  }
  setLoop(loop: boolean) {
    this.audio.loop = loop;
  }
  clear() {
    this.stop();
    this.plan = null;
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (this.media) {
      for (const action of this.handlers)
        this.media.setActionHandler(action, null);
      this.media.metadata = null;
      this.media.playbackState = 'none';
      try {
        this.media.setPositionState?.();
      } catch {
        /* Optional. */
      }
    }
    this.handlers = [];
    this.changed();
  }
  dispose() {
    this.disposed = true;
    this.clear();
    for (const event of [
      'play',
      'pause',
      'ended',
      'timeupdate',
      'seeked',
      'loadedmetadata',
    ])
      this.audio.removeEventListener(event, this.changed);
    document.removeEventListener('visibilitychange', this.changed);
  }
}
