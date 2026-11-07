import { AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '../contexts/authcontext';

const SubscriptionBanner = () => {
  const { school, isPlanApproved, isSubscriptionReadOnly } = useAuth();

  if (!school?.payment_plan || !isPlanApproved) {
    return null;
  }

  const isFrozen = school.subscription_frozen || school.subscription_status === 'frozen';
  if (!isFrozen && !isSubscriptionReadOnly) {
    return null;
  }

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
            {isFrozen ? 'Account frozen' : 'Term plan ended — view only'}
          </h3>
          <p className="text-sm text-slate-200 mt-1">
            {isFrozen
              ? 'The platform has frozen this school. Features stay locked until the subscription is restored.'
              : 'This term has ended. You can view records and record school fees. Adding results, setup changes, audits/publishing, downloads, wallet load/withdraw, and staff payments stay locked until you renew.'}
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
              Term ended: {new Date(school.next_payment_due).toLocaleDateString()}
              {school.last_payment_at && (
                <> · Term started: {new Date(school.last_payment_at).toLocaleDateString()}</>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionBanner;
