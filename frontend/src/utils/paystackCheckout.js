let loadPromise;

function loadPaystackPop() {
  if (typeof window !== 'undefined' && window.PaystackPop) {
    return Promise.resolve(window.PaystackPop);
  }
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v2/inline.js';
    script.async = true;
    script.onload = () => {
      if (window.PaystackPop) resolve(window.PaystackPop);
      else reject(new Error('Paystack checkout failed to load.'));
    };
    script.onerror = () => reject(new Error('Paystack checkout failed to load.'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export async function openPaystackCheckout({ access_code, authorization_url, reference }) {
  const completeUrl = reference
    ? `/signup/complete?reference=${encodeURIComponent(reference)}`
    : '/signup/complete';

  if (access_code) {
    try {
      const PaystackPop = await loadPaystackPop();
      const popup = new PaystackPop();
      popup.resumeTransaction(access_code, {
        onSuccess: (tranx) => {
          const ref = tranx?.reference || reference;
          window.location.assign(
            ref ? `/signup/complete?reference=${encodeURIComponent(ref)}` : completeUrl
          );
        },
      });
      return true;
    } catch {
      // Fall through to the hosted Paystack page.
    }
  }

  if (authorization_url) {
    window.location.assign(authorization_url);
    return true;
  }

  return false;
}
