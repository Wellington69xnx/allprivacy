import { motion } from 'framer-motion';
import { useState } from 'react';
import { HeroSection } from './components/HeroSection';
import { ModelModal } from './components/ModelModal';
import { ModelsStories } from './components/ModelsStories';
import { PreviewCarousel } from './components/PreviewCarousel';
import { TelegramCTA } from './components/TelegramCTA';
import { TelegramProof } from './components/TelegramProof';
import { models, previewCards } from './data/models';
import type { ModelProfile } from './types';

const TELEGRAM_GROUP_URL = 'https://t.me/seu_grupo_vip';

const perks = [
  'Entrada em um toque',
  'Atmosfera premium mobile-first',
  'Modal individual por modelo',
];

export default function App() {
  const [selectedModel, setSelectedModel] = useState<ModelProfile | null>(null);

  return (
    <div className="min-h-screen bg-ink text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(168,85,247,0.3),transparent_55%)] blur-3xl" />

      <main className="relative">
        <HeroSection ctaHref={TELEGRAM_GROUP_URL} />

        <div className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
          <PreviewCarousel items={previewCards} />
          <ModelsStories models={models} onSelect={setSelectedModel} />
          <TelegramProof />

          <motion.section
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="pt-14"
          >
            <div className="overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent p-6 shadow-neon">
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-white/60">
                CTA Final
              </span>
              <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Tudo pronto para converter com foco total no polegar e na urgencia.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                A pagina entrega prova visual, ritmo de scroll e pontos de clique
                estrategicos para transformar curiosidade em entrada no grupo.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {perks.map((perk) => (
                  <span
                    key={perk}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/75"
                  >
                    {perk}
                  </span>
                ))}
              </div>

              <TelegramCTA
                href={TELEGRAM_GROUP_URL}
                label="Entrar no Grupo VIP"
                className="mt-6 w-full sm:w-auto"
              />
            </div>
          </motion.section>
        </div>
      </main>

      <ModelModal
        model={selectedModel}
        onClose={() => setSelectedModel(null)}
        ctaHref={TELEGRAM_GROUP_URL}
      />
    </div>
  );
}
