const HARD_MOMO_DECLINE =
  /insufficient|invalid (number|phone|mobile|account)|not registered|do not honor|incorrect pin|wrong pin|limit exceeded|blocked|unregistered/i;

export function isHardMomoDecline(text) {
  return HARD_MOMO_DECLINE.test(String(text || ''));
}

export function isTerminalMomoStatus(data) {
  const status = String(data?.status || '').toLowerCase();
  if (status === 'cancelled') return true;
  if (status !== 'failed' && status !== 'timeout') return false;
  return isHardMomoDecline(data?.display_text || data?.gateway_response);
}
