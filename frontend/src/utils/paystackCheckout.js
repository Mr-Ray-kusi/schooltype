/**
 * Leave Schoolotype for Paystack's hosted page.
 * Ghana MoMo PIN / USSD is not sent from the inline popup (PaystackPop).
 */
export function openPaystackCheckout({ authorization_url }) {
  if (!authorization_url) return false;
  window.location.replace(authorization_url);
  return true;
}
