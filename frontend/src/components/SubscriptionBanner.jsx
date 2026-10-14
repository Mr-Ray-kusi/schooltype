import { AlertTriangle, Lock, Clock } from 'lucide-react';
import { useAuth } from '../contexts/authcontext';

const SubscriptionBanner = () => {
  const { school, isPlanApproved, isSubscriptionActive } = useAuth();

  if (!school?.payment_plan || !isPlanApproved) {
    return null;
  }

  if (isSubscriptionActive) {
    if (school.subscription_in_grace) {
      return (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 mb-6">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-white">Plan is about to lapse</h3>
              <p className="text-sm text-slate-200 mt-1">
                Your plan was due on{' '}
                {school.next_payment_due
                  ? new Date(school.next_payment_due).toLocaleDateString()
                  : '—'}
                . You still have {school.subscription_grace_days || 5} days. Use Pay now to renew so nothing locks.
              </p>
              <a
                href="/select-plan"
                className="mt-3 inline-flex text-sm font-semibold text-amber-200 underline-offset-2 hover:underline"
              >
                Renew plan
              </a>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  const isFrozen = school.subscription_frozen || school.subscription_status === 'frozen';

  return (
    <div className={`rounded-xl border p-5 mb-6 ${isFrozen ? 'border-red-500/40 bg-red-500/10' : 'border-orange-500/40 bg-orange-500/10'}`}>
      <div className="flex items-start gap-3">
        {isFrozen ? (
          <Lock className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" />
        )}
        <div>
          <h3 className="font-semibold text-white">
            {isFrozen ? 'Account frozen' : 'Plan ended — renew to keep working'}
          </h3>
          <p className="text-sm text-slate-200 mt-1">
            {isFrozen
              ? 'The platform has frozen this school. Features stay locked until the subscription is restored.'
              : `Your plan ended ${school.subscription_days_past_due || 0} days ago. Use Pay now to renew. The rest of this screen stays visible so you can still read records.`}
          </p>
          {!isFrozen ? (
            <a
              href="/select-plan"
              className="mt-3 inline-flex text-sm font-semibold text-orange-200 underline-offset-2 hover:underline"
            >
              Renew plan
            </a>
          ) : null}
          {school.next_payment_due && (
            <p className="text-xs text-slate-300 mt-2">
              Period ended: {new Date(school.next_payment_due).toLocaleDateString()}
              {school.last_payment_at && (
                <> · Period started: {new Date(school.last_payment_at).toLocaleDateString()}</>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionBanner;
