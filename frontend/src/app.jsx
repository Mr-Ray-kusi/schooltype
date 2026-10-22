import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Layout from './components/layout';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, useAuth, isSchoolPaid } from './contexts/authcontext';
import { lazyWithRetry } from './utils/lazyWithRetry';

const Home = lazyWithRetry(() => import('./pages/home'));
const Login = lazyWithRetry(() => import('./pages/login'));
const Signup = lazyWithRetry(() => import('./pages/sigup'));
const VerifyEmail = lazyWithRetry(() => import('./pages/verify-email'));
const Privacy = lazyWithRetry(() => import('./pages/privacy'));
const Plans = lazyWithRetry(() => import('./pages/plans'));
const SelectPlan = lazyWithRetry(() => import('./pages/select-plan'));
const SignupComplete = lazyWithRetry(() => import('./pages/signup-complete'));
const MobileScanner = lazyWithRetry(() => import('./pages/mobile-scanner'));
const StudentPublicId = lazyWithRetry(() => import('./pages/student-public-id'));
const FeesPay = lazyWithRetry(() => import('./pages/fees-pay'));
const FeesReceipt = lazyWithRetry(() => import('./pages/fees-receipt'));
const StaffPortal = lazyWithRetry(() => import('./pages/staff-portal'));

const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const Students = lazyWithRetry(() => import('./pages/students'));
const Staff = lazyWithRetry(() => import('./pages/staffs'));
const Attendance = lazyWithRetry(() => import('./pages/attendance'));
const Messages = lazyWithRetry(() => import('./pages/message'));
const Scanner = lazyWithRetry(() => import('./pages/scanner'));
const AddStudent = lazyWithRetry(() => import('./pages/addstudends'));
const Classes = lazyWithRetry(() => import('./pages/classes'));
const ReportCards = lazyWithRetry(() => import('./pages/report-cards'));
const FeesPaid = lazyWithRetry(() => import('./pages/fees-paid'));
const FeesUnpaid = lazyWithRetry(() => import('./pages/fees-unpaid'));
const BankSettings = lazyWithRetry(() => import('./pages/bank-settings'));
const SchoolWallet = lazyWithRetry(() => import('./pages/school-wallet'));
const SuperAdmin = lazyWithRetry(() => import('./pages/super-admin'));
const SuperAdminSchool = lazyWithRetry(() => import('./pages/super-admin-school'));
const SuperAdminBroadcast = lazyWithRetry(() => import('./pages/super-admin-broadcast'));
const SuperAdminSms = lazyWithRetry(() => import('./pages/super-admin-sms'));
const SuperAdminAnalytics = lazyWithRetry(() => import('./pages/super-admin-analytics'));
const Notifications = lazyWithRetry(() => import('./pages/notifications'));
const Alumni = lazyWithRetry(() => import('./pages/alumni'));

const PAGE_PRELOADERS = [
  [/^\/$/, () => import('./pages/home')],
  [/^\/login$/, () => import('./pages/login')],
  [/^\/dashboard/, () => import('./pages/Dashboard')],
  [/^\/students/, () => import('./pages/students')],
  [/^\/staff/, () => import('./pages/staffs')],
  [/^\/attendance/, () => import('./pages/attendance')],
  [/^\/classes/, () => import('./pages/classes')],
  [/^\/messages/, () => import('./pages/message')],
  [/^\/super-admin/, () => import('./pages/super-admin')],
];

if (typeof window !== 'undefined') {
  const path = window.location.pathname || '/';
  const match = PAGE_PRELOADERS.find(([pattern]) => pattern.test(path));
  match?.[1]();
}

const LoadingScreen = () => (
  <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-300">Loading...</div>
);

const SchoolAdminRoute = () => {
  const { token, school, loading } = useAuth();

  if (school && token) {
    if (school?.role === 'super_admin') return <Navigate to="/super-admin" />;
    if (!isSchoolPaid(school)) return <Navigate to="/select-plan" />;
    return <Outlet />;
  }
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" />;
  if (!school) return <LoadingScreen />;
  if (school?.role === 'super_admin') return <Navigate to="/super-admin" />;
  if (!isSchoolPaid(school)) return <Navigate to="/select-plan" />;
  return <Outlet />;
};

const PlanFeatureRoute = ({ feature, features }) => {
  const { hasFeature, includesPlanFeature } = useAuth();
  const featureKeys = features || (feature ? [feature] : []);

  if (featureKeys.length && !featureKeys.some((key) => includesPlanFeature(key))) {
    return <Navigate to="/dashboard" />;
  }
  if (featureKeys.length && !featureKeys.some((key) => hasFeature(key))) {
    return <Navigate to="/dashboard" />;
  }
  return <Outlet />;
};

const SuperAdminRoute = () => {
  const { token, school, loading } = useAuth();

  if (school && token) {
    if (school?.role !== 'super_admin') return <Navigate to="/dashboard" />;
    return <Outlet />;
  }
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" />;
  if (!school) return <LoadingScreen />;
  if (school?.role !== 'super_admin') return <Navigate to="/dashboard" />;
  return <Outlet />;
};

