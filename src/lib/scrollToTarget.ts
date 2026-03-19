export function scrollToTarget(targetId: string, block: ScrollLogicalPosition = 'start') {
  if (typeof document === 'undefined') {
    return false;
  }

  const target = document.getElementById(targetId);

  if (!target) {
    return false;
  }

  target.scrollIntoView({ behavior: 'smooth', block });
  return true;
}

export function waitForPageReady(timeoutMs = 2200) {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (document.readyState === 'complete') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.removeEventListener('load', onLoad);
      window.clearTimeout(fallbackTimeoutId);
      resolve();
    };

    const onLoad = () => {
      finish();
    };

    const fallbackTimeoutId = window.setTimeout(finish, timeoutMs);
    window.addEventListener('load', onLoad, { once: true });
  });
}

export async function scrollToTargetWhenReady(
  targetId: string,
  block: ScrollLogicalPosition = 'start',
  timeoutMs = 2200,
) {
  await waitForPageReady(timeoutMs);
  return scrollToTarget(targetId, block);
}
