import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { hasFeature as planHasFeature } from '../constants/plans';
import { clearPersistedCache } from '../utils/requestCache';
import { clearStoredSchoolLogo, readStoredSchoolLogo, writeStoredSchoolLogo } from '../utils/schoolLogoStore';

const AuthContext = createContext();

/** How often unpaid school admins check whether Paystack unlocked their plan. */
const PLAN_APPROVAL_POLL_MS = 15000;

export const useAuth = () => useContext(AuthContext);

export const isSchoolPaid = (school) => {
  if (!school) return false;
  if (school.plan_approved === true || school.plan_status === 'approved') return true;
  if (String(school.plan_status || '').toLowerCase() === 'rejected') return false;
  if (Number(school.total_paid) > 0) return true;
  if (school.last_payment_at || school.subscription_started_at) return true;
  if (!school.payment_plan) return false;
  return Boolean(school.plan_selected_at);
};

export const getPostAuthPath = (school) => {
  if (school?.role === 'super_admin') return '/super-admin';
  if (!isSchoolPaid(school)) return '/select-plan';
  return '/dashboard';
};

const isAuthRoute = (url = '') =>
  url.includes('/api/auth/login') ||
  url.includes('/api/auth/signup') ||
  url.includes('/api/auth/google') ||
  url.includes('/api/auth/verify-email') ||
  url.includes('/api/auth/resend-verification') ||
  url.includes('/api/auth/set-password') ||
  url.includes('/api/auth/complete-signup') ||
  url.includes('/api/auth/signup-charge');

const ACCESS_TOKEN_KEY = 'st_access';
const SESSION_FLAG_KEY = 'st_session';

