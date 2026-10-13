'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AppSettings } from '@/lib/types';
import { api } from '@/lib/api';

const KEY = 'tailor-pos-settings';

const DEFAULTS: AppSettings = {
  taxRate: 5,
  bookNo: 270,
  salesman: 'GENERAL',
  deliveryDays: 7,
  company: {
    name: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    trn: '',
    logo: '',
    brandLogo: '',
    brandTagline: '',
  },
  bank: {
    name: '',
    accountType: '',
    accountName: '',
    accountNo: '',
    iban: '',
    swift: '',
    chequeFavour: '',
    note: '',
  },
  invoiceTitle: 'Order Invoice',
};

function mergeSettings(base: AppSettings, incoming?: Partial<AppSettings> | null): AppSettings {
  if (!incoming) return base;
  return {
    ...base,
    ...incoming,
    company: { ...base.company, ...(incoming.company ?? {}) },
    bank: { ...base.bank, ...(incoming.bank ?? {}) },
  };
}

const SettingsCtx = createContext<{
  settings: AppSettings;
  save: (s: AppSettings) => Promise<void> | void;
  reload: () => Promise<void>;
}>({ settings: DEFAULTS, save: () => {}, reload: async () => {} });

export const useSettings = () => useContext(SettingsCtx);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);

  useEffect(() => {
    // 1. Initial immediate load from localStorage so cached settings appear instantly
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<AppSettings>;
        setSettings((prev) => mergeSettings(prev, saved));
      }
    } catch {
      /* ignore */
    }

    // 2. Fetch authoritative business settings from server
    void reload();
  }, []);

  const reload = async () => {
    try {
      const fromServer = await api.settings.get();
      if (fromServer) {
        setSettings((prev) => {
          const merged = mergeSettings(prev, fromServer);
          try {
            localStorage.setItem(KEY, JSON.stringify(merged));
          } catch {
            /* ignore */
          }
          return merged;
        });
      }
    } catch {
      /* offline or network error - use localStorage */
    }
  };

  const save = async (s: AppSettings) => {
    setSettings(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
    try {
      await api.settings.update(s);
    } catch {
      /* offline or permission issue */
    }
  };

  return <SettingsCtx.Provider value={{ settings, save, reload }}>{children}</SettingsCtx.Provider>;
}
