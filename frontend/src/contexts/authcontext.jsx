import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { hasFeature as planHasFeature } from '../constants/plans';

const AuthContext = createContext();

/** How often unpaid school admins check whether Paystack unlocked their plan. */
const PLAN_APPROVAL_POLL_MS = 15000;

export const useAuth = () => useContext(AuthContext);

export const isSchoolPaid = (school) =>
  school?.plan_approved === true || school?.plan_status === 'approved';

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
  url.includes('/api/auth/complete-signup');

const readCachedSchool = () => {
  try {
    const raw = localStorage.getItem('school');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
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
      plan_approved:
        incoming.plan_approved === true || incoming.plan_status === 'approved',
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

  // Keep a prior logo if verify omitted a huge base64 payload.
  if (!merged.logo_url && previous.logo_url) {
    merged.logo_url = previous.logo_url;
  }

  const status = merged.plan_status || previous.plan_status || null;
  merged.plan_status = status;
  if (incoming.plan_status != null) {
    merged.plan_approved = incoming.plan_status === 'approved';
  } else {
    merged.plan_approved =
      incoming.plan_approved === true ||
      previous.plan_approved === true ||
      status === 'approved';
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

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [school, setSchool] = useState(null);
  const [loading, setLoading] = useState(true);
  const schoolRef = useRef(null);

  const persistSchool = (schoolData, previous = schoolRef.current) => {
    const merged = mergeSchoolState(schoolData, previous);
    schoolRef.current = merged;
    setSchool(merged);
    try {
      if (merged) {
        localStorage.setItem('school', JSON.stringify(merged));
      }
    } catch {
      // ignore quota / private mode failures
    }
  };

  const clearSession = useCallback(() => {
    setToken(null);
    setSchool(null);
    schoolRef.current = null;
    localStorage.removeItem('token');
    localStorage.removeItem('school');
    localStorage.removeItem('tokenExpiresAt');
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  const storeSession = useCallback((newToken, schoolData, expiresInSec) => {
    setToken(newToken);
    persistSchool(schoolData);
    localStorage.setItem('token', newToken);
    if (expiresInSec) {
      localStorage.setItem('tokenExpiresAt', String(Date.now() + expiresInSec * 1000));
    } else {
      localStorage.removeItem('tokenExpiresAt');
    }
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
  }, []);

  useEffect(() => {
    const validateToken = async () => {
      const storedToken = localStorage.getItem('token');
      const expiresAt = localStorage.getItem('tokenExpiresAt');
      const cachedSchool = readCachedSchool();

      if (storedToken && expiresAt && Date.now() > Number(expiresAt)) {
        clearSession();
        setLoading(false);
        return;
      }

      if (!storedToken) {
        setLoading(false);
        return;
      }

      // Restore immediately so a refresh does not bounce to login while the API wakes.
      axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
      setToken(storedToken);
      if (cachedSchool) {
        schoolRef.current = cachedSchool;
        setSchool(cachedSchool);
        // Unblock the UI now — verify continues in the background.
        setLoading(false);
      }

      try {
        const response = await axios.get('/api/auth/verify', { timeout: 12000 });
        if (response.data?.school) {
          persistSchool(response.data.school, cachedSchool || schoolRef.current);
        } else if (!cachedSchool) {
          // Token accepted but no school payload and nothing cached.
          clearSession();
        }
      } catch (error) {
        const status = error.response?.status;
        // Only force logout on real auth failures — not cold starts / network blips.
        if (status === 401 || status === 403) {
          clearSession();
        }
        // Keep cached school on transient failures so refresh does not bounce to /select-plan.
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, [clearSession]);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
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

  const signup = async (schoolName, email, _password = null, logo = null, paymentPlan = null) => {
    const response = await axios.post(
      '/api/auth/signup',
      {
        schoolName,
        email,
        logo,
        paymentPlan,
        privacyAccepted: true,
      },
      { timeout: 45000 }
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

  const login = async (email, password) => {
    const response = await axios.post('/api/auth/login', { email, password });
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
      },
      { timeout: 45000 }
    );
    const data = response.data || {};
    if (data.requiresPayment || data.authorization_url || data.access_code || data.mode === 'checkout') {
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

  const selectPlan = async (paymentPlan) => {
    const response = await axios.post('/api/school/select-plan', { paymentPlan }, { timeout: 45000 });
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

  const logout = () => {
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
        logout,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
