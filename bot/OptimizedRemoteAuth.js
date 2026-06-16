// bot/OptimizedRemoteAuth.js
import pkg from 'whatsapp-web.js';
import path from 'path';
import fsPromises from 'fs/promises';

const { RemoteAuth } = pkg;

export class OptimizedRemoteAuth extends RemoteAuth {
  constructor(options = {}) {
    super(options);
  }

  /**
   * Override copyByRequiredDirs — skip locked / heavy browser-cache folders
   * so the ZIP is small and fast to upload.
   */
  async copyByRequiredDirs(from, to) {
    for (const d of this.requiredDirs) {
      const src = path.join(from, d);
      if (!(await this.isValidPath(src))) continue;
      const dest = path.join(to, path.basename(src));
      await fsPromises
        .cp(src, dest, {
          recursive: true,
          force: true,
          errorOnExist: false,
          filter: (srcPath) => {
            const name = path.basename(srcPath);
            if (['LOCK', 'LOG', 'LOG.old'].includes(name)) return false;
            const lp = srcPath.toLowerCase();
            return !(
              lp.includes('cache') ||
              lp.includes('service worker') ||
              lp.includes('blob_storage') ||
              lp.includes('gpucache') ||
              lp.includes('crashpad') ||
              lp.includes('network')
            );
          },
        })
        .catch((err) =>
          console.warn(`[OptimizedRemoteAuth] Non-fatal copy warning for ${d}:`, err.message)
        );
    }
  }

  /**
   * Override extractRemoteSession — skip cleanly when no MongoDB record exists
   * (fresh install, never saved yet).  Do NOT delete anything.
   */
  async extractRemoteSession() {
    try {
      const exists = await this.store.sessionExists({ session: this.sessionName });
      if (!exists) {
        console.log('[OptimizedRemoteAuth] No saved session found — starting fresh.');
        return;
      }
      await super.extractRemoteSession();
    } catch (err) {
      console.warn('[OptimizedRemoteAuth] Session extract skipped:', err.message);
    }
  }

  /**
   * Override storeRemoteSession.
   * FIX B3: guard against missing userDataDir; copy ZIP to CWD root first
   * to work around the wwebjs-mongo hardcoded path bug.
   */
  async storeRemoteSession() {
    // Guard: dir must exist and be non-empty before we try to compress
    const pathExists = await this.isValidPath(this.userDataDir);
    if (!pathExists) {
      console.warn('[OptimizedRemoteAuth] userDataDir not ready — skipping save.');
      return;
    }

    const rootZipPath = `${this.sessionName}.zip`;
    let compressedSessionPath;
    try {
      compressedSessionPath = await this.compressSession();

      // wwebjs-mongo always reads from CWD/<session>.zip
      if (path.resolve(compressedSessionPath) !== path.resolve(rootZipPath)) {
        await fsPromises.copyFile(compressedSessionPath, rootZipPath);
      }

      console.log('[OptimizedRemoteAuth] Uploading session to MongoDB…');
      await this.store.save({ session: this.sessionName });
      console.log('[OptimizedRemoteAuth] Session saved ✓');
    } catch (err) {
      console.error('[OptimizedRemoteAuth] Error saving session:', err);
      throw err; // re-throw so saveSessionSafe() can retry
    } finally {
      const toRemove = [
        this.tempDir,
        rootZipPath,
        ...(compressedSessionPath ? [compressedSessionPath] : []),
      ];
      await Promise.allSettled(
        toRemove.map((p) =>
          fsPromises
            .rm(p, { recursive: true, force: true, maxRetries: this.rmMaxRetries })
            .catch(() => {})
        )
      );
    }
  }
}