const FinanceRoute = ({ feature }) => {
  const { token, school, loading, isSuperAdmin, hasFeature, includesPlanFeature } = useAuth();

  if (token && (isSuperAdmin || school?.role === 'super_admin')) return <Outlet />;
  if (school && token) {
    if (!isSchoolPaid(school)) return <Navigate to="/select-plan" />;
    if (feature && !includesPlanFeature(feature)) return <Navigate to="/dashboard" />;
    if (feature && !hasFeature(feature)) return <Navigate to="/dashboard" />;
    return <Outlet />;
  }
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" />;
  if (isSuperAdmin || school?.role === 'super_admin') return <Outlet />;
  if (!school) return <LoadingScreen />;
  if (!isSchoolPaid(school)) return <Navigate to="/select-plan" />;
  if (feature && !includesPlanFeature(feature)) return <Navigate to="/dashboard" />;
  if (feature && !hasFeature(feature)) return <Navigate to="/dashboard" />;
  return <Outlet />;
};

const SelectPlanRoute = ({ children }) => {
  const { token, school, loading } = useAuth();

  if (school && token) {
    if (school?.role === 'super_admin') return <Navigate to="/super-admin" />;
    if (isSchoolPaid(school)) return <Navigate to="/dashboard" />;
    return children;
  }
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" />;
  if (!school) return <LoadingScreen />;
  if (school?.role === 'super_admin') return <Navigate to="/super-admin" />;
  if (isSchoolPaid(school)) return <Navigate to="/dashboard" />;
  return children;
};

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/plans" element={<Plans />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/signup/complete" element={<SignupComplete />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/id/:barcode" element={<StudentPublicId />} />
              <Route path="/fees" element={<FeesPay />} />
              <Route path="/pay/receipt" element={<FeesReceipt />} />
              <Route path="/pay/:barcode" element={<FeesPay />} />
              <Route path="/scan/:token" element={<MobileScanner />} />
              <Route path="/staff-portal/:token" element={<StaffPortal />} />
              <Route path="/:schoolSlug/staff-portal" element={<StaffPortal />} />
              <Route
                path="/select-plan"
                element={
                  <SelectPlanRoute>
                    <SelectPlan />
                  </SelectPlanRoute>
                }
              />

              <Route element={<SchoolAdminRoute />}>
                <Route element={<Layout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route element={<PlanFeatureRoute feature="students" />}>
                    <Route path="/students" element={<Students />} />
                    <Route path="/alumni" element={<Alumni />} />
                  </Route>
                  <Route element={<PlanFeatureRoute features={['staff', 'non-staff']} />}>
                    <Route path="/staff" element={<Staff />} />
                    <Route path="/non-staff" element={<Navigate to="/staff" replace />} />
                  </Route>
                  <Route element={<PlanFeatureRoute feature="attendance" />}>
                    <Route path="/attendance" element={<Attendance />} />
                  </Route>
                  <Route element={<PlanFeatureRoute feature="classes" />}>
                    <Route path="/classes" element={<Classes />} />
                  </Route>
                  <Route element={<PlanFeatureRoute feature="report-cards" />}>
                    <Route path="/report-cards" element={<ReportCards />} />
                  </Route>
                  <Route element={<PlanFeatureRoute features={['fees-paid', 'fees-unpaid']} />}>
                    <Route path="/fees-paid" element={<FeesPaid />} />
                    <Route path="/fees-unpaid" element={<FeesUnpaid />} />
                  </Route>
                  <Route element={<PlanFeatureRoute features={['messages-sms', 'messages-email']} />}>
                    <Route path="/messages" element={<Messages />} />
                  </Route>
                  <Route element={<PlanFeatureRoute feature="scanner" />}>
                    <Route path="/scanner" element={<Scanner />} />
                  </Route>
                  <Route element={<PlanFeatureRoute feature="add-student" />}>
                    <Route path="/add-student" element={<AddStudent />} />
                  </Route>
                </Route>
              </Route>

              <Route element={<FinanceRoute feature="bank-settings" />}>
                <Route element={<Layout />}>
                  <Route path="/bank-settings" element={<BankSettings />} />
                </Route>
              </Route>
              <Route element={<FinanceRoute feature="school-wallet" />}>
                <Route element={<Layout />}>
                  <Route path="/school-wallet" element={<SchoolWallet />} />
                </Route>
              </Route>

              <Route element={<SuperAdminRoute />}>
                <Route element={<Layout />}>
                  <Route path="/super-admin" element={<SuperAdmin />} />
                  <Route path="/super-admin/schools/:schoolId" element={<SuperAdminSchool />} />
                  <Route path="/super-admin/bank-settings" element={<BankSettings />} />
                  <Route path="/super-admin/platform-wallet" element={<SchoolWallet />} />
                  <Route path="/super-admin/email-schools" element={<SuperAdminBroadcast />} />
                  <Route path="/super-admin/notifications" element={<Notifications />} />
                  <Route path="/super-admin/sms" element={<SuperAdminSms />} />
                  <Route path="/super-admin/analytics" element={<SuperAdminAnalytics />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
