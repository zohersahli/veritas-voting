import { promises as fs } from "node:fs";
import path from "node:path";

type Layer = "l1" | "l2";

type SaveDeploymentParams = {
  network: string;
  chainId: bigint | number;
  layer: Layer;
  contracts: Record<string, string>;
};

function toChainIdNumber(chainId: bigint | number): number {
  if (typeof chainId === "bigint") return Number(chainId);
  return chainId;
}

async function readJsonIfExists(filePath: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveDeployment(params: SaveDeploymentParams): Promise<string> {
  // English: Write deployments to ./deployments/<network>.json
  // عربي: حفظ عناوين النشر داخل ./deployments/<network>.json

  const networkName = (params.network || "unknown").trim() || "unknown";
  const chainIdNum = toChainIdNumber(params.chainId);

  const deploymentsDir = path.join(process.cwd(), "deployments");
  await fs.mkdir(deploymentsDir, { recursive: true });

  const filePath = path.join(deploymentsDir, `${networkName}.json`);
  const existing = (await readJsonIfExists(filePath)) ?? {};

  const next = {
    ...existing,
    network: networkName,
    chainId: chainIdNum,
    updatedAt: new Date().toISOString(),
    [params.layer]: {
      ...(existing?.[params.layer] ?? {}),
      ...params.contracts,
    },
  };

  // English: Atomic-ish write (temp then rename)
  // عربي: كتابة آمنة نسبيا (ملف مؤقت ثم rename)
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);

  return filePath;
}
