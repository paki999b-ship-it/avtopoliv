import { create } from 'zustand';

/**
 * Роутинг приложения.
 *
 * Адресной строки у desktop-приложения нет, поэтому вместо react-router —
 * собственный маршрут в состоянии: типизированный, со стеком «назад» и без
 * лишней зависимости. Разделы перечислены объединением, так что переход на
 * несуществующий экран не компилируется.
 */

export type Route =
  | { name: 'profiles' }
  | { name: 'home' }
  | { name: 'academy'; level?: string }
  | { name: 'lesson'; lessonKey: string }
  | { name: 'calculators'; calculatorKey?: string }
  | { name: 'reference'; section?: string; table?: string; query?: string }
  | { name: 'layout'; taskKey?: string }
  | { name: 'assembly'; taskKey?: string }
  | { name: 'errors'; scenarioKey?: string }
  | { name: 'diagnostics'; symptomKey?: string }
  | { name: 'safety'; topicKey?: string }
  | { name: 'exam' }
  | { name: 'settings' };

export type RouteName = Route['name'];

interface RouterState {
  route: Route;
  history: Route[];
  navigate: (route: Route) => void;
  back: () => void;
  canGoBack: () => boolean;
  reset: (route: Route) => void;
}

const MAX_HISTORY = 50;

export const useRouter = create<RouterState>((set, get) => ({
  route: { name: 'profiles' },
  history: [],

  navigate: (route) =>
    set((state) => ({
      route,
      history: [...state.history, state.route].slice(-MAX_HISTORY),
    })),

  back: () =>
    set((state) => {
      const previous = state.history[state.history.length - 1];
      if (!previous) return state;
      return { route: previous, history: state.history.slice(0, -1) };
    }),

  canGoBack: () => get().history.length > 0,

  // Смена профиля обнуляет историю: возвращаться в чужой прогресс нельзя.
  reset: (route) => set({ route, history: [] }),
}));
