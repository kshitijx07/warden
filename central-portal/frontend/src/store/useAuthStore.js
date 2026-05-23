import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  token: localStorage.getItem('warden_admin_token') || '',
  admin: JSON.parse(localStorage.getItem('warden_admin_user') || 'null'),
  sidebarCollapsed: false,
  alerts: [],
  isMuted: localStorage.getItem('warden_muted') === 'true',

  setAuth: (token, admin) => {
    localStorage.setItem('warden_admin_token', token);
    localStorage.setItem('warden_admin_user', JSON.stringify(admin));
    set({ token, admin });
  },

  logout: () => {
    localStorage.removeItem('warden_admin_token');
    localStorage.removeItem('warden_admin_user');
    set({ token: '', admin: null, alerts: [] });
  },

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  toggleMute: () => set((state) => {
    const newMuted = !state.isMuted;
    localStorage.setItem('warden_muted', String(newMuted));
    return { isMuted: newMuted };
  }),

  addAlert: (alert) => set((state) => {
    // Prevent duplicates by checking if ID already exists in store
    if (state.alerts.some(a => a.id === alert.id)) {
      return { alerts: state.alerts };
    }
    return { alerts: [alert, ...state.alerts].slice(0, 50) }; // Cap alert feed at 50 in memory
  }),

  setInitialAlerts: (alerts) => set({ alerts }),

  clearAlerts: () => set({ alerts: [] }),
}));
