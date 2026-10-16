import { storage, type WxtStorageItem } from 'wxt/utils/storage';

export type BadgePositionX = 'left' | 'center' | 'right';
export type BadgePositionY = 'top' | 'center' | 'bottom';
export type BadgeStyle = 'background' | 'outline';
export type ValueBasis = 'bank' | 'cards';
export type PriceEffect = '' | 'price-effect-rgb' | 'price-effect-tilt' | 'price-effect-bg' | 'price-effect-pulse';

export interface Settings {
  commission: boolean;
  copyBtn: boolean;
  copyBtnSize: number;
  positionX: BadgePositionX;
  positionY: BadgePositionY;
  opacity: number;
  badgeStyle: BadgeStyle;
  fontSize: number;
  summaryFontSize: number;
  effectRed: PriceEffect;
  effectPurple: PriceEffect;
  effectYellow: PriceEffect;
  effectGreen: PriceEffect;
  effectWhite: PriceEffect;
  showToken: boolean;
  valueBySplit: boolean;
  valueBasis: ValueBasis;
  showSummaryF: boolean;
  showSummaryBank: boolean;
  showSummaryCards: boolean;
  showSummaryVerdict: boolean;
}

export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  commission: true,
  copyBtn: false,
  copyBtnSize: 18,
  positionX: 'right',
  positionY: 'bottom',
  opacity: 75,
  badgeStyle: 'background',
  fontSize: 16,
  summaryFontSize: 12,
  effectRed: 'price-effect-rgb',
  effectPurple: 'price-effect-tilt',
  effectYellow: 'price-effect-bg',
  effectGreen: 'price-effect-pulse',
  effectWhite: '',
  showToken: false,
  valueBySplit: false,
  valueBasis: 'bank',
  showSummaryF: true,
  showSummaryBank: true,
  showSummaryCards: true,
  showSummaryVerdict: true,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

type SettingItems = { [K in SettingKey]: WxtStorageItem<Settings[K], Record<string, never>> };

const defineSetting = <K extends SettingKey>(key: K) =>
  storage.defineItem<Settings[K], Record<string, never>>(`local:${key}`, { fallback: DEFAULT_SETTINGS[key] });

const ITEMS = Object.fromEntries(KEYS.map((key) => [key, defineSetting(key)])) as SettingItems;

const LEGACY_POSITION = storage.defineItem<string>('local:position');

const LEGACY_POSITIONS: Readonly<Record<string, readonly [BadgePositionX, BadgePositionY]>> = {
  'top-left': ['left', 'top'],
  'center-left': ['left', 'center'],
  'bottom-left': ['left', 'bottom'],
  'top-right': ['right', 'top'],
  'center-right': ['right', 'center'],
  'bottom-right': ['right', 'bottom'],
  center: ['center', 'center'],
};

async function migrateLegacyPosition(): Promise<void> {
  const legacy = await LEGACY_POSITION.getValue();
  if (legacy === null) return;
  const axes = LEGACY_POSITIONS[legacy];
  if (axes) {
    const [x, y] = axes;
    if ((await storage.getItem('local:positionX')) === null) await ITEMS.positionX.setValue(x);
    if ((await storage.getItem('local:positionY')) === null) await ITEMS.positionY.setValue(y);
  }
  await LEGACY_POSITION.removeValue();
}

export async function loadSettings(): Promise<Settings> {
  await migrateLegacyPosition();
  const values = await Promise.all(KEYS.map(async (key) => [key, await ITEMS[key].getValue()] as const));
  return Object.fromEntries(values) as unknown as Settings;
}

export const saveSetting = <K extends SettingKey>(key: K, value: Settings[K]): Promise<void> => ITEMS[key].setValue(value);

export const resetSettings = async (): Promise<void> => {
  await Promise.all(KEYS.map((key) => saveSetting(key, DEFAULT_SETTINGS[key])));
};

export function watchSettings(current: Settings, onChange: (settings: Settings, key: SettingKey) => void): () => void {
  let settings = current;
  const unwatchers = KEYS.map((key) =>
    ITEMS[key].watch((value) => {
      settings = { ...settings, [key]: value };
      onChange(settings, key);
    })
  );
  return () => unwatchers.forEach((unwatch) => unwatch());
}
