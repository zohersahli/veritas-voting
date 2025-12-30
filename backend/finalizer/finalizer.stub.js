/**
 * Finalizer Bot (STUB)
 *
 * Purpose:
 * - Detect finalized polls on Base L2
 * - Record final results on Ethereum L1 Result Registry
 *
 * NOTE:
 * - This file is a placeholder to avoid forgetting the finalizer implementation.
 * - Do NOT store secrets here. Use environment variables via dotenv.
 *
 * Env (placeholders):
 * - BASE_RPC_URL
 * - ETH_SEPOLIA_RPC_URL
 * - FINALIZER_PRIVATE_KEY
 * - L2_POLLS_ADDRESS
 * - L1_RESULT_REGISTRY_ADDRESS
 */

// TODO:
// 1) Connect to L2 + L1 via ethers
// 2) Listen to Finalized events (or poll status)
// 3) Submit record tx to L1
// 4) Handle deposit refund + fallback executor model
// 5) Add logging + retry + persistence (optional)
