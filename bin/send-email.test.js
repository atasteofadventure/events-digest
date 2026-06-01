'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extractSubject, sendEmail } = require('./send-email');

test('extractSubject reads the leading SUBJECT comment', () => {
  assert.equal(extractSubject('<!--SUBJECT:Hello World-->\n<div>x</div>'), 'Hello World');
});

test('extractSubject falls back when there is no comment', () => {
  assert.equal(extractSubject('<div>x</div>', 'Fallback'), 'Fallback');
});

test('sendEmail POSTs the expected Resend payload', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, text: async () => '{"id":"1"}' };
  };
  await sendEmail({ apiKey: 'k', to: 'a@b.com', from: 'X <onboarding@resend.dev>', subject: 'S', html: '<b>h</b>', fetchImpl: fakeFetch });
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(captured.opts.headers.Authorization, 'Bearer k');
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body.to, ['a@b.com']);
  assert.equal(body.subject, 'S');
  assert.equal(body.html, '<b>h</b>');
});

test('sendEmail throws on a non-2xx response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(
    () => sendEmail({ apiKey: 'k', to: 'a@b.com', from: 'f', subject: 's', html: 'h', fetchImpl: fakeFetch }),
    /Resend 403/
  );
});
