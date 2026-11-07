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
  'Dashboard overview and school stats',
  'Student registry with QR code IDs',
  'Staff profiles and role management',
  'Non-staff support team records',
  'Quick student enrollment form',
  'Daily attendance tracking and summaries',
  'QR code scanner check-in',
  'Attendance filters and print',
  'Dashboard attendance charts',
  'Bulk SMS and email messaging',
  'Class management and organization',
  'Report cards and teacher result uploads',
  'Fees tracking',
  'School wallet with Paystack bank and MoMo',
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
    highlighted: false,
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
    highlighted: true,
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
    highlighted: false,
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
  return `₵${Number(plan.termPrice || plan.price || 0).toLocaleString()}`;
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
  // Paid and unpaid fees share one page now; schools saved before the merge still store this key.
  'fees-unpaid': 'Fees',
  'bank-settings': 'Bank Settings',
  'school-wallet': 'School Wallet',
  payments: 'Payments',
};

/**
 * Feature chips for a school, by label. Schools saved before paid and unpaid fees
 * merged still store both keys, which would otherwise show "Fees" twice.
 */
export const planFeatureLabels = (features = []) => {
  const seen = new Set();
  return features.reduce((labels, feature) => {
    const label = FEATURE_LABELS[feature] || String(feature).replace(/-/g, ' ');
    if (!seen.has(label)) {
      seen.add(label);
      labels.push({ key: feature, label });
    }
    return labels;
  }, []);
};

