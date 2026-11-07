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
  'bank-settings',
  'school-wallet',
  'payments',
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
  'Staff and non-staff salary payments',
  'In-app notifications with platform admin',
];

const withStudentCapacity = (capacityLabel) => [...SHARED_FEATURE_BULLETS, capacityLabel];

/** Three Ghana terms per year, so a billed term lasts four months. */
export const PLAN_TERM_MONTHS = 4;

export const PAYMENT_PLANS = {
  small: {
    id: 'small',
    name: 'Starter',
    sizeLabel: 'Up to 300 students',
    termPrice: 1500,
    price: 1500,
    period: 'term',
    freeFirstTerm: true,
    pitch: 'A term subscription for schools with up to 300 students. The full workspace is included, and the first term is free.',
    description: 'A term subscription for schools with up to 300 students. The full workspace is included, and the first term is free.',
    features: withStudentCapacity('Up to 300 students'),
    featureKeys: [...FULL_FEATURE_KEYS],
    limits: { maxStudents: 300, maxStaff: null, maxNonStaff: null },
  },
  mid: {
    id: 'mid',
    name: 'Growth',
    sizeLabel: '301 to 1,000 students',
    termPrice: 2500,
    price: 2500,
    period: 'term',
    freeFirstTerm: false,
    pitch: 'A term subscription for schools with 301 to 1,000 students, including wallet and salary payments.',
    description: 'A term subscription for schools with 301 to 1,000 students, including wallet and salary payments.',
    features: withStudentCapacity('301 to 1,000 students'),
    featureKeys: [...FULL_FEATURE_KEYS],
    limits: { maxStudents: 1000, maxStaff: null, maxNonStaff: null },
  },
  large: {
    id: 'large',
    name: 'Unlimited',
    sizeLabel: '1,000+ students',
    termPrice: 3500,
    price: 3500,
    period: 'term',
    freeFirstTerm: false,
    pitch: 'A term subscription for schools with 1,000 or more students, with no student cap.',
    description: 'A term subscription for schools with 1,000 or more students, with no student cap.',
    features: withStudentCapacity('1,000+ students'),
    featureKeys: [...FULL_FEATURE_KEYS],
    limits: { maxStudents: null, maxStaff: null, maxNonStaff: null },
  },
};

export function resolveBillingInterval() {
  return 'term';
}

export function getPlanCharge(plan) {
  return {
    amount: Number(plan?.termPrice || plan?.price || 0),
    interval: 'term',
    months: PLAN_TERM_MONTHS,
  };
}

export const PLAN_ALIASES = {
  basic: 'small',
  standard: 'mid',
  premium: 'large',
  starter: 'small',
  professional: 'mid',
  enterprise: 'large',
};

export const resolvePlanId = (planId) => {
  if (!planId) return null;
  if (PAYMENT_PLANS[planId]) return planId;
  return PLAN_ALIASES[planId] || planId;
};

export const VALID_PLAN_IDS = [
  ...Object.keys(PAYMENT_PLANS),
  ...Object.keys(PLAN_ALIASES),
];

export const getPlan = (planId) => {
  const resolved = resolvePlanId(planId);
  return PAYMENT_PLANS[resolved] || null;
};

export const getPlanFeatures = (planId) => {
  const plan = getPlan(planId);
  return plan ? plan.featureKeys : [];
};

export const hasPlanFeature = (planId, featureKey) => {
  if (!planId) return false;
  return getPlanFeatures(planId).includes(featureKey);
};

export const getPlansList = () =>
  Object.keys(PAYMENT_PLANS).map((id) => {
    const { featureKeys, ...publicPlan } = PAYMENT_PLANS[id];
    return publicPlan;
  });

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
  // Paid and unpaid fees share one page now; schools saved before the merge still store this key.
  'fees-unpaid': 'Fees',
  'bank-settings': 'Bank Settings',
  'school-wallet': 'School Wallet',
  payments: 'Payments',
};
