import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi, deviceApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const sessionVersion = useRef(0);

  const safeLocalStorageGet = useCallback((key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('localStorage get failed', key, error);
      return null;
    }
  }, []);

  const [user, setUser] = useState(() => {
    try { return JSON.parse(safeLocalStorageGet('eco_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  const safeLocalStorageSet = useCallback((key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('localStorage set failed', key, error);
    }
  }, []);

  const safeLocalStorageRemove = useCallback((key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('localStorage remove failed', key, error);
    }
  }, []);

  const logout = useCallback(() => {
    sessionVersion.current += 1;
    const pushToken = safeLocalStorageGet('eco_push_token');
    const authToken = safeLocalStorageGet('eco_token');
    if (authToken) authApi.logout(authToken).catch(() => {});
    if (pushToken) {
      deviceApi.unregister(pushToken, authToken).catch(() => {});
      safeLocalStorageRemove('eco_push_token');
    }
    safeLocalStorageRemove('eco_token');
    safeLocalStorageRemove('eco_user');
    setUser(null);
  }, [safeLocalStorageGet, safeLocalStorageRemove]);

  const fetchMe = useCallback(async () => {
    const token = safeLocalStorageGet('eco_token');
    if (!token) { setLoading(false); return; }
    const requestVersion = sessionVersion.current;
    try {
      const { data } = await authApi.me();
      if (
        requestVersion !== sessionVersion.current
        || safeLocalStorageGet('eco_token') !== token
      ) return;
      setUser(data.data);
      safeLocalStorageSet('eco_user', JSON.stringify(data.data));
    } catch (error) {
      if (
        requestVersion === sessionVersion.current
        && safeLocalStorageGet('eco_token') === token
        && (error.response?.status === 401 || error.response?.status === 403)
      ) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  }, [logout, safeLocalStorageGet, safeLocalStorageSet]);

  useEffect(() => {
    fetchMe();
    const interval = setInterval(fetchMe, 30000);
    return () => clearInterval(interval);
  }, [fetchMe]);

  const login = useCallback((token, userData) => {
    sessionVersion.current += 1;
    safeLocalStorageSet('eco_token', token);
    safeLocalStorageSet('eco_user', JSON.stringify(userData));
    setUser(userData);
  }, [safeLocalStorageSet]);

  const updateUser = useCallback((updates) => {
    setUser(prev => {
      const updated = { ...prev, ...updates };
      safeLocalStorageSet('eco_user', JSON.stringify(updated));
      return updated;
    });
  }, [safeLocalStorageSet]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
