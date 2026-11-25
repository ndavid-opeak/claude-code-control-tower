import { useEffect, useRef, useState } from 'react';
import { lineOf } from './format.ts';
import type { Session } from './sessions.ts';

const KEY = 'claude-office-alerts';
let audio: AudioContext | null = null;

/** Two short soft tones. Browsers only allow sound after a click on the page, so it may stay silent until then. */
function chime() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const start = audio.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, start + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.16 + 0.3);
      osc.connect(gain).connect(audio!.destination);
      osc.start(start + i * 0.16);
      osc.stop(start + i * 0.16 + 0.32);
    });
  } catch {
    // No sound available; the notification still shows.
  }
}

/**
 * Chimes, and shows a system notification while the page is in the background, whenever a session
 * moves into Waiting for me. Clicking the notification brings the page forward with that session open.
 */
export function useWaitingAlerts(sessions: Session[] | null, onOpen: (sessionId: string) => void) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'on';
    } catch {
      return false;
    }
  });
  const [blocked, setBlocked] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'denied');
  const previous = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!sessions) return;
    const waiting = new Set(sessions.filter((s) => s.agent.state === 'waiting').map((s) => s.agent.sessionId));
    const before = previous.current;
    previous.current = waiting;
    // Nothing fires for what was already waiting when the page opened.
    if (!before || !on) return;
    const fresh = sessions.filter((s) => waiting.has(s.agent.sessionId) && !before.has(s.agent.sessionId));
    if (fresh.length === 0) return;
    chime();
    if (document.visibilityState === 'visible' || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }
    for (const { agent } of fresh) {
      const n = new Notification(`${agent.name} is waiting for you`, {
        body: lineOf(agent.ask, 'first') || agent.reason || '',
        tag: agent.sessionId,
      });
      n.onclick = () => {
        window.focus();
        onOpen(agent.sessionId);
        n.close();
      };
    }
  }, [sessions, on, onOpen]);

  const toggle = async () => {
    const next = !on;
    if (next) {
      chime(); // also unlocks sound for later, since this runs on a click
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      setBlocked(typeof Notification !== 'undefined' && Notification.permission === 'denied');
    }
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered after a reload; it still works now.
    }
  };

  return { on, blocked, toggle };
}
