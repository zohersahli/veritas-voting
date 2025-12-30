import axios from "axios";

export async function pinJSONToIPFS(pinataContent, name = "poll-description.json") {
  // [EN] Load JWT from environment variables
  // [AR] تحميل JWT من متغيرات البيئة
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("Missing PINATA_JWT in .env");

  const url = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

  // [EN] Pinata expects { pinataContent, pinataMetadata, pinataOptions }
  // [AR] Pinata تتوقع { pinataContent, pinataMetadata, pinataOptions }
  const body = {
    pinataContent,
    pinataMetadata: { name },
  };

  const res = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  return res.data.IpfsHash;
}
