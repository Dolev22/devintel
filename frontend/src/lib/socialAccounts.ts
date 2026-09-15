/**
 * Social Accounts (Settings) — Module 9 "Connect Social Accounts" homework,
 * adapted safely for a code-analysis product deployed publicly on Vercel.
 *
 * Nothing here is a real integration:
 * - "Connect" only opens the platform's own official login page in a new
 *   browser tab (plain navigation) — it never implements OAuth and never
 *   requests, collects, stores, or transmits a password, access token, API
 *   key, cookie, or client secret.
 * - "Sync Accounts" simulates a provider sync (e.g. Blotato) with a fake
 *   delay; no external API is called.
 * - Connection/sync state lives only in the current browser's localStorage,
 *   scoped to that one visitor. It is never sent to DevIntel's backend or
 *   Supabase, so one visitor's demo state can never be seen by another
 *   visitor of this publicly deployed app.
 */

export type SocialAccountId = "facebook" | "instagram" | "linkedin";

export interface SocialAccountConfig {
  id: SocialAccountId;
  name: string;
  ratio: string;
  /** Official login page — opened as plain navigation, not an OAuth flow. */
  loginUrl: string;
  /** Official platform home page, for "Open Platform". */
  homeUrl: string;
}

export const SOCIAL_ACCOUNTS: SocialAccountConfig[] = [
  {
    id: "facebook",
    name: "Facebook",
    ratio: "1.91:1",
    loginUrl: "https://www.facebook.com/login/",
    homeUrl: "https://www.facebook.com/",
  },
  {
    id: "instagram",
    name: "Instagram",
    ratio: "1:1",
    loginUrl: "https://www.instagram.com/accounts/login/",
    homeUrl: "https://www.instagram.com/",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    ratio: "1.91:1",
    loginUrl: "https://www.linkedin.com/login",
    homeUrl: "https://www.linkedin.com/",
  },
];

export interface AccountState {
  connected: boolean;
  lastSyncedAt: string | null;
}

type AccountStateMap = Record<SocialAccountId, AccountState>;

const STORAGE_KEY = "devintel_social_accounts_demo";

function emptyState(): AccountStateMap {
  return {
    facebook: { connected: false, lastSyncedAt: null },
    instagram: { connected: false, lastSyncedAt: null },
    linkedin: { connected: false, lastSyncedAt: null },
  };
}

export function loadAccountStates(): AccountStateMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return { ...emptyState(), ...parsed };
  } catch {
    return emptyState();
  }
}

function saveAccountStates(states: AccountStateMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch {
    /* storage unavailable — demo state just won't persist across reloads */
  }
}

/** Marks a single account as demo-connected (called after opening its real login page). */
export function setAccountConnected(id: SocialAccountId, connected: boolean): AccountStateMap {
  const states = loadAccountStates();
  states[id] = { ...states[id], connected };
  saveAccountStates(states);
  return states;
}

/** Demo sync: marks all three accounts connected + stamps "now" as last synced. No real API call. */
export function syncAllAccountsDemo(): AccountStateMap {
  const now = new Date().toISOString();
  const states: AccountStateMap = {
    facebook: { connected: true, lastSyncedAt: now },
    instagram: { connected: true, lastSyncedAt: now },
    linkedin: { connected: true, lastSyncedAt: now },
  };
  saveAccountStates(states);
  return states;
}
