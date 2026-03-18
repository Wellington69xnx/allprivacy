import type { ModelProfile, PreviewCard } from '../types';

function demoImage(id: string, width: number, height: number) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&h=${height}&q=80`;
}

const demoVideos = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-10s.mp4',
];

const modelSeeds = [
  {
    id: 'valentina-noir',
    name: 'Valentina Noir',
    handle: '@valentina.noir',
    tagline: 'Drops privados toda noite',
    status: 'Online agora',
    accentFrom: '#ff2056',
    accentTo: '#8b5cf6',
    photos: [
      'photo-1494790108377-be9c29b29330',
      'photo-1488426862026-3ee34a7d66df',
      'photo-1515886657613-9f3515b0c78f',
    ],
  },
  {
    id: 'jade-scarlet',
    name: 'Jade Scarlet',
    handle: '@jade.scarlet',
    tagline: 'Bastidores e especiais filtrados',
    status: 'Atualizado hoje',
    accentFrom: '#ef4444',
    accentTo: '#7c3aed',
    photos: [
      'photo-1496747611176-843222e1e57c',
      'photo-1487412720507-e7ab37603c6f',
      'photo-1517841905240-472988babdf9',
    ],
  },
  {
    id: 'luna-velvet',
    name: 'Luna Velvet',
    handle: '@lunavelvet',
    tagline: 'Previas curadas e videos curtos',
    status: 'Nova no grupo',
    accentFrom: '#f43f5e',
    accentTo: '#9333ea',
    photos: [
      'photo-1517365830460-955ce3ccd263',
      'photo-1524504388940-b1c1722653e1',
      'photo-1521119989659-a83eee488004',
    ],
  },
  {
    id: 'aurora-blaze',
    name: 'Aurora Blaze',
    handle: '@aurora.blaze',
    tagline: 'Conteudo premium liberado em ondas',
    status: 'Mais pedida',
    accentFrom: '#fb7185',
    accentTo: '#6d28d9',
    photos: [
      'photo-1512316609839-ce289d3eba0a',
      'photo-1529139574466-a303027c1d8b',
      'photo-1500917293891-ef795e70e1f6',
    ],
  },
  {
    id: 'kiara-onyx',
    name: 'Kiara Onyx',
    handle: '@kiara.onyx',
    tagline: 'Compilacoes exclusivas e chamadas VIP',
    status: 'Acesso imediato',
    accentFrom: '#dc2626',
    accentTo: '#7e22ce',
    photos: [
      'photo-1506863530036-1efeddceb993',
      'photo-1499952127939-9bbf5af6c51c',
      'photo-1526045478516-99145907023c',
    ],
  },
];

const galleryBlueprint = [
  { suffix: 'Preview 01', type: 'image' as const, subtitle: 'Ensaio liberado' },
  { suffix: 'Preview 02', type: 'video' as const, subtitle: 'Video curto em loop' },
  { suffix: 'Preview 03', type: 'image' as const, subtitle: 'Recorte premium' },
  { suffix: 'Preview 04', type: 'video' as const, subtitle: 'Previa em movimento' },
  { suffix: 'Preview 05', type: 'image' as const, subtitle: 'Bastidor aberto' },
  { suffix: 'Preview 06', type: 'video' as const, subtitle: 'Mais um trecho liberado' },
];

export const models: ModelProfile[] = modelSeeds.map((seed) => ({
  ...seed,
  profileImage: demoImage(seed.photos[0], 520, 520),
  coverImage: demoImage(seed.photos[1], 900, 1240),
  gallery: galleryBlueprint.map((item, index) => ({
    id: `${seed.id}-${index}`,
    type: item.type,
    title: item.suffix,
    subtitle: item.subtitle,
    thumbnail: demoImage(seed.photos[index % seed.photos.length], 800, 1200),
    src: item.type === 'video' ? demoVideos[index % demoVideos.length] : undefined,
  })),
}));

export const previewCards: PreviewCard[] = models.flatMap((model) =>
  model.gallery.slice(0, 4).map((item, index) => ({
    id: `${model.id}-preview-${index}`,
    owner: model.name,
    title: item.title,
    type: item.type,
    thumbnail: item.thumbnail,
    src: item.src,
    accentFrom: model.accentFrom,
    accentTo: model.accentTo,
  })),
);

export const groupProofItems = [
  {
    id: 'grupo-principal',
    title: 'Print do Grupo Principal',
    subtitle: 'Substitua por um print real da conversa',
    image: demoImage('photo-1512941937669-90a1b58e7e9c', 1200, 1600),
  },
  {
    id: 'mural-vip',
    title: 'Area de Conteudos',
    subtitle: 'Ideal para print da lista de midias e destaques',
    image: demoImage('photo-1499951360447-b19be8fe80f5', 1200, 1600),
  },
  {
    id: 'alertas-entrada',
    title: 'Canal de Alertas',
    subtitle: 'Use um print de notificacoes ou chamadas de entrada',
    image: demoImage('photo-1516321318423-f06f85e504b3', 1200, 1600),
  },
];

export const heroBackdrop = demoImage('photo-1515886657613-9f3515b0c78f', 1400, 2200);
