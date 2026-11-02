let enabled = false;

export function enableSharedRuntime() {
  enabled = true;
}

export function isSharedRuntimeEnabled() {
  return enabled;
}
