function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info(...args) {
    console.log(`[${timestamp()}] INFO:`, ...args);
  },
  error(...args) {
    console.error(`[${timestamp()}] ERROR:`, ...args);
  },
  warn(...args) {
    console.warn(`[${timestamp()}] WARN:`, ...args);
  },
};
