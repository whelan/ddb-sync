/**
 * Logger - Debug-gated console wrapper
 * log() only fires when the 'debugMode' setting is enabled, keeping the
 * console clean during normal play. warn() and error() always fire.
 */
export class Logger {
  static _cache = null;

  static get _debug() {
    if (this._cache === null) {
      try { this._cache = game?.settings?.get('ddb-sync', 'debugMode') ?? false; }
      catch { this._cache = false; }
    }
    return this._cache;
  }

  static invalidateCache() { this._cache = null; }

  static log(...args) { if (this._debug) console.log(...args); }
  static warn(...args) { console.warn(...args); }
  static error(...args) { console.error(...args); }
}
