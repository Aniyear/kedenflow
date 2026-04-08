/**
 * TypeScript types for FinLog application.
 */

export interface Broker {
  id: string;
  name: string;
  created_at: string;
  debt: number;
}

export type TransactionType = "accrual" | "payment" | "transfer" | "cash";
export type TransactionSource = "manual" | "receipt";

export interface Transaction {
  id: string;
  broker_id: string;
  type: TransactionType;
  amount: number;
  datetime: string;
  receipt_number?: string | null;
  party_from?: string | null;
  party_to?: string | null;
  kbk?: string | null;
  knp?: string | null;
  comment?: string | null;
  source: TransactionSource;
  raw_text?: string | null;
  created_at: string;
}

export interface TransactionCreate {
  broker_id: string;
  type: TransactionType;
  amount: number;
  datetime: string;
  receipt_number?: string;
  party_from?: string;
  party_to?: string;
  kbk?: string;
  knp?: string;
  comment?: string;
  source?: TransactionSource;
  raw_text?: string;
}

export interface ReceiptParseResult {
  type: TransactionType;
  amount?: number | null;
  datetime?: string | null;
  receipt_number?: string | null;
  party_from?: string | null;
  party_to?: string | null;
  kbk?: string | null;
  knp?: string | null;
  comment?: string | null;
  raw_text: string;
  errors: string[];
}

export interface DebtInfo {
  broker_id: string;
  debt: number;
  is_overpayment: boolean;
}
