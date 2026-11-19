import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureHttp } from '../src/bootstrap/http.js';

@Module({})
class EmptyCorsModule {}

describe('API CORS policy', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(EmptyCorsModule, { bodyParser: false });
    configureHttp(app, 256 * 1024, ['https://app.example.test']);
    const express = app.getHttpAdapter().getInstance();
    express.get(
      '/catalog/products',
      (_request: unknown, response: { json: (body: unknown) => void }) => response.json([]),
    );
    express.post(
      '/webhooks/telegram',
      (_request: unknown, response: { sendStatus: (status: number) => void }) =>
        response.sendStatus(200),
    );
    await app.init();
  });

  afterAll(async () => app.close());

  it('adds the configured headers for an allowed origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/catalog/products')
      .set('Origin', 'https://app.example.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers['access-control-expose-headers']).toBe('Retry-After');
  });

  it('does not return ACAO for a disallowed origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/catalog/products')
      .set('Origin', 'https://evil.example.test');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not apply CORS to the Telegram webhook', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/telegram')
      .set('Origin', 'https://app.example.test');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
