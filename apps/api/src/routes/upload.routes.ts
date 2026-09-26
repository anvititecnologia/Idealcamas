// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Rotas de Upload (Admin)
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { uploadMiddleware, uploadSecureFile } from "../controllers/upload.controller";

const router = Router();

/**
 * POST /api/admin/uploads
 *
 * Upload seguro de modelos 3D e texturas.
 * Acesso: apenas FABRICANTE (RBAC).
 *
 * Headers:
 *   Cookie: session_token=<jwt>
 *
 * Body (multipart/form-data):
 *   file: <arquivo binário>
 *   type: "MODEL_3D" | "TEXTURE" | "THUMBNAIL"
 *   associatedEntity?: "product" | "component" | "material"
 *   associatedEntityId?: string (CUID)
 */
router.post(
  "/",
  requireAuth,
  requireRole("FABRICANTE"),
  uploadMiddleware.single("file"),
  uploadSecureFile
);

export default router;
