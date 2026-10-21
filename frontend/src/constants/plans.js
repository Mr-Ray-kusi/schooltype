const FULL_FEATURE_KEYS = [
  'dashboard',
  'students',
  'add-student',
  'staff',
  'non-staff',
  'attendance',
  'scanner',
  'messages-sms',
  'messages-email',
  'classes',
  'report-cards',
  'fees-paid',
  'fees-unpaid',
  'bank-settings',
  'school-wallet',
];

/** Shared feature bullets for every plan; only the student-capacity line changes. */
const SHARED_FEATURE_BULLETS = [
  'Dashboard overview & school stats',
  'Student registry with QR code IDs',
  'Staff profiles & role management',
  'Non-staff support team records',
  'Quick student enrollment form',
  'Daily attendance tracking & summaries',
  'QR code scanner check-in',
  'Attendance filters & print',
  'Dashboard attendance charts',
  'Bulk SMS & email messaging',
  'Class management & organization',
  'Report cards & teacher result uploads',
  'Fees tracking',
  'School wallet with Paystack bank & MoMo',
  'In-app notifications with platform admin',
];

const withStudentCapacity = (capacityLabel) => [...SHARED_FEATURE_BULLETS, capacityLabel];

export const PAYMENT_PLANS = {
  small: {
    id: 'small',
    name: 'Small School',
    sizeLabel: 'Up to 200 students',
    price: 10,
    period: 'year',
    description: 'Full SCHOOLTYPE suite for campuses with up to 200 students.',
    features: withStudentCapacity('Up to 200 students'),
    featureKeys: [...FULL_FEATURE_KEYS],
    limits: { maxStudents: 200, maxStaff: null, maxNonStaff: null },
    highlighted: false,
  },
  mid: {
    id: 'mid',
    name: 'Mid-sized School',
    sizeLabel: '200 – 1,000 students',
    price: 20,
    period: 'year',
    description: 'Full SCHOOLTYPE suite for growing schools with up to 1,000 students.',
    features: withStudentCapacity('Up to 1,000 students'),
    featureKeys: [...FULL_FEATURE_KEYS],
    limits: { maxStudents: 1000, maxStaff: null, maxNonStaff: null },
    highlighted: true,
  },
  large: {
    id: 'large',
    name: 'Large School',
    sizeLabel: '1,000+ students',
    price: 30,
    period: 'year',
    description: 'Full SCHOOLTYPE suite for large institutions with 1,000+ students.',
    features: withStudentCapacity('Unlimited students'),
    featureKeys: [...FULL_FEATURE_KEYS],
    limits: { maxStudents: null, maxStaff: null, maxNonStaff: null },
    highlighted: false,
  },
};

/** Legacy monthly plan IDs → yearly size tiers */
export const PLAN_ALIASES = {
  basic: 'small',
  standard: 'mid',
  premium: 'large',
  starter: 'small',
  professional: 'mid',
  enterprise: 'large',
};

export const PLAN_LIST = Object.values(PAYMENT_PLANS);

export const resolvePlanId = (planId) => {
  if (!planId) return null;
  if (PAYMENT_PLANS[planId]) return planId;
  return PLAN_ALIASES[planId] || planId;
};

export const getPlan = (planId) => {
  const resolved = resolvePlanId(planId);
  return PAYMENT_PLANS[resolved] || null;
};

export const hasFeature = (planId, featureKey) => {
  const plan = getPlan(planId);
  return plan ? plan.featureKeys.includes(featureKey) : false;
};

export const formatPlanPriceGhs = (plan) => {
  if (!plan) return '';
  return `₵${Number(plan.price || 0).toLocaleString()}`;
};

export const formatPlanPriceUsd = (plan) => {
  if (!plan) return '';
  if (plan.priceUsdMin != null && plan.priceUsdMax != null) {
    return `$${plan.priceUsdMin.toLocaleString()} – $${plan.priceUsdMax.toLocaleString()}${
      plan.id === 'large' ? '+' : ''
    }`;
  }
  return '';
};

export const FEATURE_LABELS = {
  dashboard: 'Dashboard',
  students: 'Students',
  'add-student': 'Add Student',
  staff: 'Staff',
  'non-staff': 'Non-Staff',
  attendance: 'Attendance',
  scanner: 'Scanner',
  'messages-sms': 'Bulk SMS',
  'messages-email': 'Bulk Email',
  classes: 'Classes',
  'report-cards': 'Report Cards',
  'fees-paid': 'Fees',
  'fees-unpaid': 'Fees',
  'bank-settings': 'Bank Settings',
  'school-wallet': 'School Wallet',
};

export const ROUTE_FEATURE_MAP = {
  '/dashboard': 'dashboard',
  '/students': 'students',
  '/alumni': 'students',
  '/staff': 'staff',
  '/non-staff': 'non-staff',
  '/attendance': 'attendance',
  '/scanner': 'scanner',
  '/add-student': 'add-student',
  '/classes': 'classes',
  '/messages': 'messages-sms',
  '/report-cards': 'report-cards',
  '/fees-paid': 'fees-paid',
  '/fees-unpaid': 'fees-unpaid',
  '/bank-settings': 'bank-settings',
  '/school-wallet': 'school-wallet',
};

export const SYSTEM_CAPABILITY_GROUPS = [
  {
    title: 'People Management',
    items: ['Student registry & QR codes', 'Staff & teacher profiles', 'Non-staff records', 'Enrollment forms'],
  },
  {
    title: 'Attendance',
    items: ['Daily check-in scanner', 'Attendance logs & filters', 'Summary charts & export'],
  },
  {
    title: 'Communication',
    items: ['Bulk SMS to parents & staff', 'Email broadcasts', 'In-app school notifications', 'Fee payment reminders'],
  },
  {
    title: 'Academics & Finance',
    items: ['Class organization', 'Report cards & teacher uploads', 'Fees tracking', 'School wallet & MoMo/bank payouts'],
  },
];

export const hasMessagingAccess = (planFeatures = []) =>
  planFeatures.includes('messages-sms') || planFeatures.includes('messages-email');
