import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  ModelFullContentComment,
  ModelFullContentVideo,
  ModelProfile,
} from '../types';
import { AllPrivacyVideoPlayer } from './AllPrivacyVideoPlayer';
import { BrandMark } from './BrandMark';
import { HeartIcon, VerifiedBadgeIcon } from './icons';
import { SiteFooter } from './SiteFooter';
import { TelegramCTA } from './TelegramCTA';

interface ModelVideoPageProps {
  model: ModelProfile | null;
  content: ModelFullContentVideo | null;
  ctaHref: string;
  isLoading?: boolean;
}

function getHomePath() {
  return '/';
}

function createCommentCaptcha() {
  const left = Math.floor(Math.random() * 8) + 2;
  const right = Math.floor(Math.random() * 8) + 1;

  return {
    left,
    right,
    answer: left + right,
  };
}

function formatCommentDate(value: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

export function ModelVideoPage({
  model,
  content,
  ctaHref,
  isLoading = false,
}: ModelVideoPageProps) {
  const hasRegisteredViewRef = useRef<string | null>(null);
  const [comments, setComments] = useState<ModelFullContentComment[]>(content?.comments || []);
  const [commentName, setCommentName] = useState('');
  const [commentMessage, setCommentMessage] = useState('');
  const [captchaChallenge, setCaptchaChallenge] = useState(createCommentCaptcha);
  const [captchaInput, setCaptchaInput] = useState('');
  const [commentFeedback, setCommentFeedback] = useState<string | null>(null);
  const [commentFeedbackTone, setCommentFeedbackTone] = useState<'success' | 'error'>('success');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [likedCommentIds, setLikedCommentIds] = useState<string[]>([]);
  const [likePendingId, setLikePendingId] = useState<string | null>(null);
  const viewStorageKey = content?.routeToken
    ? `allprivacy-full-content-view:${content.routeToken}`
    : '';
  const likeStorageKey = content?.routeToken
    ? `allprivacy-full-content-likes:${content.routeToken}`
    : '';
  const orderedComments = useMemo(
    () =>
      [...comments].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [comments],
  );

  useEffect(() => {
    if (!content?.videoUrl) {
      return;
    }

    const preloadLink = document.createElement('link');
    preloadLink.rel = 'preload';
    preloadLink.as = 'video';
    preloadLink.href = content.videoUrl;
    document.head.appendChild(preloadLink);

    return () => {
      preloadLink.remove();
    };
  }, [content?.videoUrl]);

  useEffect(() => {
    if (!content?.routeToken || hasRegisteredViewRef.current === content.routeToken) {
      return;
    }

    if (typeof window !== 'undefined' && viewStorageKey) {
      const alreadyViewed = window.localStorage.getItem(viewStorageKey);

      if (alreadyViewed === '1') {
        hasRegisteredViewRef.current = content.routeToken;
        return;
      }
    }

    hasRegisteredViewRef.current = content.routeToken;
    void fetch('/api/full-content/view', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        routeToken: content.routeToken,
      }),
    })
      .then((response) => {
        if (!response.ok || typeof window === 'undefined' || !viewStorageKey) {
          return;
        }

        window.localStorage.setItem(viewStorageKey, '1');
      })
      .catch(() => {
        // Falha de view não deve bloquear a página.
      });
  }, [content?.routeToken, viewStorageKey]);

  useEffect(() => {
    setComments(content?.comments || []);
    setCommentName('');
    setCommentMessage('');
    setCaptchaChallenge(createCommentCaptcha());
    setCaptchaInput('');
    setCommentFeedback(null);
    setCommentFeedbackTone('success');
    setLikePendingId(null);

    if (typeof window !== 'undefined' && likeStorageKey) {
      try {
        const raw = window.localStorage.getItem(likeStorageKey);
        const parsed = raw ? (JSON.parse(raw) as string[]) : [];
        setLikedCommentIds(Array.isArray(parsed) ? parsed : []);
      } catch {
        setLikedCommentIds([]);
      }
    } else {
      setLikedCommentIds([]);
    }
  }, [content?.routeToken, content?.comments, likeStorageKey]);

  const handleCommentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!content?.routeToken) {
      return;
    }

    const nextName = commentName.trim();
    const nextMessage = commentMessage.trim();
    const nextCaptcha = Number(captchaInput);

    if (!nextName || !nextMessage) {
      setCommentFeedbackTone('error');
      setCommentFeedback('Preencha seu nome e comentário para enviar.');
      return;
    }

    if (!Number.isFinite(nextCaptcha) || nextCaptcha !== captchaChallenge.answer) {
      setCommentFeedbackTone('error');
      setCommentFeedback('Captcha inválido. Tente novamente.');
      setCaptchaChallenge(createCommentCaptcha());
      setCaptchaInput('');
      return;
    }

    setIsSubmittingComment(true);
    setCommentFeedback(null);

    try {
      const response = await fetch('/api/full-content/comment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          routeToken: content.routeToken,
          name: nextName,
          message: nextMessage,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; comment?: ModelFullContentComment }
        | null;

      if (!response.ok || !payload?.comment) {
        throw new Error(payload?.message || 'Não foi possível enviar seu comentário.');
      }

      setComments((current) => [payload.comment!, ...current]);
      setCommentName('');
      setCommentMessage('');
      setCaptchaChallenge(createCommentCaptcha());
      setCaptchaInput('');
      setCommentFeedbackTone('success');
      setCommentFeedback('Comentário enviado com sucesso.');
    } catch (error) {
      setCommentFeedbackTone('error');
      setCommentFeedback(
        error instanceof Error ? error.message : 'Não foi possível enviar seu comentário.',
      );
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    if (!content?.routeToken || likePendingId) {
      return;
    }

    setLikePendingId(commentId);

    try {
      const response = await fetch('/api/full-content/comment-like', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          routeToken: content.routeToken,
          commentId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; liked?: boolean; comment?: ModelFullContentComment }
        | null;

      if (!response.ok || !payload?.comment) {
        throw new Error(payload?.message || 'Nao foi possivel curtir agora.');
      }

      setComments((current) =>
        current.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                likes: payload.comment?.likes ?? comment.likes,
              }
            : comment,
        ),
      );

      setLikedCommentIds((current) => {
        const alreadyLiked = current.includes(commentId);
        const next = payload.liked
          ? alreadyLiked
            ? current
            : [...current, commentId]
          : current.filter((id) => id !== commentId);

        if (typeof window !== 'undefined' && likeStorageKey) {
          window.localStorage.setItem(likeStorageKey, JSON.stringify(next));
        }

        return next;
      });
    } catch {
      // Falha de like nao deve quebrar a leitura da pagina.
    } finally {
      setLikePendingId(null);
    }
  };

  if (isLoading && !model) {
    return (
      <div className="min-h-screen bg-ink text-white">
        <div className="fixed inset-0 bg-black" />
        <div className="relative mx-auto flex min-h-screen max-w-[1440px] flex-col items-center justify-center px-4 text-center">
          <BrandMark />
          <div className="mt-8 h-11 w-11 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
        </div>
      </div>
    );
  }

  if (!model || !content?.videoUrl) {
    return (
      <div className="min-h-screen bg-ink px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-[32px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
          <a
            href={getHomePath()}
            className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50"
          >
            {'Voltar para a home'}
          </a>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {'Conteúdo não encontrado'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300 sm:text-base">
            {'Esse link exclusivo não está disponível no momento.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="fixed inset-0">
        <img
          src={model.coverImage}
          alt={model.name}
          className="h-full w-full object-cover object-center"
          loading="eager"
          fetchPriority="high"
        />
        <div className="absolute inset-0 bg-black/90" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.2),transparent_24%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_34%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/35" />
      </div>

      <div className="relative">
        <div className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
          <div
            className="relative flex items-center justify-center px-4 py-5"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 1.25rem)' }}
          >
            <a
              href={getHomePath()}
              className="absolute -left-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/50 transition hover:text-white/75 sm:hidden"
            >
              <span aria-hidden="true">{'\u2039'}</span>
              <span>{'Página inicial'}</span>
            </a>
            <a
              href={getHomePath()}
              className="absolute left-4 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 transition hover:text-white/75 sm:inline-flex md:text-[13px]"
            >
              <span aria-hidden="true">{'\u2039'}</span>
              <span>{'Página inicial'}</span>
            </a>
            <div className="sm:hidden">
              <BrandMark
                href={getHomePath()}
                className="text-[1.08rem] tracking-[0.1em] max-[380px]:text-[0.98rem]"
              />
            </div>
            <div className="hidden sm:block">
              <BrandMark href={getHomePath()} />
            </div>
          </div>

          <header className="pt-24 sm:pt-8">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="w-full pt-12 pb-4 sm:py-14"
            >
              <div className="mt-0 flex items-start justify-between gap-4 sm:mt-5 sm:gap-5">
                <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black/40 sm:h-20 sm:w-20">
                    <img
                      src={model.profileImage}
                      alt={model.name}
                      className="h-full w-full object-cover"
                      loading="eager"
                    />
                  </div>
                  <div className="min-w-0 self-center">
                    <h1 className="font-display text-4xl font-semibold leading-[0.94] tracking-tight text-white sm:text-6xl">
                      {model.name}
                    </h1>
                    <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#5ea8ff]/22 bg-[#5ea8ff]/10 px-2.5 py-1 text-[9px] font-medium tracking-[0.01em] text-white/72 shadow-[0_8px_18px_rgba(0,0,0,0.14)] sm:mt-2 sm:px-3 sm:text-[10px]">
                      <VerifiedBadgeIcon className="h-3.5 w-3.5 shrink-0 text-[#4da3ff]" />
                      <span className="truncate">{'Disponível no GrupoVIP'}</span>
                    </div>
                  </div>
                  <div className="ml-auto hidden shrink-0 sm:inline-grid sm:gap-2">
                    <TelegramCTA
                      href={ctaHref}
                      label="Entrar no Grupo VIP"
                      className="min-h-16 w-auto min-w-[400px] px-8 py-4 text-[1.22rem]"
                    />
                    <span className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
                      {'Acesso imediato'}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </header>

          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.05 }}
            className="pt-1"
          >
            <div className="relative overflow-hidden rounded-[28px] shadow-[0_28px_80px_rgba(0,0,0,0.45)] sm:mx-auto sm:max-w-5xl lg:max-w-[980px]">
              <img
                src={model.coverImage}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-35 blur-3xl"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/5 to-black/20" />
              <div className="relative aspect-video max-h-[78vh]">
                <AllPrivacyVideoPlayer
                  src={content.videoUrl}
                  poster={model.coverImage}
                  brandLabel="AllPrivacy.site"
                />
              </div>
            </div>
          </motion.section>

          <div className="mt-4 sm:hidden">
            <TelegramCTA
              href={ctaHref}
              label="Entrar no Grupo VIP"
              className="min-h-11 w-full px-5 py-3 text-sm"
            />
            <span className="mt-1 block text-center text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
              {'Acesso imediato'}
            </span>
          </div>

          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.1 }}
            className="pt-5 sm:pt-7"
          >
            <div className="sm:mx-auto sm:max-w-5xl lg:max-w-[980px]">
              <div>
                <h2 className="font-display text-xl font-semibold text-white sm:text-2xl">
                  Comentários
                </h2>
              </div>

              <form onSubmit={handleCommentSubmit} className="mt-3 grid gap-1.5 sm:grid-cols-2">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(136px,42%)] items-start gap-2 sm:col-span-2 sm:inline-grid sm:w-fit sm:max-w-none sm:grid-cols-[200px_190px] sm:gap-0.0">
                  <div>
                    <input
                      value={commentName}
                      onChange={(event) => setCommentName(event.target.value)}
                      className="min-h-9 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.06] sm:text-[13px]"
                      placeholder="Seu nome"
                      maxLength={20}
                    />
                  </div>

                  <div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                      <input
                        value={captchaInput}
                        onChange={(event) => setCaptchaInput(event.target.value)}
                        inputMode="numeric"
                        className="min-h-9 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.06] sm:text-[13px]"
                        placeholder={`${captchaChallenge.left} + ${captchaChallenge.right} = ?`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCaptchaChallenge(createCommentCaptcha());
                          setCaptchaInput('');
                        }}
                        className="inline-flex min-h-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70 transition hover:bg-white/[0.06]"
                      >
                        Trocar
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-1 sm:col-span-2">
                  <textarea
                    value={commentMessage}
                    onChange={(event) => setCommentMessage(event.target.value)}
                    className="min-h-[72px] rounded-[20px] border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.06] sm:min-h-[80px] sm:text-[13px]"
                    placeholder="Escreva seu comentário"
                    maxLength={200}
                  />
                  <div className="text-right text-[10px] text-white/35">
                    {commentMessage.length}/200
                  </div>
                </div>

                <div className="-mt-4 sm:col-span-2">
                  <button
                    type="submit"
                    disabled={isSubmittingComment}
                    className="inline-flex min-h-9 items-center justify-center rounded-2xl bg-gradient-to-r from-rose-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-11 sm:px-6 sm:py-2.5 sm:text-[15px]"
                  >
                    {isSubmittingComment ? 'Enviando...' : 'Comentar'}
                  </button>
                </div>
              </form>

              {commentFeedback ? (
                <div
                  className={`mt-2.5 rounded-[16px] border px-3 py-2 text-sm ${
                    commentFeedbackTone === 'error'
                      ? 'border-red-500/25 bg-red-500/10 text-red-100'
                      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                  }`}
                >
                  {commentFeedback}
                </div>
              ) : null}

              <div className="mt-5 space-y-2">
                {orderedComments.length === 0 ? (
                  <div className="rounded-[16px] border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white/60">
                    Ainda não há comentários. Seja o primeiro a comentar.
                  </div>
                ) : (
                  orderedComments.map((comment) => (
                    <article
                      key={comment.id}
                      className="rounded-[16px] border border-white/10 bg-black/20 px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-white sm:text-[14px]">
                            {comment.name}
                          </h3>
                          <span className="mt-0.5 block text-[10px] uppercase tracking-[0.12em] text-white/40">
                            {formatCommentDate(comment.createdAt)}
                          </span>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <button
                          type="button"
                          onClick={() => void handleLikeComment(comment.id)}
                          disabled={likePendingId === comment.id}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition ${
                            likedCommentIds.includes(comment.id)
                              ? 'border-rose-400/25 bg-rose-500/10 text-rose-100'
                              : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]'
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                          aria-label={
                            likedCommentIds.includes(comment.id)
                              ? 'Descurtir comentário'
                              : 'Curtir comentário'
                          }
                          >
                            <HeartIcon className="h-3.5 w-3.5" />
                            <span>{comment.likes || 0}</span>
                          </button>
                        </div>
                      </div>
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-5 text-zinc-200">
                        {comment.message}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </div>
          </motion.section>
        </div>

        <SiteFooter />
      </div>
    </div>
  );
}
