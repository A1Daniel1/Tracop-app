import type { Clock } from '../../../shared/kernel/clock.js';
import type {
  IdentityMaintenanceApi,
  IdentityPurgeResult,
  IdentityRetentionRepository,
} from '../ports/identity-ports.js';

export interface IdentityRetentionSettings {
  /** PROVISIONAL: days an expired OTP code is kept before deletion. */
  readonly otpRetentionDays: number;
  /** PROVISIONAL: days an expired or revoked session is kept before deletion. */
  readonly sessionRetentionDays: number;
  /** Seconds a rate-limit window is kept; at least the longest configured window. */
  readonly rateLimitRetentionSeconds: number;
}

const DAY_MS = 86_400_000;
const BATCH_SIZE = 1000;
const MAX_BATCHES = 100;

/** Deletes in bounded batches so a large backlog never holds long locks. */
const drain = async (deleteBatch: () => Promise<number>): Promise<number> => {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const deleted = await deleteBatch();
    total += deleted;
    if (deleted < BATCH_SIZE) break;
  }
  return total;
};

export class IdentityMaintenanceService implements IdentityMaintenanceApi {
  constructor(
    private readonly retention: IdentityRetentionRepository,
    private readonly clock: Clock,
    private readonly settings: IdentityRetentionSettings,
  ) {}

  async purgeExpired(): Promise<IdentityPurgeResult> {
    const now = this.clock.now().getTime();
    const otpCutoff = new Date(now - this.settings.otpRetentionDays * DAY_MS);
    const sessionCutoff = new Date(now - this.settings.sessionRetentionDays * DAY_MS);
    const rateLimitCutoff = new Date(now - this.settings.rateLimitRetentionSeconds * 1000);
    return {
      otpCodes: await drain(() =>
        this.retention.deleteOtpCodesExpiredBefore(otpCutoff, BATCH_SIZE),
      ),
      sessions: await drain(() =>
        this.retention.deleteSessionsEndedBefore(sessionCutoff, BATCH_SIZE),
      ),
      rateLimitWindows: await drain(() =>
        this.retention.deleteRateLimitWindowsBefore(rateLimitCutoff, BATCH_SIZE),
      ),
    };
  }
}
