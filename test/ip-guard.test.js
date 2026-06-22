import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp } from '../lib/ip-guard.js';

test('blocks cloud metadata 169.254.169.254', () => {
  assert.equal(isBlockedIp('169.254.169.254').blocked, true);
});

test('blocks IPv4 private / loopback / cgnat / this-network', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '100.64.0.1', '0.0.0.0', '255.255.255.255']) {
    assert.equal(isBlockedIp(ip).blocked, true, ip);
  }
});

test('blocks TEST-NET ranges', () => {
  for (const ip of ['192.0.2.5', '198.51.100.5', '203.0.113.5']) {
    assert.equal(isBlockedIp(ip).blocked, true, ip);
  }
});

test('blocks IPv6 loopback / ULA / link-local / multicast', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
    assert.equal(isBlockedIp(ip).blocked, true, ip);
  }
});

test('blocks IPv4-mapped IPv6 metadata (::ffff:169.254.169.254)', () => {
  assert.equal(isBlockedIp('::ffff:169.254.169.254').blocked, true);
  assert.equal(isBlockedIp('::ffff:10.0.0.1').blocked, true);
});

test('allows genuine public IPs', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.190.78', '203.0.114.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedIp(ip).blocked, false, ip);
  }
});

test('rejects garbage', () => {
  assert.equal(isBlockedIp('not-an-ip').blocked, true);
  assert.equal(isBlockedIp('999.999.999.999').blocked, true);
});
