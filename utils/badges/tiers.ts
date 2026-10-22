export type TierName = 'red' | 'yellow' | 'purple' | 'green' | 'white';

type EffectKey = 'effectRed' | 'effectYellow' | 'effectPurple' | 'effectGreen' | 'effectWhite';

export interface Tier {
  name: TierName;
  from: number;
  effect: EffectKey;
}

const THRESHOLD_DIGITS = 1;

const TIERS: readonly Tier[] = [
  { name: 'red', from: 3.0, effect: 'effectRed' },
  { name: 'yellow', from: 2.4, effect: 'effectYellow' },
  { name: 'purple', from: 2.0, effect: 'effectPurple' },
  { name: 'green', from: 1.6, effect: 'effectGreen' },
  { name: 'white', from: -Infinity, effect: 'effectWhite' },
];

const LOWEST = TIERS[TIERS.length - 1] as Tier;

export const tierOf = (price: number): Tier => TIERS.find(({ from }) => price >= from) ?? LOWEST;

export function tierRange(name: TierName): string {
  const index = TIERS.findIndex((tier) => tier.name === name);
  const tier = TIERS[index];
  if (!tier) return '';
  if (Number.isFinite(tier.from)) return `${tier.from.toFixed(THRESHOLD_DIGITS)}+`;
  const above = TIERS[index - 1];
  return above ? `< ${above.from.toFixed(THRESHOLD_DIGITS)}` : '';
}
