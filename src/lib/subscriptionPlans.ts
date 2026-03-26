export type SubscriptionPlanId = '7d' | '30d';

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  name: string;
  durationLabel: string;
  displayAmount: number;
}

export interface SubscriptionPlanLink extends SubscriptionPlan {
  href: string;
}

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: '7d',
    name: 'Plano 7 dias',
    durationLabel: '7 dias',
    displayAmount: 9.99,
  },
  {
    id: '30d',
    name: 'Plano 30 dias',
    durationLabel: '30 dias',
    displayAmount: 19.99,
  },
];

export function formatPlanAmountBRL(amount: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}
