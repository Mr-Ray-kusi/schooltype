import { fromMinorUnits, toMinorUnits } from './paystack.js';
import {
  getWallet,
  ensureWallet,
  transferBetweenWallets,
} from './schoolWalletStore.js';
import {
  getSmsSettings,
  setSmsUnitPrice,
  buildSmsQuote,
  listSmsSales,
  makeSmsSaleReference,
  getSchoolSmsBalance,
  ensureSchoolSmsBalance,
  creditSchoolSmsPurchase,
  consumeSchoolAndPlatformUnits,
  refundSchoolAndPlatformUnits,
  recordProviderStockPurchase,
} from './platformSmsStore.js';
import { resolveSmsRecipients, getSmsProviderStatus, fetchTwilioAccountBalance } from './smsProvider.js';

export async function findPlatformSchoolId(supabase) {
  if (process.env.PLATFORM_WALLET_SCHOOL_ID) {
    return process.env.PLATFORM_WALLET_SCHOOL_ID;
  }

  const { data: byRole } = await supabase
    .from('schools')
    .select('id, email, role')
    .eq('role', 'super_admin')
    .limit(1)
    .maybeSingle();

  if (byRole?.id) return byRole.id;

  const email = (
    process.env.DEV_SUPER_ADMIN_EMAIL ||
    process.env.SUPER_ADMIN_EMAIL ||
    'superadmin@school.com'
  )
    .trim()
    .toLowerCase();

  const { data: byEmail } = await supabase
    .from('schools')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  return byEmail?.id || null;
}

function formatSmsSettings(settings) {
  return {
    ...settings,
    unit_price_major: fromMinorUnits(settings.unit_price_minor),
    total_revenue_major: fromMinorUnits(settings.total_revenue_minor),
  };
}

async function getSchoolName(supabase, schoolId) {
  const { data } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
  return data?.name || null;
}

