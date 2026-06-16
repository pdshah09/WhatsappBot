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
                        
                        // Exclude leveldb lock and logs that are locked or regenerated on restart
                        if (name === 'LOCK' || name === 'LOG' || name === 'LOG.old') {
                            return false;
                        }

                        // Exclude heavy browser cache folders (not needed for authentication state)
                        const lowercasePath = srcPath.toLowerCase();
                        if (
                            lowercasePath.includes('cache') || 
                            lowercasePath.includes('service worker') || 
                            lowercasePath.includes('blob_storage') || 
                            lowercasePath.includes('gpucache') ||
                            lowercasePath.includes('crashpad') ||
                            lowercasePath.includes('network')
                        ) {
                            return false;
                        }

                        return true;
                    }
                }).catch(err => {
                    console.warn(`[OptimizedRemoteAuth] Non-fatal session copy warning for ${d}:`, err.message);
                });
            }
        }
    }

    /**
     * Override storeRemoteSession to copy the compressed ZIP to root CWD before saving,
     * addressing the wwebjs-mongo hardcoded zip location bug.
     */
    async storeRemoteSession(options) {
        const pathExists = await this.isValidPath(this.userDataDir);
        if (!pathExists) return;

        let compressedSessionPath;
        const rootZipPath = `${this.sessionName}.zip`; // Path expected by wwebjs-mongo
        try {
            compressedSessionPath = await this.compressSession();
            
            // If the zip file is not in root directory, copy it there so wwebjs-mongo can find it
            if (path.resolve(compressedSessionPath) !== path.resolve(rootZipPath)) {
                await fsPromises.copyFile(compressedSessionPath, rootZipPath);
            }

            console.log(`[OptimizedRemoteAuth] Saving optimized session backup to MongoDB...`);
            await this.store.save({
                session: this.sessionName,
            });
            console.log(`[OptimizedRemoteAuth] Session backup saved successfully.`);

            if (options && options.emit) {
                this.client.emit('remote_session_saved');
            }
        } catch (err) {
            console.error(`[OptimizedRemoteAuth] Error saving remote session:`, err);
        } finally {
            // Clean up temporary folders and root zip file
            const paths = [
                this.tempDir,
                rootZipPath,
                ...(compressedSessionPath ? [compressedSessionPath] : []),
            ];
            await Promise.allSettled(
                paths.map((p) =>
                    fsPromises.rm(p, {
                        recursive: true,
                        force: true,
                        maxRetries: this.rmMaxRetries,
                    }).catch(() => {})
                )
            );
        }
    }
}
