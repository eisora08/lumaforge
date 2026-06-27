export type LuaProviderUpdateCheck = {
  appId: number;

  providerAvailable: boolean;
  providerName?: string;

  providerLastUpdatedAt?: string;
  lastCheckedAt: string;

  message: string;
};