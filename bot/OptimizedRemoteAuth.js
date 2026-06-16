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
   * Override copyByRequiredDirs to filter out locked files and heavy browser cache folders
   */
  async copyByRequiredDirs(from, to) {
    for (const d of this.requiredDirs) {
      const src = path.join(from, d);
      if (await this.isValidPath(src)) {
        const dest = path.join(to, path.basename(src));
        await fsPromises.cp(src, dest, {
          recursive: true,
          force: true,
          errorOnExist: false,
          filter: (srcPath) => {
            const name = path.basename(srcPath);
            if (name === 'LOCK' || name === 'LOG' || name === 'LOG.old') return false;
            const lp = srcPath.toLowerCase();
            if (
              lp.includes('cache') ||
              lp.includes('service worker') ||
              lp.includes('blob_storage') ||
              lp.includes('gpucache') ||
              lp.includes('crashpad') ||
              lp.includes('network')
            ) return false;
            return true;
          },
        }).catch(err => {
          console.warn(`[OptimizedRemoteAuth] Non-fatal copy warning for ${d}:`, err.message);
        });
      }
    }
  }

  /**
   * Override extractRemoteSession — skip if no MongoDB session exists.
   * Do NOT delete the MongoDB record if local dir is missing:
   * on a fresh start .wwebjs_auth won't exist yet, that's normal —
   * super.extractRemoteSession() will recreate it from MongoDB.
   */
  async extractRemoteSession() {
    try {
      const sessionExists = await this.store.sessionExists({ session: this.sessionName });
      if (!sessionExists) return;
      await super.extractRemoteSession();
    } catch (err) {
      console.warn('[OptimizedRemoteAuth] Session extract skipped:', err.message);
    }
  }

  /**
   * Override storeRemoteSession to copy the compressed ZIP to root CWD before saving,
   * addressing the wwebjs-mongo hardcoded zip location bug.
   */
  async storeRemoteSession() {
    const pathExists = await this.isValidPath(this.userDataDir);
    if (!pathExists) return;

    let compressedSessionPath;
    const rootZipPath = `${this.sessionName}.zip`;
    try {
      compressedSessionPath = await this.compressSession();
      if (path.resolve(compressedSessionPath) !== path.resolve(rootZipPath)) {
        await fsPromises.copyFile(compressedSessionPath, rootZipPath);
      }
      console.log('[OptimizedRemoteAuth] Saving session backup to MongoDB...');
      await this.store.save({ session: this.sessionName });
      console.log('[OptimizedRemoteAuth] Session backup saved successfully.');
    } catch (err) {
      console.error('[OptimizedRemoteAuth] Error saving session:', err);
    } finally {
      const paths = [
        this.tempDir,
        rootZipPath,
        ...(compressedSessionPath ? [compressedSessionPath] : []),
      ];
      await Promise.allSettled(
        paths.map((p) =>
          fsPromises.rm(p, { recursive: true, force: true, maxRetries: this.rmMaxRetries }).catch(() => {})
        )
      );
    }
  }
}
