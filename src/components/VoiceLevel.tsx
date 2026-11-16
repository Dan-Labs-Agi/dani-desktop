import { useEffect, useRef } from "react";

const BARS = 24;
const REST_HEIGHT = 2;
const MAX_HEIGHT = 14;

/** The height of each bar for one frame of frequency data (0-255 per bin): quiet bins rest as dots, loud ones rise. */
export function voiceBarHeights(bins: ArrayLike<number>, bars = BARS): number[] {
  const step = Math.max(1, Math.floor(bins.length / bars));
  return Array.from({ length: bars }, (_, bar) => {
    let sum = 0;
    for (let at = bar * step; at < (bar + 1) * step && at < bins.length; at += 1) sum += bins[at] ?? 0;
    const level = Math.min(1, sum / step / 160);
    return Math.round(REST_HEIGHT + level * (MAX_HEIGHT - REST_HEIGHT));
  });
}

/** A row of dots that rise with the microphone's level while `active`. It listens to the microphone itself, only to
 * draw: the words come from the dictation engine. Without a microphone the dots stay at rest. */
export function VoiceLevel({ active }: { active: boolean }) {
  const row = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active || !navigator.mediaDevices?.getUserMedia) return;
    let frame = 0;
    let stopped = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((granted) => {
      if (stopped) { for (const track of granted.getTracks()) track.stop(); return; }
      stream = granted;
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;
      context.createMediaStreamSource(granted).connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        analyser.getByteFrequencyData(bins);
        const heights = voiceBarHeights(bins.subarray(0, 48));
        const bars = row.current?.children;
        if (bars) for (let at = 0; at < bars.length; at += 1) (bars[at] as HTMLElement).style.height = `${heights[at] ?? REST_HEIGHT}px`;
        frame = requestAnimationFrame(draw);
      };
      draw();
    }).catch(() => {});
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      for (const track of stream?.getTracks() ?? []) track.stop();
      void context?.close().catch(() => {});
    };
  }, [active]);
  if (!active) return null;
  return (
    <span ref={row} aria-hidden="true" data-voice-level className="flex h-4 items-center gap-[3px] px-2">
      {Array.from({ length: BARS }, (_, bar) => <i key={bar} className="w-0.5 rounded-full bg-ink-secondary" style={{ height: REST_HEIGHT }} />)}
    </span>
  );
}
