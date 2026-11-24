import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../shared/infra/database.js';
import type { IdentityRetentionRepository } from '../../ports/identity-ports.js';

const rowCount = (result: unknown): number =>
  Number((result as { rowCount?: number | null }).rowCount ?? 0);

@Injectable()
export class DrizzleIdentityRetentionRepository implements IdentityRetentionRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async deleteOtpCodesExpiredBefore(cutoff: Date, limit: number): Promise<number> {
    return rowCount(
      await this.database.current().execute(sql`
        DELETE FROM identity.otp_codes
        WHERE id IN (
          SELECT id FROM identity.otp_codes WHERE expires_at < ${cutoff} LIMIT ${limit}
        )`),
    );
  }

  async deleteSessionsEndedBefore(cutoff: Date, limit: number): Promise<number> {
    return rowCount(
      await this.database.current().execute(sql`
        DELETE FROM identity.sessions
        WHERE id IN (
          SELECT id FROM identity.sessions
          WHERE expires_at < ${cutoff} OR revoked_at < ${cutoff}
          LIMIT ${limit}
        )`),
    );
  }

  async deleteRateLimitWindowsBefore(cutoff: Date, limit: number): Promise<number> {
    return rowCount(
      await this.database.current().execute(sql`
        DELETE FROM identity.rate_limit_counters
        WHERE key_hash IN (
          SELECT key_hash FROM identity.rate_limit_counters
          WHERE window_start < ${cutoff}
          LIMIT ${limit}
        )`),
    );
  }
}
