import { useState, type FormEvent } from 'react';
import { getHomePath } from '../lib/modelRoute';

interface AdminLoginProps {
  isChecking: boolean;
  error: string | null;
  onLogin: (input: { username: string; password: string }) => Promise<void>;
}

export function AdminLogin({ isChecking, error, onLogin }: AdminLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting || isChecking) {
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      await onLogin({ username, password });
    } catch {
      setFeedback('Usu\u00e1rio ou senha inv\u00e1lidos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="mx-auto flex min-h-screen max-w-[1440px] items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-md rounded-[34px] border border-white/10 bg-white/[0.04] p-6 shadow-neon backdrop-blur-xl sm:p-8">
          <a
            href={getHomePath()}
            className="text-xs font-semibold uppercase tracking-[0.26em] text-white/45"
          >
            Voltar para o site
          </a>

          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
            AllPrivacy Admin
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            {'Esta \u00e1rea \u00e9 protegida. Fa\u00e7a login para gerenciar modelos, v\u00eddeos, imagens e prints do grupo.'}
          </p>

          <form className="mt-6 grid gap-3" onSubmit={(event) => void handleSubmit(event)}>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-black/55 md:text-[15px]"
              placeholder={'Usu\u00e1rio'}
              autoComplete="username"
              disabled={isSubmitting || isChecking}
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              className="min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/30 focus:border-white/20 focus:bg-black/55 md:text-[15px]"
              placeholder="Senha"
              autoComplete="current-password"
              disabled={isSubmitting || isChecking}
            />

            <button
              type="submit"
              disabled={isSubmitting || isChecking}
              className="mt-2 inline-flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-rose-600 to-violet-600 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isChecking ? 'Verificando acesso...' : isSubmitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {feedback || error ? (
            <div className="mt-4 rounded-[24px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {feedback || error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
