import { Router } from "express";
import { pinJSONToIPFS } from "../services/pinata.service.js";

const router = Router();

router.post("/pin-poll-description", async (req, res) => {
  try {
    const { groupId, title, description } = req.body || {};

    // [EN] Minimal validation
    // [AR] تحقق بسيط من المدخلات
    if (!groupId || !title || !description) {
      return res.status(400).json({ error: "Missing fields: groupId, title, description" });
    }

    const payload = {
      groupId: String(groupId),
      title: String(title),
      description: String(description),
      createdAt: new Date().toISOString(),
      app: "veritas",
      type: "poll-description",
    };

    const fileName = `group-${payload.groupId}-poll-${Date.now()}.json`;
    const cid = await pinJSONToIPFS(payload, fileName);

    return res.json({ cid });
  } catch (err) {
    return res.status(500).json({ error: "Pinning failed" });
  }
});

export default router;
