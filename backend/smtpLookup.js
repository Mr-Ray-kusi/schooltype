import dns from 'node:dns';

const PUBLIC_DNS = ['8.8.8.8', '1.1.1.1'];

export function isTransientSmtpError(error) {
  const text = [error?.code, error?.errno, error?.message].filter(Boolean).join(' ');
  return /ENOTFOUND|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|EPIPE/i.test(
    String(text)
  );
}

/**
 * Resolve SMTP hosts over IPv4, then Google/Cloudflare DNS if the OS resolver is down.
 * Nodemailer calls this with the same signature as dns.lookup.
 */
export function smtpLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const finish = typeof callback === 'function' ? callback : () => {};
  const query = { family: 4, hints: options?.hints, all: false };

  dns.lookup(hostname, query, (error, address, family) => {
    if (!error && address) {
      finish(null, address, family || 4);
      return;
    }

    const resolver = new dns.Resolver();
    resolver.setServers(PUBLIC_DNS);
    resolver.resolve4(hostname, (fallbackError, addresses) => {
      if (fallbackError || !addresses?.[0]) {
        finish(error || fallbackError);
        return;
      }
      finish(null, addresses[0], 4);
    });
  });
}
