export type StaticInfoKey = 'about' | 'support';

export interface StaticInfoSection {
  title: string;
  body: string;
}

export interface StaticInfoContent {
  contentType?: StaticInfoKey;
  title: string;
  description: string;
  sections: StaticInfoSection[];
  ctaLabel?: string;
  ctaHref?: string;
}

export const STATIC_INFO_CONTENT: Record<StaticInfoKey, StaticInfoContent> = {
  about: {
    contentType: 'about',
    title: 'Sobre',
    description: 'O AllPrivacy.site reúne tudo em um só lugar.',
    sections: [
      {
        title: '100% Atualizado',
        body: 'Nosso grupo é atualizado diariamente com conteúdos exclusivos.',
      },
      {
        title: 'Bot integrado',
        body: 'O bot cuida de todo o acesso ao grupo, desde o pagamento até o gerenciamento.',
      },
      {
        title: 'Tudo em um só lugar',
        body: 'São vários conteúdos exclusivos reunidos em um só lugar. Todo o conteúdo é separado por tópicos para melhor organização.',
      },
    ],
  },
  support: {
    contentType: 'support',
    title: 'Suporte',
    description:
      'Se você tiver qualquer problema com pagamento, acesso ou liberação do grupo, entre em contato com o suporte.',
    ctaLabel: 'Falar com Suporte',
    ctaHref: 'https://t.me/suporte_allprivacy',
    sections: [
      {
        title: 'Pagamento',
        body: 'Escolha seu plano, pague o pix e tenha acesso imediato. O pagamento é detectado automaticamente e o acesso liberado instantaneamente. \nCada Pix gerado tem validade de 10 minutos.',
      },
      {
        title: 'Meu Acesso',
        body: 'Gerencie seu acesso pelo bot. Você pode acompanhar e gerenciar a validade do seu acesso pelo menu "Meu Acesso" no bot AllPrivacy.',
      },
      {
        title: 'Acesso ao Grupo',
        body: 'Você terá acesso liberado ao grupo até o prazo do plano escolhido. Antes da data de expiração, o bot irá avisar antecipadamente que seu acesso ao grupo está chegando ao fim.',
      },
    ],
  },
};
