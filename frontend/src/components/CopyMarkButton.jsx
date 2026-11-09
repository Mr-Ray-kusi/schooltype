import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to execCommand */
    }
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(input);
  }
};

const CopyMarkButton = ({
  value,
  label = 'value',
  className = 'shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white',
  iconClassName = 'h-4 w-4',
  onError,
}) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setCopied(false);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [value]);

  const handleCopy = async () => {
    const text = String(value || '');
    if (!text) return;
    try {
      const ok = await copyText(text);
      if (!ok) throw new Error('copy failed');
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      onError?.(error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${className} ${copied ? 'text-emerald-400 hover:text-emerald-300' : ''}`}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
    >
      {copied ? <Check className={iconClassName} /> : <Copy className={iconClassName} />}
    </button>
  );
};

export default CopyMarkButton;
