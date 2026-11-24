import type { Clock } from '../../../shared/kernel/clock.js';
import type {
  IdentityMaintenanceApi,
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

  purgeExpiredOtpCodes(): Promise<number> {
    const cutoff = this.cutoff(this.settings.otpRetentionDays * DAY_MS);
    return drain(() => this.retention.deleteOtpCodesExpiredBefore(cutoff, BATCH_SIZE));
  }

  purgeEndedSessions(): Promise<number> {
    const cutoff = this.cutoff(this.settings.sessionRetentionDays * DAY_MS);
    return drain(() => this.retention.deleteSessionsEndedBefore(cutoff, BATCH_SIZE));
  }

  purgeRateLimitWindows(): Promise<number> {
    const cutoff = this.cutoff(this.settings.rateLimitRetentionSeconds * 1000);
    return drain(() => this.retention.deleteRateLimitWindowsBefore(cutoff, BATCH_SIZE));
  }

  private cutoff(retentionMs: number): Date {
    return new Date(this.clock.now().getTime() - retentionMs);
  }
}
