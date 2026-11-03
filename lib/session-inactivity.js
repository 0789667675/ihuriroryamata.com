/**
 * Session Inactivity Tracker
 *
 * Tracks meaningful user activity and automatically expires the Supabase
 * session after 48 consecutive hours without activity.
 *
 * Meaningful activity includes: page navigation, form submissions,
 * button clicks, report viewing, and other authenticated operations.
 * Background polling, automatic refreshes, and timer ticks do NOT reset
 * the inactivity period.
 *
 * After 48 hours without activity, the next authenticated API call will
 * cause a redirect to the login page.
 */

const INACTIVITY_TIMEOUT_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Get the last meaningful activity timestamp from localStorage.
 * Returns 0 if no timestamp is stored.
 */
function getLastActivityTime() {
  try {
    const stored = localStorage.getItem('lastMeaningfulActivity');
    if (!stored) return 0;
    return Number(stored);
  } catch {
    return 0;
  }
}

/**
 * Store the timestamp of a meaningful activity event.
 * This resets the inactivity timer.
 *
 * @param {number} timestamp - Optional explicit timestamp. Defaults to now.
 */
function setLastActivityTime(timestamp) {
  const time = timestamp || Date.now();
  try {
    localStorage.setItem('lastMeaningfulActivity', String(time));
  } catch {
    // localStorage may be unavailable in some environments (e.g., private mode)
  }
}

/**
 * Check if the session has expired due to inactivity.
 * Returns true if 48+ hours have passed since last meaningful activity.
 */
function isSessionExpired() {
  const lastActivity = getLastActivityTime();
  const now = Date.now();
  const elapsed = now - lastActivity;
  return elapsed >= INACTIVITY_TIMEOUT_MS;
}

/**
 * Reset the inactivity timer by recording the current time as the last
 * meaningful activity. This should be called whenever the user performs
 * a meaningful action in the application.
 */
function resetInactivityTimer() {
  setLastActivityTime();
}

/**
 * Check if the current user's session has expired due to inactivity.
 * If expired, clears the Supabase session and redirects to login.
 *
 * @param {object} options - Optional configuration
 * @param {boolean} options.autoRedirect - If true, redirect to login when expired (default true)
 * @param {Function} options.onExpired - Callback called before redirect when expired
 * @returns {boolean} True if the session is expired, false otherwise.
 */
function checkAndExpireSession({ autoRedirect = true, onExpired } = {}) {
  if (!isSessionExpired()) {
    return false;
  }

  // Clear the stored activity timestamp so repeated checks don't keep triggering
  try {
    localStorage.removeItem('lastMeaningfulActivity');
  } catch {}

  if (autoRedirect && typeof window !== 'undefined') {
    // Sign out from Supabase
    if (window.Supabase) {
      const supa = window.Supabase.getInstance();
      if (supa) {
        supa.auth.signOut();
      }
    }
    // Also clear the milk_session cookie
    document.cookie = 'milk_session=; Max-Age=0; path=/;';
    // Trigger the redirect
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = '/';
    }
  }

  if (typeof onExpired === 'function') {
    onExpired();
  }

  return true;
}

/**
 * Map of events that are considered "meaningful activity" and should
 * reset the inactivity timer. Background/automatic events should NOT
 * reset the timer.
 *
 * @typedef {Object} ActivityEvent
 * @property {string} type - The event type
 * @property {Event} event - The original DOM event
 */

/**
 * Handler for meaningful user interactions that reset the inactivity timer.
 * Call this from event handlers for UI interactions.
 *
 * @param {ActivityEvent} event - The event object
 */
function onMeaningfulActivity(event) {
  resetInactivityTimer();
}

/**
 * Browser/storage event listener that synchronizes logout state across tabs.
 * When one tab expires the session due to inactivity, other tabs are also
 * logged out when they next make an API call.
 */
function setupCrossTabSync() {
  if (typeof window === 'undefined') return;

  window.addEventListener('storage', (event) => {
    if (event.key === 'milk-session-expired') {
      // Another tab has expired the session. Force expiration in this tab too.
      // Clear the activity timestamp to trigger the check on next API call.
      try {
        localStorage.removeItem('lastMeaningfulActivity');
      } catch {}
    }
  });
}

/**
 * Initialize the inactivity tracker.
 * Should be called once on app startup.
 *
 * @param {object} options - Initialization options
 * @param {boolean} options.checkOnLoad - If true, check for expiration immediately (default true)
 * @param {Function} options.onExpire - Callback when session is expired and cleared
 */
function init({ checkOnLoad = true, onExpire } = {}) {
  // Set up cross-tab synchronization
  setupCrossTabSync();

  if (checkOnLoad && typeof window !== 'undefined') {
    // Check if session is expired due to inactivity
    if (isSessionExpired()) {
      // Clear the activity timestamp
      try {
        localStorage.removeItem('lastMeaningfulActivity');
      } catch {}

      // Sign out from Supabase
      if (window.Supabase) {
        const supa = window.Supabase.getInstance();
        if (supa) {
          supa.auth.signOut();
        }
      }
      // Clear the milk_session cookie
      document.cookie = 'milk_session=; Max-Age=0; path=/;';

      if (typeof onExpire === 'function') {
        onExpire();
      }

      // Redirect to login
      try {
        window.location.href = '/';
      } catch {}
    }
  }
}

/**
 * Check for session expiration without redirecting.
 * Returns true if the session is expired, false otherwise.
 * Meant to be called from API routes or component effects.
 */
function checkSessionExpiryNoRedirect() {
  return isSessionExpired();
}

module.exports = {
  INACTIVITY_TIMEOUT_MS,
  getLastActivityTime,
  setLastActivityTime,
  isSessionExpired,
  resetInactivityTimer,
  checkAndExpireSession,
  onMeaningfulActivity,
  init,
  checkSessionExpiryNoRedirect,
};