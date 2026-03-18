import { motion } from 'framer-motion';
import type { ModelProfile } from '../types';
import { SectionHeader } from './SectionHeader';

interface ModelsStoriesProps {
  models: ModelProfile[];
  onSelect: (model: ModelProfile) => void;
}

export function ModelsStories({ models, onSelect }: ModelsStoriesProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pt-14"
    >
      <SectionHeader
        eyebrow="Modelos do Grupo"
        title="Stories rolaveis para tocar, abrir e explorar em poucos segundos."
        description="Na home ficam algumas selecionadas. Ao final da faixa, deixamos claro que existem outras modelos disponiveis alem das exibidas aqui."
      />

      <div className="mt-6 flex gap-4 overflow-x-auto pb-3 md:flex-wrap md:overflow-visible">
        {models.map((model, index) => (
          <motion.button
            key={model.id}
            type="button"
            onClick={() => onSelect(model)}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.35, delay: index * 0.05 }}
            whileTap={{ scale: 0.96 }}
            className="min-w-[92px] shrink-0 text-center"
          >
            <span
              className="mx-auto flex h-[84px] w-[84px] items-center justify-center rounded-full p-[3px] shadow-glow"
              style={{
                backgroundImage: `linear-gradient(135deg, ${model.accentFrom}, ${model.accentTo})`,
              }}
            >
              <span className="block h-full w-full overflow-hidden rounded-full border border-black/25 bg-black">
                <img
                  src={model.profileImage}
                  alt={model.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </span>
            </span>
            <span className="mt-3 block text-xs font-semibold text-white">{model.name}</span>
          </motion.button>
        ))}

        <div className="min-w-[92px] shrink-0 text-center md:ml-1">
          <span className="mx-auto flex h-[84px] w-[84px] items-center justify-center rounded-full border border-dashed border-white/20 bg-white/[0.04] text-white/75 shadow-neon">
            <span className="font-display text-2xl font-semibold">+</span>
          </span>
          <span className="mt-3 block text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
            E muito mais
          </span>
        </div>
      </div>
    </motion.section>
  );
}
