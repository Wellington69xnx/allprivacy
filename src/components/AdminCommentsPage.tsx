import { useMemo, useState } from 'react';
import { getAdminPath, getHomePath, getModelVideoPath } from '../lib/modelRoute';
import type { ModelProfile, SiteContent } from '../types';

interface AdminCommentsPageProps {
  siteContent: SiteContent;
  isLoading: boolean;
  onLogout: () => Promise<void>;
  removeModelFullContentComment: (input: {
    modelId: string;
    contentId: string;
    commentId: string;
  }) => Promise<void>;
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

function getContentHref(model: Pick<ModelProfile, 'id' | 'name' | 'handle'>, routeToken: string) {
  const relativePath = getModelVideoPath(model, routeToken);

  if (typeof window === 'undefined') {
    return relativePath;
  }

  return `${window.location.origin}${relativePath}`;
}

function ghostButtonClassName() {
  return 'inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60';
}

export function AdminCommentsPage({
  siteContent,
  isLoading,
  onLogout,
  removeModelFullContentComment,
}: AdminCommentsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<'all' | string>('all');
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');

  const commentThreads = useMemo(
    () =>
      siteContent.models
        .flatMap((model) =>
          (model.fullContentVideos || []).map((content) => {
            const comments = [...(content.comments || [])].sort(
              (left, right) =>
                new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
            );

            return {
              model,
              content,
              comments,
              href: getContentHref(model, content.routeToken),
              latestAt: comments[0]?.createdAt || '',
            };
          }),
        )
        .filter((thread) => thread.comments.length > 0),
    [siteContent.models],
  );

  const filteredThreads = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return commentThreads
      .filter((thread) => (selectedModelId === 'all' ? true : thread.model.id === selectedModelId))
      .map((thread) => {
        if (!normalizedSearch) {
          return thread;
        }

        const nextComments = thread.comments.filter((comment) => {
          const haystack = `${thread.model.name} ${thread.content.title} ${comment.name} ${comment.message}`.toLowerCase();
          return haystack.includes(normalizedSearch);
        });

        return {
          ...thread,
          comments: nextComments,
        };
      })
      .filter((thread) => thread.comments.length > 0)
      .sort((left, right) => {
        if (right.comments.length !== left.comments.length) {
          return right.comments.length - left.comments.length;
        }

        return new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime();
      });
  }, [commentThreads, searchTerm, selectedModelId]);

  const totalComments = commentThreads.reduce((total, thread) => total + thread.comments.length, 0);
  const visibleComments = filteredThreads.reduce((total, thread) => total + thread.comments.length, 0);

  const handleRemoveComment = async (
    model: ModelProfile,
    contentId: string,
    commentId: string,
  ) => {
    if (activeTask) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Tem certeza que deseja remover um comentario de ${model.name}?`)
    ) {
      return;
    }

    const taskId = `remove-comment-${commentId}`;
    setActiveTask(taskId);
    setFeedback(null);

    try {
      await removeModelFullContentComment({
        modelId: model.id,
        contentId,
        commentId,
      });
      setFeedbackTone('success');
      setFeedback('Comentario removido com sucesso.');
    } catch {
      setFeedbackTone('error');
      setFeedback('Nao foi possivel remover o comentario agora.');
    } finally {
      setActiveTask(null);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="mx-auto max-w-[1680px] px-3 py-4 sm:px-5 sm:py-6 xl:px-8">
        <header className="rounded-[30px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-6 xl:p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                <a href={getHomePath()} className="transition hover:text-white/70">
                  Voltar para o site
                </a>
                <span className="text-white/20">/</span>
                <a href={getAdminPath()} className="transition hover:text-white/70">
                  Painel admin
                </a>
              </div>
              <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl xl:text-[2.8rem]">
                Comentarios
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300 xl:text-[15px]">
                Modere os comentarios das paginas individuais de conteudo com mais clareza,
                filtros e contexto de cada modelo.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:min-w-[360px] xl:justify-end">
              <a href={getAdminPath()} className={ghostButtonClassName()}>
                Voltar ao painel
              </a>
              <button type="button" onClick={() => void onLogout()} className={ghostButtonClassName()}>
                Sair
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[22px] border border-white/10 bg-black/25 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                Comentarios totais
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">{totalComments}</div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/25 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                Paginas com comentarios
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">{commentThreads.length}</div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/25 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                Comentarios filtrados
              </div>
              <div className="mt-2 text-2xl font-semibold text-white">{visibleComments}</div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/25 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                Anti-spam
              </div>
              <div className="mt-2 text-sm leading-6 text-white/82">
                Max. 5 comentarios a cada 10 minutos por usuario/IP.
              </div>
            </div>
          </div>
        </header>

        {feedback ? (
          <div
            className={`mt-4 rounded-[22px] border px-4 py-3 text-sm ${
              feedbackTone === 'error'
                ? 'border-red-500/25 bg-red-500/10 text-red-100'
                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
            }`}
          >
            {feedback}
          </div>
        ) : null}

        <section className="mt-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-5 xl:p-6">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr),280px]">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por modelo, nome do autor ou trecho do comentario"
              className="min-h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.06] md:text-[15px]"
            />
            <select
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white outline-none transition focus:border-white/20 focus:bg-white/[0.06] md:text-[15px]"
            >
              <option value="all">Todas as modelos</option>
              {siteContent.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="mt-4">
          {isLoading ? (
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] px-4 py-6 text-sm text-zinc-300 backdrop-blur-xl">
              Carregando comentarios...
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] px-4 py-6 text-sm text-zinc-300 backdrop-blur-xl">
              Nenhum comentario encontrado com os filtros atuais.
            </div>
          ) : (
            <div className="grid gap-4 2xl:grid-cols-2">
              {filteredThreads.map((thread) => (
                <article
                  key={`${thread.model.id}-${thread.content.id}`}
                  className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl sm:p-5"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black">
                      <img
                        src={thread.model.profileImage}
                        alt={thread.model.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-display text-xl font-semibold text-white">
                            {thread.model.name}
                          </div>
                          <div className="mt-1 truncate text-[11px] uppercase tracking-[0.18em] text-white/45">
                            {thread.content.title}
                          </div>
                        </div>

                        <div className="grid gap-1 text-right text-[11px] uppercase tracking-[0.16em] text-white/45">
                          <span>{thread.comments.length} comentario(s)</span>
                          <span>{thread.content.views} visualizacao(oes)</span>
                        </div>
                      </div>

                      <a
                        href={thread.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 block break-all text-[11px] text-rose-200 underline-offset-4 transition hover:text-white hover:underline"
                      >
                        {thread.href}
                      </a>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {thread.comments.map((comment) => (
                      <article
                        key={comment.id}
                        className="rounded-[20px] border border-white/10 bg-black/25 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">
                              {comment.name}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/40">
                              {formatCommentDate(comment.createdAt)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void handleRemoveComment(
                                thread.model,
                                thread.content.id,
                                comment.id,
                              )
                            }
                            disabled={Boolean(activeTask)}
                            className="inline-flex min-h-9 items-center justify-center rounded-full border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-100 transition hover:bg-red-500/16 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {activeTask === `remove-comment-${comment.id}` ? 'Removendo...' : 'Remover'}
                          </button>
                        </div>

                        <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-zinc-200">
                          {comment.message}
                        </p>
                      </article>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
