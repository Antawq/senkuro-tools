import { storage } from 'wxt/utils/storage';

const RETIRED_ITEMS = ['local:accountCards'] as const;

export const forgetRetiredData = (): Promise<void> => storage.removeItems([...RETIRED_ITEMS]);
