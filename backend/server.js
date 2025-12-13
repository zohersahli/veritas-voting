import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import ipfsRoutes from "./routes/ipfs.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5050;

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// مهم: تفعيل قراءة JSON body
// Important: Enable JSON body reading
app.use(express.json({ limit: "50kb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// كل شيء متعلق بالـ IPFS سيكون تحت /ipfs
// Everything related to IPFS will be under /ipfs
app.use("/ipfs", ipfsRoutes);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
