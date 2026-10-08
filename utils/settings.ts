import { storage, type WxtStorageItem } from 'wxt/utils/storage';

export type BadgePosition = 'top-right' | 'bottom-right' | 'center-right' | 'top-left' | 'bottom-left' | 'center-left' | 'center';
export type BadgeStyle = 'background' | 'outline';
export type PriceEffect = '' | 'price-effect-rgb' | 'price-effect-tilt' | 'price-effect-bg' | 'price-effect-pulse';

export interface Settings {
  commission: boolean;
  copyBtn: boolean;
  copyBtnSize: number;
  position: BadgePosition;
  opacity: number;
  badgeStyle: BadgeStyle;
  fontSize: number;
  effectRed: PriceEffect;
  effectPurple: PriceEffect;
  effectYellow: PriceEffect;
  effectGreen: PriceEffect;
  effectWhite: PriceEffect;
  showToken: boolean;
  valueBySplit: boolean;
}

export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  commission: true,
  copyBtn: false,
  copyBtnSize: 18,
  position: 'bottom-right',
  opacity: 75,
  badgeStyle: 'background',
  fontSize: 16,
  effectRed: 'price-effect-rgb',
  effectPurple: 'price-effect-tilt',
  effectYellow: 'price-effect-bg',
  effectGreen: 'price-effect-pulse',
  effectWhite: '',
  showToken: false,
  valueBySplit: false,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

type SettingItems = { [K in SettingKey]: WxtStorageItem<Settings[K], Record<string, never>> };

const defineSetting = <K extends SettingKey>(key: K) =>
  storage.defineItem<Settings[K], Record<string, never>>(`local:${key}`, { fallback: DEFAULT_SETTINGS[key] });

const ITEMS = Object.fromEntries(KEYS.map((key) => [key, defineSetting(key)])) as SettingItems;

export async function loadSettings(): Promise<Settings> {
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
