import { useEffect, useMemo, useRef, useState } from 'react';

interface UseProgressiveCarouselOptions {
  total: number;
  variant?: 'wide' | 'portrait';
}

export function useProgressiveCarousel({
  total,
  variant = 'wide',
}: UseProgressiveCarouselOptions) {
  const initialCount = variant === 'portrait' ? 6 : 4;
  const step = variant === 'portrait' ? 4 : 3;
  const threshold = variant === 'portrait' ? 260 : 420;
  const timeoutRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(() => Math.min(total, initialCount));
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    setVisibleCount(Math.min(total, initialCount));
    setIsLoadingMore(false);

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [initialCount, total]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const loadMore = () => {
    if (isLoadingMore || visibleCount >= total) {
      return;
    }

    setIsLoadingMore(true);
    timeoutRef.current = window.setTimeout(() => {
      setVisibleCount((current) => Math.min(current + step, total));
      setIsLoadingMore(false);
      timeoutRef.current = null;
    }, 260);
  };

  const checkShouldLoadMore = (container: HTMLElement | null) => {
    if (!container || visibleCount >= total) {
      return;
    }

    const remaining = container.scrollWidth - (container.scrollLeft + container.clientWidth);

    if (remaining <= threshold) {
      loadMore();
    }
  };

  const skeletonCount =
    visibleCount < total ? Math.min(step, Math.max(total - visibleCount, 1)) : 0;

  return useMemo(
    () => ({
      visibleCount,
      skeletonCount,
      isLoadingMore,
      checkShouldLoadMore,
    }),
    [checkShouldLoadMore, isLoadingMore, skeletonCount, visibleCount],
  );
}
