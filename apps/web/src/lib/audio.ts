/**
 * Safe sound player utility using Web Audio API synthesized chime.
 * Ensures no external audio asset loading failures, zero latency,
 * and wraps all playback promises safely to prevent Uncaught (in promise) AbortError.
 */

export function playChimeSound(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();

    // Frequency notes for a pleasant two-tone success chime (E5 -> A5)
    const now = ctx.currentTime;

    // Oscillator 1 (First note: E5 - 659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    // Oscillator 2 (Second note: A5 - 880 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0.15, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.3);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);

    // Auto close context after sound finishes to free audio resources
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch (err) {
    // Intentionally swallow audio errors so UI actions are never interrupted
    console.debug('Audio play prevented or unavailable:', err);
  }
}