const readAccessToken = () => {
  try {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const readSessionFlag = () => {
  try {
    return localStorage.getItem(SESSION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

const writeSessionFlag = (on) => {
  try {
    if (on) localStorage.setItem(SESSION_FLAG_KEY, '1');
    else localStorage.removeItem(SESSION_FLAG_KEY);
  } catch {
    // private mode
  }
};

const isPersistableLogo = (url) => {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:')) return false;
  return url.length < 2048;
};

const slimSchoolForStorage = (school) => {
  if (!school || typeof school !== 'object') return null;
  return {
    ...school,
    payment_records: [],
    logo_url: isPersistableLogo(school.logo_url) ? school.logo_url : null,
  };
};

const writeAccessToken = (value) => {
  try {
    if (value && value !== 'session') sessionStorage.setItem(ACCESS_TOKEN_KEY, value);
    else sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // private mode
  }
};

const applyAccessToken = (value) => {
  if (value && value !== 'session') {
    axios.defaults.headers.common.Authorization = `Bearer ${value}`;
    return;
  }
  delete axios.defaults.headers.common.Authorization;
};

const readCachedSchool = () => {
  try {
    const raw = localStorage.getItem('school');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isPersistableLogo(parsed.logo_url)) parsed.logo_url = null;
    parsed.payment_records = [];
    return parsed;
  } catch {
    localStorage.removeItem('school');
    return null;
  }
};

const schoolApprovalSnapshot = (school) =>
  [
    school?.payment_plan,
    school?.plan_status,
    school?.plan_approved,
    school?.subscription_active,
    school?.subscription_frozen,
    (school?.plan_features || []).join(','),
  ].join('|');

/** Prefer live verify data, but never wipe a known payment_plan with a partial payload. */
const mergeSchoolState = (incoming, previous) => {
  if (!incoming) return previous || null;
  if (!previous) {
    return {
      ...incoming,
      plan_approved: isSchoolPaid(incoming),
      plan_status: isSchoolPaid(incoming) ? 'approved' : incoming.plan_status || null,
    };
  }

  const merged =
    incoming.payment_plan || !previous.payment_plan
      ? { ...incoming }
      : {
          ...incoming,
          payment_plan: previous.payment_plan,
          plan_status: incoming.plan_status || previous.plan_status || null,
          plan_name: incoming.plan_name || previous.plan_name || null,
          plan_features:
            incoming.plan_features?.length > 0 ? incoming.plan_features : previous.plan_features || [],
          pending_plan_features:
            incoming.pending_plan_features?.length > 0
              ? incoming.pending_plan_features
              : previous.pending_plan_features || [],
          plan_price: incoming.plan_price ?? previous.plan_price ?? null,
          plan_selected_at: incoming.plan_selected_at || previous.plan_selected_at || null,
        };

  // Verify omits huge logos. Keep the image the school set at setup.
  if (!merged.logo_url && previous.logo_url) {
    merged.logo_url = previous.logo_url;
  }

  if (incoming.plan_status === 'rejected') {
    merged.plan_approved = false;
    merged.plan_status = 'rejected';
  } else if (isSchoolPaid(incoming) || isSchoolPaid(previous) || isSchoolPaid(merged)) {
    merged.plan_approved = true;
    merged.plan_status = 'approved';
  } else {
    const status = merged.plan_status || previous.plan_status || null;
    merged.plan_status = status;
    merged.plan_approved = status === 'approved';
  }

  // If server says approved, unlock features even when plan_features was empty in a stale payload.
  if (merged.plan_approved && !(merged.plan_features?.length > 0)) {
    merged.plan_features =
      incoming.pending_plan_features?.length > 0
        ? incoming.pending_plan_features
        : previous.pending_plan_features?.length > 0
          ? previous.pending_plan_features
          : previous.plan_features || [];
  }

  return merged;
};

const bootSchool = typeof window !== 'undefined' ? readCachedSchool() : null;
const bootAccess = typeof window !== 'undefined' ? readAccessToken() : '';
if (bootAccess) applyAccessToken(bootAccess);

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => bootAccess || (bootSchool ? 'session' : null));
  const [school, setSchool] = useState(() => bootSchool);
  const [loading, setLoading] = useState(() => !bootSchool && (Boolean(bootAccess) || readSessionFlag()));
  const schoolRef = useRef(bootSchool);

  const persistSchool = useCallback((schoolData, previous) => {
    const merged = mergeSchoolState(schoolData, previous === undefined ? schoolRef.current : previous);
    schoolRef.current = merged;
    setSchool(merged);
    if (!merged) return;
    writeSessionFlag(true);
    if (merged.logo_url) writeStoredSchoolLogo(merged.logo_url);
    const slim = slimSchoolForStorage(merged);
    try {
      localStorage.setItem('school', JSON.stringify(slim));
    } catch {
      try {
        localStorage.setItem('school', JSON.stringify({ ...slim, logo_url: null }));
      } catch {
        // ignore quota / private mode failures
      }
    }
  }, []);

  const clearSession = useCallback(() => {
    setToken(null);
    setSchool(null);
    schoolRef.current = null;
    writeAccessToken('');
    applyAccessToken('');
    writeSessionFlag(false);
    clearPersistedCache();
    clearStoredSchoolLogo();
    localStorage.removeItem('token');
    localStorage.removeItem('school');
    localStorage.removeItem('tokenExpiresAt');
  }, []);

  const storeSession = useCallback((newToken, schoolData, expiresInSec) => {
    persistSchool(schoolData);
    writeAccessToken(newToken);
    applyAccessToken(newToken);
    writeSessionFlag(true);
    setToken(newToken || 'session');
    localStorage.removeItem('token');
    localStorage.removeItem('tokenExpiresAt');
    void expiresInSec;
  }, [persistSchool]);

  useEffect(() => {
    const validateToken = async () => {
      const cachedSchool = schoolRef.current || readCachedSchool();
      const savedToken = readAccessToken();
      localStorage.removeItem('token');
      localStorage.removeItem('tokenExpiresAt');
      applyAccessToken(savedToken);

      const shouldVerify = Boolean(cachedSchool || savedToken || readSessionFlag());
      if (!shouldVerify) {
        setLoading(false);
        return;
      }

      if (cachedSchool) {
        schoolRef.current = cachedSchool;
        setSchool(cachedSchool);
        setToken(savedToken || 'session');
        setLoading(false);
      }

      try {
        const response = await axios.get('/api/auth/verify', { timeout: 8000, withCredentials: true });
        if (response.data?.school) {
          persistSchool(response.data.school, cachedSchool || schoolRef.current);
          setToken(savedToken || 'session');
          writeSessionFlag(true);
        } else if (!cachedSchool) {
          clearSession();
        }
      } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          clearSession();
        }
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, [clearSession, persistSchool]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;

    const restoreLogo = async () => {
      const stored = await readStoredSchoolLogo();
      if (cancelled) return;
      if (stored && !schoolRef.current?.logo_url) {
        persistSchool({ logo_url: stored });
      }
      if (schoolRef.current?.role === 'super_admin') return;
      try {
        const { data } = await axios.get('/api/school/branding', { timeout: 12000 });
        if (cancelled || !data?.logo_url) return;
        persistSchool({ logo_url: data.logo_url });
      } catch {
        // keep the stored setup image
      }
    };

    restoreLogo();
    return () => {
      cancelled = true;
    };
  }, [token, persistSchool]);

  useEffect(() => {
    const saved = readAccessToken();
    if (saved) applyAccessToken(saved);
  }, [token]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error.response?.status;
        const url = error.config?.url || '';
        // Don't logout on verify retries or transient API errors.
        if (status === 401 && !isAuthRoute(url) && !url.includes('/api/auth/verify')) {
          clearSession();
        }
        return Promise.reject(error);
      }
    );

    return () => axios.interceptors.response.eject(interceptor);
  }, [clearSession]);

  const signup = async (schoolName, email, _password = null, logo = null, paymentPlan = null, payment = {}) => {
    const response = await axios.post(
      '/api/auth/signup',
      {
        schoolName,
        email,
        logo,
        paymentPlan,
        privacyAccepted: true,
        method: payment.method,
        phone: payment.phone,
        provider: payment.provider,
      },
      { timeout: 20000 }
    );
    const { token: newToken, school: schoolData, expiresIn, requiresEmailVerification } = response.data;
    // Email-first signup never returns a session until password is set after verify.
    if (!requiresEmailVerification && newToken && schoolData) {
      storeSession(newToken, schoolData, expiresIn);
    }
    return response.data;
  };

  const storeSessionFromAuth = (data) => {
    if (!data?.token || !data?.school) return;
    storeSession(data.token, data.school, data.expiresIn);
  };

  const login = async (email, password, { remember = false } = {}) => {
    const response = await axios.post('/api/auth/login', { email, password, remember }, { timeout: 12000 });
    const { token: newToken, school: schoolData, expiresIn } = response.data || {};
    if (!newToken || !schoolData) {
      const err = new Error('Login response was invalid. The API may still be starting or misconfigured.');
      err.response = { data: { error: err.message } };
      throw err;
    }
    storeSession(newToken, schoolData, expiresIn);
    return response.data;
  };

  const loginWithGoogle = async ({
    accessToken,
    idToken,
    schoolName,
    logo,
    paymentPlan,
    privacyAccepted,
    method,
    phone,
    provider,
    remember,
  } = {}) => {
    const response = await axios.post(
      '/api/auth/google',
      {
        accessToken,
        idToken,
        schoolName,
        logo,
        paymentPlan,
        privacyAccepted: Boolean(privacyAccepted),
        method,
        phone,
        provider,
        remember: Boolean(remember),
      },
      { timeout: 20000 }
    );
    const data = response.data || {};
    if (data.requiresPayment || data.authorization_url || data.mode === 'checkout' || data.mode === 'momo') {
      return data;
    }
    const { token: newToken, school: schoolData, expiresIn } = data;
    if (!newToken || !schoolData) {
      const err = new Error('Google sign-in did not return a session.');
      err.response = { data: { error: err.message } };
      throw err;
    }
    storeSession(newToken, schoolData, expiresIn);
    return data;
  };

  const selectPlan = async (paymentPlan, payment = {}) => {
    const response = await axios.post(
      '/api/school/select-plan',
      {
        paymentPlan,
        method: payment.method,
        phone: payment.phone,
        provider: payment.provider,
      },
      { timeout: 20000 }
    );
    if (response.data?.school) persistSchool(response.data.school);
    return response.data;
  };

  const completePaidSignup = async (reference) => {
    const response = await axios.post('/api/auth/complete-signup', { reference }, { timeout: 45000 });
    const data = response.data || {};
    if (data.token && data.school) storeSession(data.token, data.school, data.expiresIn);
    return data;
  };

  const refreshSchool = useCallback(async () => {
    const response = await axios.get('/api/auth/verify', { timeout: 12000 });
    if (response.data.school) {
      persistSchool(response.data.school);
    }
    return response.data.school;
  }, []);

  // Keep school-admin UI in sync when a super admin approves (or revokes) without a page refresh.
  useEffect(() => {
    if (loading || !token) return;
    const current = schoolRef.current || school;
    if (!current || current.role === 'super_admin') return;
    if (!current.payment_plan || current.plan_approved) return;

    let cancelled = false;
    let inFlight = false;

    const pollApproval = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const response = await axios.get('/api/auth/verify', { timeout: 10000 });
        const next = response.data?.school;
        if (cancelled || !next) return;

        const prev = schoolRef.current;
        if (prev && schoolApprovalSnapshot(prev) === schoolApprovalSnapshot(next)) {
          return;
        }

        const wasApproved = prev?.plan_approved === true;
        persistSchool(next, prev);
        if (!wasApproved && next.plan_approved) {
          toast.success('Payment confirmed. All plan features are unlocked.');
        }
      } catch {
        // Ignore transient API errors while waiting for approval.
      } finally {
        inFlight = false;
      }
    };

    const intervalId = setInterval(pollApproval, PLAN_APPROVAL_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        pollApproval();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', pollApproval);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', pollApproval);
    };
  }, [loading, token, school?.role, school?.payment_plan, school?.plan_approved]);

  const logout = async ({ everywhere = false } = {}) => {
    try {
      await axios.post(everywhere ? '/api/auth/logout-all' : '/api/auth/logout', {}, { withCredentials: true });
    } catch {
      // Cookie/session may already be gone.
    }
    clearSession();
  };

  const isSuperAdmin = school?.role === 'super_admin';
  const isPlanApproved =
    isSuperAdmin || school?.plan_approved === true || school?.plan_status === 'approved';
  const isSubscriptionActive = isSuperAdmin || school?.subscription_active !== false;

  const includesPlanFeature = (featureKey) => {
    if (isSuperAdmin) return true;
    if (!featureKey) return false;
    // Prefer live API features, but fall back to the client plan definition so
    // newly added keys (e.g. bank-settings) still appear after a backend restart lag.
    if (school?.pending_plan_features?.includes(featureKey)) return true;
    return planHasFeature(school?.payment_plan, featureKey);
  };

  const hasFeature = (featureKey) => {
    if (isSuperAdmin) return true;
    if (!featureKey) return false;
    if (!isPlanApproved) return false;
    if (!isSubscriptionActive) return false;
    if (school?.plan_features?.includes(featureKey)) return true;
    return planHasFeature(school?.payment_plan, featureKey);
  };

  const hasMessaging = hasFeature('messages-sms') || hasFeature('messages-email');

  return (
    <AuthContext.Provider
      value={{
        token,
        school,
        isSuperAdmin,
        isPlanApproved,
        isSubscriptionActive,
        includesPlanFeature,
        hasFeature,
        hasMessaging,
        signup,
        storeSessionFromAuth,
        login,
        loginWithGoogle,
        selectPlan,
        completePaidSignup,
        refreshSchool,
        persistSchool,
        logout,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
