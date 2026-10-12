/**
 * Open Paystack's hosted checkout page.
 * Ghana MoMo PIN / USSD prompts do not reliably reach the phone inside the
 * inline popup (PaystackPop), so always leave this site for checkout.paystack.com.
 */
export function openPaystackCheckout({ access_code, authorization_url }) {
  const hosted =
    authorization_url ||
    (access_code ? `https://checkout.paystack.com/${encodeURIComponent(access_code)}` : '');
  if (!hosted) return false;
  window.location.assign(hosted);
  return true;
}
