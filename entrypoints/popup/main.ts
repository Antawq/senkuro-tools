import './style.css';
import '@/assets/tokens.css';
import { browser } from 'wxt/browser';

import { tierRange, type TierName } from '@/utils/badges/tiers';
import { COMMISSION_SHARE_KEPT, PERCENT } from '@/utils/shared/cards';
import { DEFAULT_SETTINGS, loadSettings, resetSettings, saveSetting, type Settings } from '@/utils/shared/settings';
import { CRAFT_PER_RANK, SPLIT_PER_RANK } from '@/utils/shared/trade-value';

const SAVE_DELAY_MS = 150;
const TOKEN_WARNING =
  'ВНИМАНИЕ!\nТокен дает полный доступ к вашему аккаунту Senkuro. \nНикогда не передавайте его третьим лицам! \nВы уверены, что хотите отобразить токен?';

type ToggleKey =
  'commission' | 'copyBtn' | 'showToken' | 'valueBySplit' | 'excludeShards' | 'showSummaryF' | 'showSummaryBank' | 'showSummaryCards' | 'showSummaryVerdict';
type SliderKey = 'copyBtnSize' | 'opacity' | 'fontSize' | 'summaryFontSize';
type ChoiceKey = 'positionX' | 'positionY' | 'badgeStyle' | 'valueBasis' | 'effectRed' | 'effectPurple' | 'effectYellow' | 'effectGreen' | 'effectWhite';

interface Binding {
  show(settings: Settings): void;
}

const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function toggle(id: string, key: ToggleKey, warning?: string): Binding | null {
  const input = byId<HTMLInputElement>(id);
  if (!input) return null;
  input.addEventListener('change', () => {
    if (input.checked && warning && !confirm(warning)) {
      input.checked = false;
      return;
    }
    void saveSetting(key, input.checked);
  });
  return { show: (settings) => (input.checked = settings[key]) };
}

function slider(id: string, labelId: string, unit: string, key: SliderKey): Binding | null {
  const input = byId<HTMLInputElement>(id);
  const label = byId(labelId);
  if (!input) return null;
  const showLabel = (value: number) => {
    if (label) label.textContent = `${value}${unit}`;
  };
  const save = debounce((value: number) => void saveSetting(key, value), SAVE_DELAY_MS);
  input.addEventListener('input', () => {
    const value = Number.parseInt(input.value, 10);
    showLabel(value);
    save(value);
  });
  return {
    show: (settings) => {
      input.value = String(settings[key]);
      showLabel(settings[key]);
    },
  };
}

function choice<K extends ChoiceKey>(id: string, key: K): Binding | null {
  const select = byId<HTMLSelectElement>(id);
  if (!select) return null;
  select.addEventListener('change', () => void saveSetting(key, select.value as Settings[K]));
  return { show: (settings) => (select.value = settings[key]) };
}

const bindings = [
  toggle('commissionToggle', 'commission'),
  toggle('copyBtnToggle', 'copyBtn'),
  toggle('showTokenToggle', 'showToken', TOKEN_WARNING),
  toggle('valueBySplitToggle', 'valueBySplit'),
  toggle('excludeShardsToggle', 'excludeShards'),
  toggle('showSummaryFToggle', 'showSummaryF'),
  toggle('showSummaryBankToggle', 'showSummaryBank'),
  toggle('showSummaryCardsToggle', 'showSummaryCards'),
  toggle('showSummaryVerdictToggle', 'showSummaryVerdict'),
  slider('copyBtnSizeSlider', 'copyBtnSizeValue', 'px', 'copyBtnSize'),
  slider('opacitySlider', 'opacityValue', '%', 'opacity'),
  slider('fontSizeSlider', 'fontSizeValue', 'px', 'fontSize'),
  slider('summaryFontSizeSlider', 'summaryFontSizeValue', 'px', 'summaryFontSize'),
  choice('positionXSelect', 'positionX'),
  choice('positionYSelect', 'positionY'),
  choice('styleSelect', 'badgeStyle'),
  choice('valueBasisSelect', 'valueBasis'),
  choice('effectRed', 'effectRed'),
  choice('effectPurple', 'effectPurple'),
  choice('effectYellow', 'effectYellow'),
  choice('effectGreen', 'effectGreen'),
  choice('effectWhite', 'effectWhite'),
].filter((binding): binding is Binding => binding !== null);

const showAll = (settings: Settings) => bindings.forEach((binding) => binding.show(settings));

const RATES: Record<string, number> = { craft: CRAFT_PER_RANK, split: SPLIT_PER_RANK };

document.querySelectorAll<HTMLElement>('[data-tier-range]').forEach((el) => (el.textContent = tierRange(el.dataset.tierRange as TierName)));
document.querySelectorAll<HTMLElement>('[data-rate]').forEach((el) => (el.textContent = String(RATES[el.dataset.rate ?? ''] ?? '')));
document
  .querySelectorAll<HTMLElement>('[data-commission-percent]')
  .forEach((el) => (el.textContent = String(Math.round((1 - COMMISSION_SHARE_KEPT) * PERCENT))));

const version = byId('version');
if (version) version.textContent = `v${browser.runtime.getManifest().version}`;

byId('resetBtn')?.addEventListener('click', () => {
  void resetSettings().then(() => showAll(DEFAULT_SETTINGS));
});

void loadSettings().then(showAll);
