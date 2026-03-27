import { getAboutPath, getHomePath, getSupportPath } from '../lib/modelRoute';

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-black/35">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-7 lg:px-8">
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="hidden lg:block" />

          <div className="text-center">
          <a
            href={getHomePath()}
            className="font-display text-xl font-semibold tracking-tight text-white"
          >
            AllPrivacy.site
          </a>
          <p className="mt-1 text-sm text-zinc-400">
            Entrada discreta e acesso organizado em um so lugar.
          </p>
          </div>

          <nav className="flex items-center justify-center gap-5 text-sm text-zinc-300 lg:justify-self-end">
            <a href={getAboutPath()} className="transition hover:text-white">
              Sobre
            </a>
            <a href={getSupportPath()} className="transition hover:text-white">
              Suporte
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