export function registerSmsBillingRoutes(app, {
  authenticateToken,
  enforcePlanApproval,
  requireSuperAdmin,
  supabase,
}) {
  app.get('/api/super-admin/sms', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const settings = await getSmsSettings();
      const sales = await listSmsSales({ limit: 50 });
      const platformSchoolId = await findPlatformSchoolId(supabase);
      let wallet = null;
      if (platformSchoolId) {
        await ensureWallet(platformSchoolId);
        wallet = await getWallet(platformSchoolId);
      }
      const twilioBalance = await fetchTwilioAccountBalance();

      res.json({
        settings: formatSmsSettings(settings),
        sales: sales.map((s) => ({
          ...s,
          amount_major: fromMinorUnits(s.amount_minor),
        })),
        platform_wallet: wallet
          ? {
              ...wallet,
              available_balance_major: fromMinorUnits(wallet.available_balance),
            }
          : null,
        provider: getSmsProviderStatus(),
        twilio_balance: twilioBalance,
      });
    } catch (err) {
      console.error('Get platform SMS error:', err);
      res.status(500).json({ error: 'Failed to load SMS settings' });
    }
  });

  app.patch('/api/super-admin/sms/price', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const major = Number(req.body?.unit_price);
      if (!Number.isFinite(major) || major <= 0) {
        return res.status(400).json({ error: 'unit_price must be a positive GHS amount (e.g. 0.05)' });
      }
      const settings = await setSmsUnitPrice(Math.round(major * 100));
      res.json({ settings: formatSmsSettings(settings) });
    } catch (err) {
      console.error('Set SMS price error:', err);
      res.status(500).json({ error: 'Failed to update SMS unit price' });
    }
  });

  app.post('/api/super-admin/sms/units', authenticateToken, requireSuperAdmin, async (req, res) => {
    return res.status(410).json({
      error:
        'Free SMS units are disabled. Record a Twilio purchase with the invoice reference and the amount paid to Twilio.',
      code: 'PROVIDER_PURCHASE_REQUIRED',
    });
  });

  app.post('/api/super-admin/sms/provider-stock', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const provider = getSmsProviderStatus();
      if (provider.mode === 'dry_run') {
        return res.status(400).json({
          error: 'Turn off SMS_DRY_RUN before loading paid Twilio units.',
        });
      }
      if (!provider.ready || provider.mode !== 'live') {
        return res.status(400).json({
          error: 'Twilio must be configured with live keys before you can load purchased units.',
        });
      }

      const units = Math.round(Number(req.body?.units) || 0);
      const amountPaid = Number(req.body?.amount_paid);
      if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
        return res.status(400).json({ error: 'Enter the amount paid to Twilio for this purchase' });
      }
      const providerReference = String(req.body?.provider_reference || '').trim();
      const platformSchoolId = await findPlatformSchoolId(supabase);

      const settings = await recordProviderStockPurchase({
        platformSchoolId,
        units,
        amountMinor: toMinorUnits(amountPaid),
        providerReference,
      });
      res.json({ settings: formatSmsSettings(settings) });
    } catch (err) {
      console.error('Record Twilio SMS stock error:', err);
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Failed to load purchased SMS units' });
    }
  });

  app.get('/api/sms/balance', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const settings = await getSmsSettings();
      await ensureWallet(req.user.schoolId);
      await ensureSchoolSmsBalance(req.user.schoolId);
      const wallet = await getWallet(req.user.schoolId);
      const smsBalance = await getSchoolSmsBalance(req.user.schoolId);

      res.json({
        sms_units: smsBalance.units_available,
        unit_price_minor: settings.unit_price_minor,
        unit_price_major: fromMinorUnits(settings.unit_price_minor),
        platform_units_available: settings.units_available,
        wallet: {
          available_balance: wallet.available_balance,
          available_balance_major: fromMinorUnits(wallet.available_balance),
        },
        provider: getSmsProviderStatus(),
      });
    } catch (err) {
      console.error('SMS balance error:', err);
      res.status(500).json({ error: 'Failed to load SMS balance' });
    }
  });

  app.post('/api/sms/purchase', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const units = Math.round(Number(req.body?.units) || 0);
      if (units < 1) {
        return res.status(400).json({ error: 'Enter how many SMS units to buy (at least 1)' });
      }

      const settings = await getSmsSettings();
      const platformSchoolId = await findPlatformSchoolId(supabase);
      if (!platformSchoolId) {
        return res.status(400).json({ error: 'Platform wallet is not configured' });
      }
      if (platformSchoolId === req.user.schoolId) {
        return res.status(400).json({ error: 'Use the platform SMS page to load inventory units' });
      }

      const amountMinor = units * settings.unit_price_minor;
      await ensureWallet(req.user.schoolId);
      await ensureWallet(platformSchoolId);

      const reference = makeSmsSaleReference('smsbuy');
      const schoolName = await getSchoolName(supabase, req.user.schoolId);

      await transferBetweenWallets({
        fromSchoolId: req.user.schoolId,
        toSchoolId: platformSchoolId,
        amountMinor,
        reference,
        description: `Buy ${units} SMS units`,
        metadata: { kind: 'sms_unit_purchase', units },
      });

      const result = await creditSchoolSmsPurchase({
        schoolId: req.user.schoolId,
        schoolName,
        units,
        amountMinor,
        reference,
      });

      res.json({
        units_purchased: units,
        amount_minor: amountMinor,
        amount_major: fromMinorUnits(amountMinor),
        sms_units: result.school_balance.units_available,
        reference,
      });
    } catch (err) {
      console.error('SMS purchase error:', err);
      const status = err.status || 500;
      res.status(status).json({ error: err.message || 'Failed to buy SMS units' });
    }
  });

  app.post('/api/sms/quote', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const { message, sendMode, recipients, recipientPhone } = req.body || {};
      if (!String(message || '').trim()) {
        return res.status(400).json({ error: 'Message is required to calculate SMS cost' });
      }

      const phones = await resolveSmsRecipients(supabase, req.user.schoolId, {
        sendMode,
        recipients,
        recipientPhone,
      });

      if (!phones.length) {
        return res.status(400).json({
          error:
            'No valid phone numbers found. For group SMS, students need a parent phone. Teachers/Staff SMS is not available yet — use Parents or Individual.',
          code: 'SMS_NO_RECIPIENTS',
        });
      }

      const settings = await getSmsSettings();
      const quote = buildSmsQuote({
        message,
        recipientCount: phones.length,
        unitPriceMinor: settings.unit_price_minor,
      });

      await ensureSchoolSmsBalance(req.user.schoolId);
      const schoolSms = await getSchoolSmsBalance(req.user.schoolId);
      await ensureWallet(req.user.schoolId);
      const wallet = await getWallet(req.user.schoolId);

      const schoolHasUnits = schoolSms.units_available >= quote.units_required;
      const platformHasUnits = settings.units_available >= quote.units_required;
      const provider = getSmsProviderStatus();

      res.json({
        quote: {
          ...quote,
          amount_major: fromMinorUnits(quote.amount_minor),
          unit_price_major: fromMinorUnits(quote.unit_price_minor),
        },
        school_sms_units: schoolSms.units_available,
        school_wallet: {
          available_balance: wallet.available_balance,
          available_balance_major: fromMinorUnits(wallet.available_balance),
        },
        platform: {
          units_available: settings.units_available,
        },
        school_has_units: schoolHasUnits,
        platform_has_units: platformHasUnits,
        provider_ready: provider.ready,
        provider,
        can_send: schoolHasUnits && platformHasUnits && provider.ready,
        blockers: [
          !schoolHasUnits
            ? `Not enough school SMS units. Need ${quote.units_required}, you have ${schoolSms.units_available}. Convert wallet money to SMS units first.`
            : null,
          !platformHasUnits
            ? `Platform SMS units are low. Need ${quote.units_required}, available ${settings.units_available}. Contact super admin.`
            : null,
          !provider.ready ? provider.message : null,
        ].filter(Boolean),
      });
    } catch (err) {
      console.error('SMS quote error:', err);
      res.status(500).json({ error: 'Failed to calculate SMS cost' });
    }
  });
}

