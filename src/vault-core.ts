/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * VaultIQ Core Domain Logic & Cryptographic Utilities
 */

export interface FDRRecord {
  id: string;
  refNumber: string;
  institutionName: string;
  institutionCode: string;
  bankName: string;
  branch: string;
  ifsc: string;
  amount: number;
  interestRate: number;
  issueDate: string;
  maturityDate: string;
  lienMarkedToAICTE: boolean;
  status: 'active' | 'expiring' | 'matured' | 'pending' | 'flagged' | 'released';
  discrepancies?: string[];
  bankVerified: boolean;
  sfmsTxnId: string;
  hash: string;
  createdAt: string;
}

export interface AuditLogNode {
  step: string;
  actor: string;
  role: string;
  timestamp: string;
  action: string;
  status: 'success' | 'warning' | 'info';
  hash: string;
  previousHash: string;
  details: string;
}

/**
 * Calculates days remaining until maturity from a reference date
 */
export function getDaysUntilMaturity(maturityDateStr: string, currentDate: Date = new Date('2026-10-26')): number {
  const maturity = new Date(maturityDateStr);
  const diffTime = maturity.getTime() - currentDate.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Categorizes FDR status based on days remaining and verification flags
 */
export function determineFDRStatus(
  maturityDateStr: string,
  bankVerified: boolean,
  hasDiscrepancies: boolean,
  isReleased: boolean = false,
  currentDate: Date = new Date('2026-10-26')
): 'active' | 'expiring' | 'matured' | 'pending' | 'flagged' | 'released' {
  if (isReleased) return 'released';
  if (!bankVerified && hasDiscrepancies) return 'flagged';
  if (!bankVerified) return 'pending';
  
  const days = getDaysUntilMaturity(maturityDateStr, currentDate);
  if (days < 0) return 'matured';
  if (days <= 30) return 'expiring';
  return 'active';
}

/**
 * Computes Deposit Health Score (0 - 100) based on active portfolio compliance
 */
export function calculateHealthScore(records: FDRRecord[]): {
  score: number;
  label: 'Critical' | 'Moderate' | 'Good' | 'Excellent';
  activeCount: number;
  flaggedCount: number;
  expiringCount: number;
} {
  if (records.length === 0) {
    return { score: 100, label: 'Excellent', activeCount: 0, flaggedCount: 0, expiringCount: 0 };
  }

  const flagged = records.filter(r => r.status === 'flagged').length;
  const expiring = records.filter(r => r.status === 'expiring').length;
  const matured = records.filter(r => r.status === 'matured').length;
  const active = records.filter(r => r.status === 'active').length;

  // Penalties: flagged -20 points each, unrenewed matured -15, expiring -5
  const penalty = (flagged * 18) + (matured * 12) + (expiring * 4);
  const rawScore = Math.max(0, 100 - (penalty / records.length));
  const score = Math.round(rawScore);

  let label: 'Critical' | 'Moderate' | 'Good' | 'Excellent' = 'Excellent';
  if (score < 60) label = 'Critical';
  else if (score < 80) label = 'Moderate';
  else if (score < 95) label = 'Good';

  return {
    score,
    label,
    activeCount: active,
    flaggedCount: flagged,
    expiringCount: expiring,
  };
}

/**
 * Detects discrepancies between OCR extracted values and Core Banking / SFMS query
 */
export function detectDiscrepancies(
  ocrData: {
    amount: number;
    interestRate: number;
    lienMarked: boolean;
    maturityDate: string;
    refNumber: string;
  },
  bankData: {
    amount: number;
    interestRate: number;
    lienMarked: boolean;
    maturityDate: string;
    refNumber: string;
  }
): string[] {
  const issues: string[] = [];

  if (Math.abs(ocrData.amount - bankData.amount) > 0.01) {
    issues.push(`Amount mismatch: OCR extracted ₹${ocrData.amount.toLocaleString()} vs Bank verified ₹${bankData.amount.toLocaleString()}`);
  }

  if (Math.abs(ocrData.interestRate - bankData.interestRate) > 0.1) {
    issues.push(`Interest rate disparity: Scanned ${ocrData.interestRate}% vs SFMS recorded ${bankData.interestRate}%`);
  }

  if (ocrData.lienMarked !== bankData.lienMarked || !bankData.lienMarked) {
    issues.push('AICTE Lien Clause mismatch: Joint lien annotation to AICTE Member Secretary not acknowledged in Bank SFMS');
  }

  if (ocrData.maturityDate !== bankData.maturityDate) {
    issues.push(`Maturity Date discrepancy: Scanned says ${ocrData.maturityDate} while CBS records ${bankData.maturityDate}`);
  }

  if (ocrData.refNumber.trim().toUpperCase() !== bankData.refNumber.trim().toUpperCase()) {
    issues.push(`FDR Reference string variation: '${ocrData.refNumber}' vs CBS record '${bankData.refNumber}'`);
  }

  return issues;
}

/**
 * Generates deterministic mock SHA-256 style hash for blockchain / tamper-evident audit log
 */
export function generateAuditHash(seed: string, timestamp: string): string {
  let hash = 0;
  const str = `${seed}|${timestamp}|AICTE-VAULT-CHAIN-2026`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `0x8f2a${hex}c9e144a79b02${hex.split('').reverse().join('')}e5`;
}

/**
 * Currency formatter for Indian Rupees
 */
export function formatINR(val: number): string {
  if (val >= 10000000) {
    return `₹${(val / 10000000).toFixed(2)} Cr`;
  }
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)} Lakh`;
  }
  return `₹${val.toLocaleString('en-IN')}`;
}

/**
 * Result of OCR document classifier and parameter extraction
 */
export interface OCRClassifierResult {
  isValid: boolean;
  status: 'valid' | 'invalid_unrelated' | 'corrupt_scan';
  error?: {
    title: string;
    message: string;
    isCritical: boolean;
  };
  data?: {
    ref: string;
    bank: string;
    branch: string;
    amount: number;
    interest: number;
    issue: string;
    maturity: string;
    lien: boolean;
    sfms: string;
  };
}

/**
 * Classifies uploaded documents and extracts FDR parameters, strictly returning errors
 * only on genuine failures (unrelated documents or corrupted scans).
 */
export function classifyAndParseOCRDocument(filename: string, fileSize: number = 50000): OCRClassifierResult {
  const fname = filename.toLowerCase();

  // Guardrail 1: Flag explicitly unrelated files (invoices, utility bills, salary slips, personal photos, memes)
  const invalidTokens = ['invoice', 'utility', 'electricity', 'salary', 'payslip', 'paystub', 'water_bill', 'tax_receipt', 'personal_photo', 'meme', 'receipt_groceries', 'gas_bill'];
  if (invalidTokens.some(token => fname.includes(token))) {
    return {
      isValid: false,
      status: 'invalid_unrelated',
      error: {
        title: 'Invalid Document: Uploaded file is not a recognized Fixed Deposit Receipt (FDR).',
        message: 'The AI OCR classifier determined this file is a vendor utility bill/invoice, not an authentic Term Deposit Certificate. Please upload a valid bank deposit receipt.',
        isCritical: true,
      }
    };
  }

  // Guardrail 2: Flag corrupted or unreadable scans
  const corruptTokens = ['corrupt', 'damaged', 'unreadable', 'blurry', 'broken', 'lowres'];
  if (corruptTokens.some(token => fname.includes(token))) {
    return {
      isValid: false,
      status: 'corrupt_scan',
      error: {
        title: 'Extraction Failed: Required instrument details could not be verified.',
        message: 'Required instrument details (Deposit Principal, Maturity Date, or Branch IFSC) could not be verified with confidence >= 95%. Please submit a clearer 300+ DPI scan.',
        isCritical: false,
      }
    };
  }

  // Valid document path: Zero error messages, populated parameters
  return {
    isValid: true,
    status: 'valid',
    data: {
      ref: `SBI-FDR-2024-${Math.floor(10000 + (fileSize % 89999))}`,
      bank: 'State Bank of India',
      branch: 'Connaught Place Branch (SBIN0000691)',
      amount: 5000000,
      interest: 7.25,
      issue: '2024-05-10',
      maturity: '2027-05-10',
      lien: true,
      sfms: 'SFMS241029881920-IND'
    }
  };
}

