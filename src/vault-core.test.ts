/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * VaultIQ Logic Tests
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDaysUntilMaturity,
  determineFDRStatus,
  calculateHealthScore,
  detectDiscrepancies,
  generateAuditHash,
  formatINR,
  classifyAndParseOCRDocument,
  type FDRRecord
} from './vault-core.ts';

test('getDaysUntilMaturity correctly calculates remaining days', () => {
  const current = new Date('2026-10-26');
  // 10 days ahead
  assert.equal(getDaysUntilMaturity('2026-11-05', current), 10);
  // Passed date
  assert.ok(getDaysUntilMaturity('2026-10-20', current) < 0);
});

test('determineFDRStatus correctly assigns status', () => {
  const current = new Date('2026-10-26');
  
  // Released flag takes precedence
  assert.equal(determineFDRStatus('2027-01-01', true, false, true, current), 'released');

  // Discrepancies flag as flagged
  assert.equal(determineFDRStatus('2027-01-01', false, true, false, current), 'flagged');

  // Not bank verified without discrepancy is pending
  assert.equal(determineFDRStatus('2027-01-01', false, false, false, current), 'pending');

  // Verified & maturity within 30 days is expiring
  assert.equal(determineFDRStatus('2026-11-10', true, false, false, current), 'expiring');

  // Verified & maturity > 30 days is active
  assert.equal(determineFDRStatus('2027-05-15', true, false, false, current), 'active');
});

test('calculateHealthScore calculates high score for compliant portfolio', () => {
  const sampleRecords: FDRRecord[] = [
    {
      id: '1',
      refNumber: 'FDR-101',
      institutionName: 'Delhi Tech',
      institutionCode: '1-9321',
      bankName: 'SBI',
      branch: 'Connaught Place',
      ifsc: 'SBIN0000691',
      amount: 5000000,
      interestRate: 7.25,
      issueDate: '2024-05-10',
      maturityDate: '2027-05-10',
      lienMarkedToAICTE: true,
      status: 'active',
      bankVerified: true,
      sfmsTxnId: 'SFMS-881920',
      hash: '0x123',
      createdAt: '2024-05-10'
    },
    {
      id: '2',
      refNumber: 'FDR-102',
      institutionName: 'Delhi Tech',
      institutionCode: '1-9321',
      bankName: 'PNB',
      branch: 'Dwarka',
      ifsc: 'PUNB0123400',
      amount: 3500000,
      interestRate: 7.1,
      issueDate: '2024-06-10',
      maturityDate: '2027-06-10',
      lienMarkedToAICTE: true,
      status: 'active',
      bankVerified: true,
      sfmsTxnId: 'SFMS-881921',
      hash: '0x456',
      createdAt: '2024-06-10'
    }
  ];

  const result = calculateHealthScore(sampleRecords);
  assert.equal(result.score, 100);
  assert.equal(result.label, 'Excellent');
  assert.equal(result.activeCount, 2);
});

test('detectDiscrepancies flags amounts and missing lien clauses', () => {
  const ocr = {
    amount: 5000000,
    interestRate: 7.25,
    lienMarked: false,
    maturityDate: '2027-05-10',
    refNumber: 'FDR-9988'
  };
  const bank = {
    amount: 5000000,
    interestRate: 7.25,
    lienMarked: true,
    maturityDate: '2027-05-10',
    refNumber: 'FDR-9988'
  };

  const issues = detectDiscrepancies(ocr, bank);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /AICTE Lien Clause mismatch/);
});

test('generateAuditHash produces deterministic hash starting with 0x', () => {
  const hash1 = generateAuditHash('FDR-101', '2026-10-26T10:00:00Z');
  const hash2 = generateAuditHash('FDR-101', '2026-10-26T10:00:00Z');
  assert.equal(hash1, hash2);
  assert.ok(hash1.startsWith('0x8f2a'));
});

test('formatINR formats currency in Lakh and Crore readable format', () => {
  assert.equal(formatINR(15000000), '₹1.50 Cr');
  assert.equal(formatINR(350000), '₹3.50 Lakh');
});

test('classifyAndParseOCRDocument parses valid documents with zero errors', () => {
  const result = classifyAndParseOCRDocument('sample-fdr-sbi.svg', 54321);
  assert.equal(result.isValid, true);
  assert.equal(result.status, 'valid');
  assert.equal(result.error, undefined);
  assert.ok(result.data);
  assert.equal(result.data.bank, 'State Bank of India');
  assert.equal(result.data.amount, 5000000);
  assert.equal(result.data.lien, true);
});

test('classifyAndParseOCRDocument triggers error strictly on unrelated documents', () => {
  const invoiceResult = classifyAndParseOCRDocument('vendor_utility_invoice.pdf');
  assert.equal(invoiceResult.isValid, false);
  assert.equal(invoiceResult.status, 'invalid_unrelated');
  assert.ok(invoiceResult.error);
  assert.match(invoiceResult.error.title, /Invalid Document/);
  assert.equal(invoiceResult.error.isCritical, true);
});

test('classifyAndParseOCRDocument triggers error strictly on corrupted scans', () => {
  const corruptResult = classifyAndParseOCRDocument('damaged_corrupt_scan.png');
  assert.equal(corruptResult.isValid, false);
  assert.equal(corruptResult.status, 'corrupt_scan');
  assert.ok(corruptResult.error);
  assert.match(corruptResult.error.title, /Extraction Failed/);
  assert.equal(corruptResult.error.isCritical, false);
});

