import { browser } from 'wxt/browser';

import { readTokenFromSite } from '@/utils/access-token';
import { clearSnapshot, loadSnapshot, saveSnapshot } from '@/utils/account-cache';
import { fetchAccountCards } from '@/utils/account-cards';
import { mountAccountPanel } from '@/utils/account-panel';
import { loadDatabase } from '@/utils/database';
import { DEFAULT_SETTINGS, loadSettings, resetSettings, saveSetting, watchSettings, type Settings } from '@/utils/settings';

const SAVE_DELAY_MS = 150;
const TOKEN_WARNING =
  'ВНИМАНИЕ!\nТокен дает полный доступ к вашему аккаунту Senkuro. \nНикогда не передавайте его третьим лицам! \nВы уверены, что хотите отобразить токен?';

type ToggleKey = 'commission' | 'copyBtn' | 'showToken' | 'valueBySplit' | 'showSummaryF' | 'showSummaryBank' | 'showSummaryCards' | 'showSummaryVerdict';
type SliderKey = 'copyBtnSize' | 'opacity' | 'fontSize' | 'summaryFontSize';
type ChoiceKey = 'positionX' | 'positionY' | 'badgeStyle' | 'effectRed' | 'effectPurple' | 'effectYellow' | 'effectGreen' | 'effectWhite';

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
  choice('effectRed', 'effectRed'),
  choice('effectPurple', 'effectPurple'),
  choice('effectYellow', 'effectYellow'),
  choice('effectGreen', 'effectGreen'),
  choice('effectWhite', 'effectWhite'),
].filter((binding): binding is Binding => binding !== null);

const showAll = (settings: Settings) => bindings.forEach((binding) => binding.show(settings));

const version = byId('version');
if (version) version.textContent = `v${browser.runtime.getManifest().version}`;

byId('resetBtn')?.addEventListener('click', () => {
  void resetSettings().then(() => showAll(DEFAULT_SETTINGS));
});

void loadSettings().then((settings) => {
  showAll(settings);
  let commission = settings.commission;
  const panel = mountAccountPanel(document, {
    readToken: readTokenFromSite,
    fetchCards: (token, onProgress) => fetchAccountCards(token, onProgress),
    loadDatabase,
    loadSnapshot,
    saveSnapshot,
    clearSnapshot,
    commission: () => commission,
    now: Date.now,
  });
  watchSettings(settings, (next, key) => {
    if (key !== 'commission') return;
    commission = next.commission;
    void panel.refresh();
  });
});
