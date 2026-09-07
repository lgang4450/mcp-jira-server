import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  DEFAULT_JIRA_AUTH_FORWARD_HEADER,
  JiraClient,
  buildJiraRequestHeaders,
} from '../build/jira-client.js';

const baseConfig = {
  baseUrl: 'https://jira.example.com',
  personalAccessToken: 'jira-pat',
};

test('uses the Jira PAT as the Authorization bearer token by default', () => {
  const headers = buildJiraRequestHeaders(baseConfig);

  assert.equal(headers.Authorization, 'Bearer jira-pat');
  assert.equal(headers[DEFAULT_JIRA_AUTH_FORWARD_HEADER], undefined);
});

test('uses Basic Auth for the proxy and forwards the Jira PAT in a separate header', () => {
  const headers = buildJiraRequestHeaders({
    ...baseConfig,
    proxyBasicAuthUsername: 'proxy-user',
    proxyBasicAuthPassword: 'proxy-password',
  });

  assert.equal(
    headers.Authorization,
    `Basic ${Buffer.from('proxy-user:proxy-password').toString('base64')}`,
  );
  assert.equal(headers[DEFAULT_JIRA_AUTH_FORWARD_HEADER], 'Bearer jira-pat');
});

test('supports a custom Jira PAT forwarding header', () => {
  const headers = buildJiraRequestHeaders({
    ...baseConfig,
    proxyBasicAuthUsername: 'proxy-user',
    proxyBasicAuthPassword: 'proxy-password',
    jiraAuthForwardHeader: 'X-Internal-Jira-Auth',
  });

  assert.equal(headers['X-Internal-Jira-Auth'], 'Bearer jira-pat');
});

test('sends both proxy Basic Auth and the forwarded Jira PAT on Jira requests', async (t) => {
  let receivedHeaders;
  const server = createServer((request, response) => {
    receivedHeaders = request.headers;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"name":"test-user"}');
  });
  t.after(() => server.close());

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');

  const client = new JiraClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    personalAccessToken: 'jira-pat',
    proxyBasicAuthUsername: 'proxy-user',
    proxyBasicAuthPassword: 'proxy-password',
  });

  await client.getCurrentUser();

  assert.equal(
    receivedHeaders.authorization,
    `Basic ${Buffer.from('proxy-user:proxy-password').toString('base64')}`,
  );
  assert.equal(receivedHeaders['x-jira-authorization'], 'Bearer jira-pat');
});

test('rejects incomplete proxy credentials', () => {
  assert.throws(
    () => buildJiraRequestHeaders({
      ...baseConfig,
      proxyBasicAuthUsername: 'proxy-user',
    }),
    /requires both/,
  );
});

test('rejects Authorization as the PAT forwarding header', () => {
  assert.throws(
    () => buildJiraRequestHeaders({
      ...baseConfig,
      proxyBasicAuthUsername: 'proxy-user',
      proxyBasicAuthPassword: 'proxy-password',
      jiraAuthForwardHeader: 'Authorization',
    }),
    /must differ from Authorization/,
  );
});
