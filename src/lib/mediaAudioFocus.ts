const focusListeners = new Map<string, () => void>();
let activeFocusId: string | null = null;

export function registerMediaAudioFocus(id: string, onForceMute: () => void) {
  focusListeners.set(id, onForceMute);

  return () => {
    focusListeners.delete(id);

    if (activeFocusId === id) {
      activeFocusId = null;
    }
  };
}

export function claimMediaAudioFocus(id: string) {
  if (activeFocusId && activeFocusId !== id) {
    focusListeners.get(activeFocusId)?.();
  }

  activeFocusId = id;
}

export function releaseMediaAudioFocus(id: string) {
  if (activeFocusId === id) {
    activeFocusId = null;
  }
}
