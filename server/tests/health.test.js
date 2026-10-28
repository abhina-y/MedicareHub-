import request from 'supertest';
import app from '../src/app.js';

describe('API baseline', () => {
  test('exposes a health endpoint without requiring authentication', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'MediCare Hub API' });
  });

  test('does not expose unknown routes', async () => {
    const response = await request(app).get('/api/not-a-real-route');
    expect(response.status).toBe(404);
  });
});
