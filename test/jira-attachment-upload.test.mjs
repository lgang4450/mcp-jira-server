import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { JiraClient } from '../build/jira-client.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  return address.port;
}

test('uploads an attachment using the Jira multipart endpoint', async (t) => {
  let receivedRequest;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      receivedRequest = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify([{
        id: '10001',
        filename: 'report.txt',
        size: 17,
        mimeType: 'text/plain',
      }]));
    });
  });
  t.after(() => server.close());

  const port = await listen(server);
  const client = new JiraClient({
    baseUrl: `http://127.0.0.1:${port}`,
    personalAccessToken: 'jira-pat',
  });

  const result = await client.uploadAttachment({
    issueKey: 'test-123',
    filename: 'report.txt',
    content: Buffer.from('attachment body\n'),
    mimeType: 'text/plain',
  });

  assert.equal(receivedRequest.method, 'POST');
  assert.equal(receivedRequest.url, '/rest/api/2/issue/TEST-123/attachments');
  assert.equal(receivedRequest.headers.authorization, 'Bearer jira-pat');
  assert.equal(receivedRequest.headers['x-atlassian-token'], 'no-check');
  assert.match(receivedRequest.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(receivedRequest.body, /name="file"; filename="report\.txt"/);
  assert.match(receivedRequest.body, /Content-Type: text\/plain/);
  assert.match(receivedRequest.body, /attachment body/);
  assert.equal(result[0].id, '10001');
});

test('rejects unsafe attachment filenames before sending a request', async () => {
  const client = new JiraClient({
    baseUrl: 'https://jira.example.com',
    personalAccessToken: 'jira-pat',
  });

  await assert.rejects(
    client.uploadAttachment({
      issueKey: 'TEST-123',
      filename: '../secret.txt',
      content: Buffer.from('secret'),
    }),
    /must not contain path separators/,
  );
});
