import { useEffect, useMemo, useRef, useState } from 'react';
import { ExpandIcon, PauseIcon, PlayIcon, VolumeOffIcon, VolumeOnIcon } from './icons';

interface AllPrivacyVideoPlayerProps {
  src: string;
  poster?: string;
  brandLabel?: string;
  className?: string;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainderSeconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(remainderMinutes).padStart(2, '0')}:${String(remainderSeconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainderSeconds).padStart(2, '0')}`;
}

export function AllPrivacyVideoPlayer({
  src,
  poster,
  brandLabel = 'AllPrivacy.site',
  className = '',
}: AllPrivacyVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideControlsTimeoutRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsReady(false);
    setIsMuted(true);
    setControlsVisible(true);
  }, [src]);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hideControlsTimeoutRef.current !== null) {
        window.clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, []);

  const progressPercent = useMemo(() => {
    if (!duration || !Number.isFinite(duration)) {
      return 0;
    }

    return Math.min(100, Math.max(0, (currentTime / duration) * 100));
  }, [currentTime, duration]);

  const clearHideControlsTimer = () => {
    if (hideControlsTimeoutRef.current !== null) {
      window.clearTimeout(hideControlsTimeoutRef.current);
      hideControlsTimeoutRef.current = null;
    }
  };

  const scheduleControlsHide = () => {
    clearHideControlsTimer();

    if (!isPlaying || !isReady || typeof window === 'undefined') {
      return;
    }

    hideControlsTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 2200);
  };

  const revealControls = () => {
    setControlsVisible(true);
    scheduleControlsHide();
  };

  useEffect(() => {
    if (!isReady || !isPlaying) {
      clearHideControlsTimer();
      setControlsVisible(true);
      return;
    }

    scheduleControlsHide();

    return () => {
      clearHideControlsTimer();
    };
  }, [isPlaying, isReady]);

  const togglePlayback = () => {
    if (!videoRef.current) {
      return;
    }

    if (videoRef.current.paused) {
      void videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {});
      return;
    }

    videoRef.current.pause();
    setIsPlaying(false);
  };

  const handleVideoSurfaceClick = () => {
    if (isPlaying && !controlsVisible) {
      revealControls();
      return;
    }

    togglePlayback();
  };

  const handleSeek = (nextValue: string) => {
    if (!videoRef.current || !duration) {
      return;
    }

    const nextPercent = Number(nextValue);
    const nextTime = (Math.max(0, Math.min(100, nextPercent)) / 100) * duration;
    videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
    revealControls();
  };

  const handleFullscreenToggle = async () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
      revealControls();
    } catch {
      // Ignore fullscreen failures on unsupported browsers/devices.
    }
  };

  const overlayVisible = controlsVisible || !isPlaying;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden rounded-[inherit] ${isFullscreen ? 'bg-black' : ''} ${className}`}
      onPointerMove={revealControls}
      onTouchStart={revealControls}
      onMouseEnter={revealControls}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="h-full w-full object-contain"
        playsInline
        preload="metadata"
        muted={isMuted}
        onClick={handleVideoSurfaceClick}
        onLoadedData={() => setIsReady(true)}
        onLoadedMetadata={() => {
          if (!videoRef.current) {
            return;
          }

          setDuration(videoRef.current.duration || 0);
          setCurrentTime(videoRef.current.currentTime || 0);
          setIsReady(true);
        }}
        onTimeUpdate={() => {
          if (!videoRef.current) {
            return;
          }

          setCurrentTime(videoRef.current.currentTime || 0);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      {!isReady ? (
        <div className="pointer-events-none absolute inset-0 z-10 skeleton-shimmer bg-white/[0.06]">
          <div className="absolute inset-x-6 bottom-6 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">
            <span>{brandLabel}</span>
            <span>Carregando</span>
          </div>
        </div>
      ) : null}

      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-[1] h-16 bg-gradient-to-b from-black/55 via-black/12 to-transparent transition-opacity duration-300 sm:h-24 ${overlayVisible ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-20 bg-gradient-to-t from-black/88 via-black/38 to-transparent transition-opacity duration-300 sm:h-36 ${overlayVisible ? 'opacity-100' : 'opacity-0'}`}
      />

      <div
        className={`absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70 backdrop-blur-md transition-opacity duration-300 sm:left-4 sm:top-4 sm:px-3 sm:py-1.5 sm:text-[11px] sm:tracking-[0.22em] ${overlayVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,0.75)]" />
        <span>{brandLabel}</span>
      </div>

      {!isPlaying ? (
        <button
          type="button"
          onClick={togglePlayback}
          className="absolute inset-0 z-20 flex items-center justify-center"
          aria-label="Reproduzir video"
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:scale-[1.02] sm:h-20 sm:w-20">
            <PlayIcon className="ml-1 h-7 w-7 sm:h-9 sm:w-9" />
          </span>
        </button>
      ) : null}

      <div
        className={`absolute inset-x-0 bottom-0 z-20 p-2.5 transition-opacity duration-300 sm:p-5 ${overlayVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="rounded-[18px] border border-white/10 bg-black/45 px-2.5 py-2 backdrop-blur-xl sm:rounded-[24px] sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlayback}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 text-white transition hover:bg-white/[0.1] sm:h-11 sm:min-w-11 sm:px-4"
              aria-label={isPlaying ? 'Pausar video' : 'Reproduzir video'}
            >
              {isPlaying ? (
                <PauseIcon className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : (
                <PlayIcon className="ml-0.5 h-4 w-4 sm:h-5 sm:w-5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsMuted((current) => !current);
                revealControls();
              }}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 text-white transition hover:bg-white/[0.1] sm:h-11 sm:min-w-11 sm:px-4"
              aria-label={isMuted ? 'Ativar audio' : 'Desativar audio'}
            >
              {isMuted ? (
                <VolumeOffIcon className="h-4 w-4 sm:h-5 sm:w-5" />
              ) : (
                <VolumeOnIcon className="h-4 w-4 sm:h-5 sm:w-5" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <label className="block">
                <span className="sr-only">Progresso do video</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.1}
                  value={progressPercent}
                  onChange={(event) => handleSeek(event.target.value)}
                  style={{ ['--progress' as string]: `${progressPercent}%` }}
                  className="allprivacy-player-progress w-full cursor-pointer appearance-none bg-transparent"
                />
              </label>

              <div className="mt-1 flex items-center justify-between gap-2 text-[9px] font-medium uppercase tracking-[0.1em] text-white/55 sm:text-[11px] sm:tracking-[0.18em]">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleFullscreenToggle}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 text-white transition hover:bg-white/[0.1] sm:h-11 sm:min-w-11 sm:px-4"
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Abrir em tela cheia'}
            >
              <ExpandIcon className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