/**
 * Consume prepaid school units + platform inventory for resolvable phones only.
 */
export async function settleSmsPayment({
  supabase,
  schoolId,
  schoolName,
  message,
  sendMode,
  recipients,
  recipientPhone,
  phones: phonesOverride,
}) {
  const phones =
    phonesOverride ||
    (await resolveSmsRecipients(supabase, schoolId, {
      sendMode,
      recipients,
      recipientPhone,
    }));

  const recipientCount = phones.length;

  if (recipientCount < 1) {
    const err = new Error(
      'No valid SMS recipients found. Add parent phone numbers on student records, or send to an Individual number.'
    );
    err.status = 400;
    err.code = 'SMS_NO_RECIPIENTS';
    throw err;
  }

  const provider = getSmsProviderStatus();
  if (!provider.ready) {
    const err = new Error(provider.message);
    err.status = 503;
    err.code = 'SMS_PROVIDER_NOT_CONFIGURED';
    throw err;
  }

  const settings = await getSmsSettings();
  const quote = buildSmsQuote({
    message,
    recipientCount,
    unitPriceMinor: settings.unit_price_minor,
  });

  const reference = makeSmsSaleReference('smsuse');
  const result = await consumeSchoolAndPlatformUnits({
    schoolId,
    schoolName,
    units: quote.units_required,
    recipientsCount: quote.recipients_count,
    segments: quote.segments,
    reference,
    messagePreview: message,
  });

  return {
    reference,
    phones,
    quote: {
      ...quote,
      amount_major: fromMinorUnits(quote.amount_minor),
      unit_price_major: fromMinorUnits(quote.unit_price_minor),
    },
    school_sms_units: result.school_balance.units_available,
    settings: formatSmsSettings(result.settings),
  };
}

export async function quoteSmsForPhones({ schoolId, message, phones }) {
  const recipientCount = Array.isArray(phones) ? phones.length : 0;
  if (recipientCount < 1) {
    const err = new Error(
      'No owing parents have a valid phone number and student payment link.'
    );
    err.status = 400;
    err.code = 'SMS_NO_RECIPIENTS';
    throw err;
  }

  const settings = await getSmsSettings();
  const quote = buildSmsQuote({
    message,
    recipientCount,
    unitPriceMinor: settings.unit_price_minor,
  });

  await ensureSchoolSmsBalance(schoolId);
  const schoolSms = await getSchoolSmsBalance(schoolId);
  await ensureWallet(schoolId);
  const wallet = await getWallet(schoolId);
  const provider = getSmsProviderStatus();
  const schoolHasUnits = schoolSms.units_available >= quote.units_required;
  const platformHasUnits = settings.units_available >= quote.units_required;

  return {
    quote: {
      ...quote,
      amount_major: fromMinorUnits(quote.amount_minor),
      unit_price_major: fromMinorUnits(quote.unit_price_minor),
    },
    recipients: recipientCount,
    school_sms_units: schoolSms.units_available,
    school_wallet: {
      available_balance: wallet.available_balance,
      available_balance_major: fromMinorUnits(wallet.available_balance),
    },
    platform: {
      units_available: settings.units_available,
    },
    school_has_units: schoolHasUnits,
    platform_has_units: platformHasUnits,
    provider_ready: provider.ready,
    provider,
    can_send: schoolHasUnits && platformHasUnits && provider.ready,
    blockers: [
      !schoolHasUnits
        ? `Not enough school SMS units. Need ${quote.units_required}, you have ${schoolSms.units_available}. Convert wallet money to SMS units first.`
        : null,
      !platformHasUnits
        ? `Platform SMS units are low. Need ${quote.units_required}, available ${settings.units_available}. Contact super admin.`
        : null,
      !provider.ready ? provider.message : null,
    ].filter(Boolean),
  };
}

export { refundSchoolAndPlatformUnits, resolveSmsRecipients };
