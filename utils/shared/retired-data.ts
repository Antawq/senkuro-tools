import { storage } from 'wxt/utils/storage';

const RETIRED_ITEMS = ['local:accountCards', 'local:autoProfileValue'] as const;

export const forgetRetiredData = (): Promise<void> => storage.removeItems([...RETIRED_ITEMS]);
