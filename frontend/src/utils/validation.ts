import { isAddress as viemIsAddress } from 'viem';

export function isAddress(value: string): boolean {
  return viemIsAddress(value);
}

export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

