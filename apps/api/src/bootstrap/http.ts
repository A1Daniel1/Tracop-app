import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { newRequestContext, runWithRequestContext } from '../shared/infra/request-context.js';

export const WEBHOOK_BODY_LIMIT = '64kb';

export const configureHttp = (
  app: INestApplication,
  syncPushBodyLimitBytes = 256 * 1024,
  allowedCorsOrigins: readonly string[] = [],
): void => {
  const expressApp = app as NestExpressApplication;
  // Every request gets a context (request id, client IP honoring TRUST_PROXY) for the audit log.
  expressApp.use((request: Request, _response: Response, next: NextFunction) => {
    runWithRequestContext(newRequestContext(request.ip), next);
  });
  expressApp.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path === '/webhooks/telegram') {
      next();
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin === 'string' && allowedCorsOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
      response.setHeader('Access-Control-Expose-Headers', 'Retry-After');
      response.setHeader('Access-Control-Max-Age', '600');
      if (request.method === 'OPTIONS') {
        response.status(204).end();
        return;
      }
    }
    next();
  });
  expressApp.useBodyParser('json', {
    limit: WEBHOOK_BODY_LIMIT,
    type: (request: { readonly path: string }) => request.path !== '/sync/push',
  });
  expressApp.useBodyParser('json', {
    limit: syncPushBodyLimitBytes,
    type: (request: { readonly path: string }) => request.path === '/sync/push',
  });
};
