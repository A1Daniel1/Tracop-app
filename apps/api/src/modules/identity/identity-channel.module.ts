import { Module } from '@nestjs/common';
import { APP_CLOCK, APP_ENVIRONMENT, OUTBOX_WRITER } from '../../shared/infra/tokens.js';
import { IdentityChannelService } from './application/identity-channel-service.js';
import { DrizzleChannelLinkRepository } from './adapters/out/drizzle-repositories.js';
import { IdentityDataModule } from './identity-data.module.js';
import {
  CHANNEL_LINK_REPOSITORY,
  IDENTITY_CHANNEL_APPLICATION,
  IDENTITY_NOTIFICATION_DIRECTORY,
  USER_REPOSITORY,
} from './ports/tokens.js';

@Module({
  imports: [IdentityDataModule],
  providers: [
    DrizzleChannelLinkRepository,
    { provide: CHANNEL_LINK_REPOSITORY, useExisting: DrizzleChannelLinkRepository },
    {
      provide: IDENTITY_CHANNEL_APPLICATION,
      inject: [APP_ENVIRONMENT, USER_REPOSITORY, CHANNEL_LINK_REPOSITORY, APP_CLOCK, OUTBOX_WRITER],
      useFactory: (...dependencies: ConstructorParameters<typeof IdentityChannelService>) =>
        new IdentityChannelService(...dependencies),
    },
    { provide: IDENTITY_NOTIFICATION_DIRECTORY, useExisting: IDENTITY_CHANNEL_APPLICATION },
  ],
  exports: [IDENTITY_CHANNEL_APPLICATION, IDENTITY_NOTIFICATION_DIRECTORY],
})
export class IdentityChannelModule {}
