const mediaPlaybackMemory = new Map<string, number>();

export function rememberMediaPlaybackTime(key: string, time: number) {
  if (!key || !Number.isFinite(time) || time < 0) {
    return;
  }

  mediaPlaybackMemory.set(key, time);
}

export function getRememberedMediaPlaybackTime(key: string) {
  if (!key) {
    return 0;
  }

  return mediaPlaybackMemory.get(key) ?? 0;
}
