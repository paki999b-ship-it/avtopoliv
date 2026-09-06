import { create } from 'zustand';
import type {
  AppInfo,
  Profile,
  ProfileDraft,
  ProfilePatch,
  ProgressSummary,
} from '@shared/types.js';
import { errorText, invoke } from '../lib/bridge.js';
import { useRouter } from './router.js';

/**
 * Сессия: список профилей, выбранный профиль, его прогресс и сведения о сборке.
 *
 * Прогресс профиля хранится здесь, а не в компонентах: его показывают и
 * дашборд, и шапка, и экран выбора профиля — пересчитывать в трёх местах
 * означало бы три разных числа на экране одновременно.
 */

interface SessionState {
  ready: boolean;
  loading: boolean;
  error: string | null;

  appInfo: AppInfo | null;
  profiles: Profile[];
  activeProfile: Profile | null;
  progress: ProgressSummary | null;

  bootstrap: () => Promise<void>;
  createProfile: (draft: ProfileDraft) => Promise<Profile>;
  updateActiveProfile: (patch: ProfilePatch) => Promise<void>;
  deleteProfile: (id: number) => Promise<void>;
  selectProfile: (id: number) => Promise<void>;
  refreshProgress: () => Promise<void>;
  signOut: () => void;
  clearError: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,

  appInfo: null,
  profiles: [],
  activeProfile: null,
  progress: null,

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const [appInfo, profiles] = await Promise.all([
        invoke('app:info'),
        invoke('profiles:list'),
      ]);
      set({ appInfo, profiles, ready: true });
    } catch (error) {
      set({ error: errorText(error), ready: true });
    } finally {
      set({ loading: false });
    }
  },

  createProfile: async (draft) => {
    set({ loading: true, error: null });
    try {
      const profile = await invoke('profiles:create', draft);
      set({ profiles: [...get().profiles, profile] });
      return profile;
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  updateActiveProfile: async (patch) => {
    const active = get().activeProfile;
    if (!active) return;
    try {
      const updated = await invoke('profiles:update', active.id, patch);
      set({
        activeProfile: updated,
        profiles: get().profiles.map((p) => (p.id === updated.id ? updated : p)),
      });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  deleteProfile: async (id) => {
    try {
      await invoke('profiles:delete', id);
      const active = get().activeProfile;
      set({
        profiles: get().profiles.filter((p) => p.id !== id),
        ...(active?.id === id ? { activeProfile: null, progress: null } : {}),
      });
      if (active?.id === id) useRouter.getState().reset({ name: 'profiles' });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  selectProfile: async (id) => {
    set({ loading: true, error: null });
    try {
      // touch первым: он же пересчитывает стрик, и прогресс должен читаться
      // уже с новым значением, иначе шапка покажет вчерашнее.
      const profile = await invoke('profiles:touch', id);
      const progress = await invoke('progress:summary', id);
      set({
        activeProfile: profile,
        progress,
        profiles: get().profiles.map((p) => (p.id === profile.id ? profile : p)),
      });
      useRouter.getState().reset({ name: 'home' });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ loading: false });
    }
  },

  refreshProgress: async () => {
    const active = get().activeProfile;
    if (!active) return;
    try {
      const progress = await invoke('progress:summary', active.id);
      set({ progress });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  signOut: () => {
    set({ activeProfile: null, progress: null });
    useRouter.getState().reset({ name: 'profiles' });
  },

  clearError: () => set({ error: null }),
}));
