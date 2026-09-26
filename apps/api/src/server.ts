// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — API Server Entry Point
// ──────────────────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import uploadRoutes from "./routes/upload.routes";
import authRoutes from "./controllers/auth.controller";
import freightRoutes from "./controllers/freight.controller";
import checkoutRoutes from "./controllers/checkout.controller";

const app = express();
const PORT = process.env.PORT || 3001;

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MIDDLEWARES GLOBAIS                                                 │
// └──────────────────────────────────────────────────────────────────────┘

// Segurança de headers
app.use(helmet());

// CORS restrito
app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      process.env.ADMIN_URL || "http://localhost:3002",
    ],
    credentials: true, // Necessário para cookies
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Cookies
app.use(cookieParser());

// Body parsing (JSON) — desativado para rotas de upload (multipart)
app.use(express.json({ limit: "1mb" }));

// Rate Limiting global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em 15 minutos.", code: "RATE_LIMITED" },
});
app.use(globalLimiter);

// Rate Limiting agressivo para uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5,
  message: { error: "Limite de uploads atingido. Aguarde 1 minuto.", code: "UPLOAD_RATE_LIMITED" },
});

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ROTAS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Admin — Uploads (com rate limit agressivo)
app.use("/api/admin/uploads", uploadLimiter, uploadRoutes);

// Autenticação (Login/Logout/Me)
app.use("/api/auth", authRoutes);

// Cálculo de Frete Seguro
app.use("/api/freight", freightRoutes);

// Checkout & Orçamentos (Geração de Hash Único)
app.use("/api/checkout", checkoutRoutes);

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ERROR HANDLER                                                      │
// └──────────────────────────────────────────────────────────────────────┘

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    // Multer errors
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "Arquivo excede o tamanho máximo permitido (100MB)",
        code: "UPLOAD_TOO_LARGE",
      });
      return;
    }

    console.error("[SERVER] Erro não tratado:", err);
    res.status(500).json({
      error: "Erro interno do servidor",
      code: "INTERNAL_ERROR",
    });
  }
);

// ┌──────────────────────────────────────────────────────────────────────┐
// │  START                                                              │
// └──────────────────────────────────────────────────────────────────────┘

app.listen(PORT, () => {
  console.log(`🏭 Ideal Camas API rodando na porta ${PORT}`);
});

export default app;
