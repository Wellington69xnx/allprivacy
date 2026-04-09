import { getHomePath } from '../lib/modelRoute';
import type { StaticInfoSection } from '../lib/staticInfo';
import { BrandMark } from './BrandMark';
import { SiteFooter } from './SiteFooter';
import { TelegramCTA } from './TelegramCTA';

interface StaticInfoPageProps {
  title: string;
  description: string;
  sections: StaticInfoSection[];
  ctaLabel?: string;
  ctaHref?: string;
}

export function StaticInfoPage({
  title,
  description,
  sections,
  ctaLabel,
  ctaHref,
}: StaticInfoPageProps) {
  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="fixed inset-0">
        <div className="absolute inset-0 bg-black" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,29,29,0.18),transparent_24%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_34%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/45" />
      </div>

      <div className="relative">
        <div className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6 lg:px-8">
          <div
            className="relative flex justify-center px-4 py-5"
            style={{ paddingTop: 'max(env(safe-area-inset-top), 1.25rem)' }}
          >
            <a
              href={getHomePath()}
              className="absolute left-4 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/50 transition hover:text-white/75 sm:inline-flex md:text-[13px]"
            >
              <span aria-hidden="true">{'‹'}</span>
              <span>{'Página inicial'}</span>
            </a>
            <BrandMark href="/" />
          </div>

          <div className="mx-auto flex max-w-5xl px-1 sm:hidden">
            <a
              href={getHomePath()}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50 transition hover:text-white/75"
            >
              <span aria-hidden="true">{'‹'}</span>
              <span>{'Página inicial'}</span>
            </a>
          </div>

          <section className="mx-auto max-w-5xl pt-6 sm:pt-10">
            <div className="overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.04] shadow-[0_30px_100px_rgba(0,0,0,0.32)] backdrop-blur-xl">
              <div className="border-b border-white/10 px-5 py-8 sm:px-8 sm:py-10">
                <h1 className="max-w-3xl font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                  {title}
                </h1>
                <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-6 text-zinc-300 sm:text-base">
                  {description}
                </p>
              </div>

              <div className="grid gap-4 px-5 py-5 sm:px-8 sm:py-8 lg:grid-cols-3">
                {sections.map((section) => (
                  <article
                    key={section.title}
                    className="rounded-[26px] border border-white/10 bg-black/20 p-5"
                  >
                    <h2 className="font-display text-xl font-semibold tracking-tight text-white">
                      {section.title}
                    </h2>
                    <p className="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-300">
                      {section.body}
                    </p>
                  </article>
                ))}
              </div>

              {ctaHref && ctaLabel ? (
                <div className="hidden px-5 pb-5 sm:px-8 sm:pb-8 md:block">
                  <div className="rounded-[26px] border border-white/10 bg-black/20 p-5">
                    <TelegramCTA href={ctaHref} label={ctaLabel} className="w-full sm:w-auto" />
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <SiteFooter />
        {ctaHref && ctaLabel ? (
          <div
            className="h-[calc(env(safe-area-inset-bottom)+6.25rem)] md:hidden"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {ctaHref && ctaLabel ? (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#09090c] via-[#09090c]/95 to-transparent px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-6 md:hidden">
          <div className="mx-auto max-w-[1440px]">
            <TelegramCTA href={ctaHref} label={ctaLabel} className="min-h-12 w-full px-5 py-3 text-sm" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
