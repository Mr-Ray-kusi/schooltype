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
  },
};

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
  'fees-unpaid': 'Fees',
  'bank-settings': 'Bank Settings',
  'school-wallet': 'School Wallet',
};
