// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Upload Controller (Zero Trust)
// ──────────────────────────────────────────────────────────────────────────────
// Pipeline de segurança:
//   1. Multer intercepta o upload (limite de tamanho)
//   2. Magic Number validation (bytes reais, não extensão)
//   3. MIME type cross-check
//   4. Sanitização do nome do arquivo
//   5. Hash SHA-256 para integridade
//   6. Upload para bucket S3 isolado
//   7. Registro no banco com status PENDING → VALIDATED ou REJECTED
//   8. Audit trail imutável
// ──────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { PrismaClient, UploadStatus, UploadType } from "@prisma/client";
import { UploadMetadataSchema } from "@idealcamas/shared";
import { createAuditLog } from "../services/audit.service";

const prisma = new PrismaClient();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CONFIGURAÇÃO S3                                                    │
// └──────────────────────────────────────────────────────────────────────┘

const s3 = new S3Client({
  region: process.env.AWS_REGION || "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/** Buckets isolados por tipo de conteúdo (Zero Trust) */
const BUCKET_MAP: Record<UploadType, string> = {
  MODEL_3D: process.env.S3_BUCKET_MODELS || "idealcamas-models-prod",
  TEXTURE: process.env.S3_BUCKET_TEXTURES || "idealcamas-textures-prod",
  THUMBNAIL: process.env.S3_BUCKET_THUMBNAILS || "idealcamas-thumbnails-prod",
};

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MAGIC NUMBERS — Assinaturas binárias dos formatos aceitos          │
// └──────────────────────────────────────────────────────────────────────┘

interface MagicSignature {
  offset: number;
  bytes: Buffer;
  mime: string;
  extensions: string[];
}

/**
 * Tabela de magic numbers para validação binária.
 * Não confiamos em extensão de arquivo nem em Content-Type do cliente.
 */
const MAGIC_SIGNATURES: MagicSignature[] = [
  // ── Modelos 3D ──
  {
    // glTF Binary (.glb) — Header: "glTF" em ASCII
    offset: 0,
    bytes: Buffer.from([0x67, 0x6c, 0x54, 0x46]),
    mime: "model/gltf-binary",
    extensions: [".glb"],
  },
  {
    // glTF JSON (.gltf) — Começa com "{" (JSON)
    // Validação adicional: parse JSON + verificar campo "asset.version"
    offset: 0,
    bytes: Buffer.from([0x7b]), // "{"
    mime: "model/gltf+json",
    extensions: [".gltf"],
  },

  // ── Texturas / Imagens ──
  {
    // JPEG — SOI marker
    offset: 0,
    bytes: Buffer.from([0xff, 0xd8, 0xff]),
    mime: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
  },
  {
    // PNG — Signature
    offset: 0,
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mime: "image/png",
    extensions: [".png"],
  },
  {
    // WebP — RIFF....WEBP
    offset: 0,
    bytes: Buffer.from([0x52, 0x49, 0x46, 0x46]),
    mime: "image/webp",
    extensions: [".webp"],
  },
];

/** Mapa de MIME types permitidos por tipo de upload */
const ALLOWED_MIMES: Record<UploadType, string[]> = {
  MODEL_3D: ["model/gltf-binary", "model/gltf+json"],
  TEXTURE: ["image/jpeg", "image/png", "image/webp"],
  THUMBNAIL: ["image/jpeg", "image/png", "image/webp"],
};

/** Tamanhos máximos por tipo (bytes) */
const MAX_FILE_SIZE: Record<UploadType, number> = {
  MODEL_3D: 100 * 1024 * 1024, // 100 MB
  TEXTURE: 20 * 1024 * 1024,   // 20 MB
  THUMBNAIL: 5 * 1024 * 1024,  // 5 MB
};

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MULTER — Interceptação em memória                                  │
// └──────────────────────────────────────────────────────────────────────┘

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // Limite máximo global (100MB)
    files: 1,                    // Um arquivo por request
  },
  fileFilter: (_req, file, cb) => {
    // Primeira barreira: rejeitar extensões óbviamente perigosas
    const ext = path.extname(file.originalname).toLowerCase();
    const dangerousExts = [
      ".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".dll",
      ".js", ".ts", ".php", ".py", ".rb", ".html", ".svg",
      ".zip", ".tar", ".gz", ".rar",
    ];

    if (dangerousExts.includes(ext)) {
      return cb(new Error(`Extensão rejeitada: ${ext}`));
    }

    cb(null, true);
  },
});

// ┌──────────────────────────────────────────────────────────────────────┐
// │  FUNÇÕES DE SEGURANÇA                                               │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Detecta o tipo real do arquivo via magic number.
 * NÃO confia na extensão nem no Content-Type do navegador.
 */
function detectMimeByMagicNumber(buffer: Buffer): MagicSignature | null {
  for (const sig of MAGIC_SIGNATURES) {
    const slice = buffer.subarray(sig.offset, sig.offset + sig.bytes.length);
    if (slice.equals(sig.bytes)) {
      // Para WebP, verificar bytes 8-11 ("WEBP")
      if (sig.mime === "image/webp") {
        const webpMarker = buffer.subarray(8, 12);
        if (!webpMarker.equals(Buffer.from("WEBP"))) {
          continue;
        }
      }
      return sig;
    }
  }
  return null;
}

/**
 * Validação profunda de glTF JSON.
 * Verifica se o conteúdo é um glTF válido e não um JSON malicioso.
 */
function validateGltfJson(buffer: Buffer): { valid: boolean; reason?: string } {
  try {
    const content = buffer.toString("utf-8");

    // Barrar referências externas perigosas (data URIs com script, etc.)
    if (
      content.includes("javascript:") ||
      content.includes("<script") ||
      content.includes("data:text/html")
    ) {
      return { valid: false, reason: "Conteúdo malicioso detectado no glTF JSON" };
    }

    const parsed = JSON.parse(content);

    // Deve ter o campo "asset" com "version"
    if (!parsed.asset || !parsed.asset.version) {
      return { valid: false, reason: "Campo 'asset.version' ausente — não é um glTF válido" };
    }

    // Versão suportada: 2.x
    const version = parseFloat(parsed.asset.version);
    if (version < 2.0 || version >= 3.0) {
      return { valid: false, reason: `Versão glTF ${parsed.asset.version} não suportada (requer 2.x)` };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "Falha ao parsear JSON do glTF" };
  }
}

/**
 * Validação profunda de GLB (binário).
 * Verifica header e estrutura interna do container.
 */
function validateGlbBinary(buffer: Buffer): { valid: boolean; reason?: string } {
  // Header GLB: magic(4) + version(4) + length(4) = 12 bytes mínimo
  if (buffer.length < 12) {
    return { valid: false, reason: "Arquivo GLB muito pequeno (< 12 bytes)" };
  }

  // Verificar magic number "glTF"
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) {
    return { valid: false, reason: "Magic number GLB inválido" };
  }

  // Verificar versão
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    return { valid: false, reason: `Versão GLB ${version} não suportada (requer 2)` };
  }

  // Verificar comprimento declarado vs real
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) {
    return {
      valid: false,
      reason: `Tamanho declarado (${declaredLength}) ≠ tamanho real (${buffer.length}) — possível payload concatenado`,
    };
  }

  return { valid: true };
}

/** Gera hash SHA-256 do conteúdo do arquivo */
function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Sanitiza o nome do arquivo removendo caracteres perigosos */
function sanitizeFilename(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const name = path
    .basename(original, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_") // Só alfanuméricos, underline e hífen
    .substring(0, 100);              // Truncar nomes muito longos

  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");

  return `${name}_${timestamp}_${random}${ext}`;
}

/** Extrai o IP real do request (considerando proxies) */
function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CONTROLLER — uploadSecureFile                                      │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * POST /api/admin/uploads
 *
 * Pipeline completa de upload seguro:
 * 1. Validar metadata (Zod strict)
 * 2. Validar tamanho por tipo
 * 3. Detectar MIME real via magic number
 * 4. Cross-check com MIME types permitidos
 * 5. Validação profunda de estrutura (GLB/glTF)
 * 6. Computar checksum SHA-256
 * 7. Sanitizar nome do arquivo
 * 8. Upload para bucket S3 isolado
 * 9. Registrar no banco (status: VALIDATED)
 * 10. Audit trail
 */
export async function uploadSecureFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const file = req.file;
  const userId = (req as any).userId as string; // Injetado pelo auth middleware
  const clientIp = getClientIp(req);

  // ────────────────────────────────────────────────────
  // 1. VALIDAR ARQUIVO PRESENTE
  // ────────────────────────────────────────────────────
  if (!file || !file.buffer) {
    res.status(400).json({
      error: "Nenhum arquivo enviado",
      code: "UPLOAD_MISSING",
    });
    return;
  }

  // ────────────────────────────────────────────────────
  // 2. VALIDAR METADATA (Zod .strict())
  // ────────────────────────────────────────────────────
  const metadataParse = UploadMetadataSchema.safeParse(req.body);
  if (!metadataParse.success) {
    res.status(400).json({
      error: "Metadata de upload inválida",
      code: "UPLOAD_INVALID_METADATA",
      details: metadataParse.error.flatten(),
    });
    return;
  }

  const { type: uploadType } = metadataParse.data;

  // ────────────────────────────────────────────────────
  // 3. VALIDAR TAMANHO ESPECÍFICO POR TIPO
  // ────────────────────────────────────────────────────
  const maxSize = MAX_FILE_SIZE[uploadType];
  if (file.size > maxSize) {
    res.status(413).json({
      error: `Arquivo excede o limite de ${(maxSize / 1024 / 1024).toFixed(0)}MB para ${uploadType}`,
      code: "UPLOAD_TOO_LARGE",
    });
    return;
  }

  // ────────────────────────────────────────────────────
  // 4. DETECTAR MIME REAL VIA MAGIC NUMBER
  // ────────────────────────────────────────────────────
  const detected = detectMimeByMagicNumber(file.buffer);
  if (!detected) {
    // Registrar tentativa de upload com tipo desconhecido
    await registerRejectedUpload(file, uploadType, userId, clientIp, req, "Magic number não reconhecido");

    res.status(415).json({
      error: "Tipo de arquivo não reconhecido. Formatos aceitos: GLB, GLTF, JPG, PNG, WEBP",
      code: "UPLOAD_UNKNOWN_TYPE",
    });
    return;
  }

  // ────────────────────────────────────────────────────
  // 5. CROSS-CHECK: MIME detectado ∈ permitidos para o tipo
  // ────────────────────────────────────────────────────
  const allowedMimes = ALLOWED_MIMES[uploadType];
  if (!allowedMimes.includes(detected.mime)) {
    await registerRejectedUpload(
      file,
      uploadType,
      userId,
      clientIp,
      req,
      `MIME ${detected.mime} não permitido para tipo ${uploadType}. Permitidos: ${allowedMimes.join(", ")}`
    );

    res.status(415).json({
      error: `Arquivo detectado como ${detected.mime}, que não é aceito para uploads do tipo ${uploadType}`,
      code: "UPLOAD_MIME_MISMATCH",
    });
    return;
  }

  // ────────────────────────────────────────────────────
  // 6. VALIDAÇÃO PROFUNDA DE ESTRUTURA (GLB/glTF)
  // ────────────────────────────────────────────────────
  if (detected.mime === "model/gltf-binary") {
    const validation = validateGlbBinary(file.buffer);
    if (!validation.valid) {
      await registerRejectedUpload(file, uploadType, userId, clientIp, req, validation.reason!);

      res.status(422).json({
        error: validation.reason,
        code: "UPLOAD_INVALID_GLB",
      });
      return;
    }
  }

  if (detected.mime === "model/gltf+json") {
    const validation = validateGltfJson(file.buffer);
    if (!validation.valid) {
      await registerRejectedUpload(file, uploadType, userId, clientIp, req, validation.reason!);

      res.status(422).json({
        error: validation.reason,
        code: "UPLOAD_INVALID_GLTF",
      });
      return;
    }
  }

  // ────────────────────────────────────────────────────
  // 7. COMPUTAR CHECKSUM SHA-256
  // ────────────────────────────────────────────────────
  const checksum = computeSha256(file.buffer);

  // ────────────────────────────────────────────────────
  // 8. SANITIZAR NOME DO ARQUIVO
  // ────────────────────────────────────────────────────
  const sanitizedName = sanitizeFilename(file.originalname);
  const bucketName = BUCKET_MAP[uploadType];
  const bucketKey = `${uploadType.toLowerCase()}/${new Date().toISOString().slice(0, 7)}/${sanitizedName}`;

  // ────────────────────────────────────────────────────
  // 9. UPLOAD PARA S3 (Bucket isolado)
  // ────────────────────────────────────────────────────
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: bucketKey,
        Body: file.buffer,
        ContentType: detected.mime,
        // Headers de segurança
        Metadata: {
          "original-name": file.originalname.substring(0, 200),
          "checksum-sha256": checksum,
          "uploaded-by": userId,
          "upload-type": uploadType,
        },
        // Prevenir execução direta do arquivo
        ContentDisposition: "attachment",
        // Server-side encryption
        ServerSideEncryption: "AES256",
      })
    );
  } catch (s3Error) {
    console.error("[UPLOAD] Falha no S3:", s3Error);
    res.status(502).json({
      error: "Falha ao armazenar arquivo. Tente novamente.",
      code: "UPLOAD_STORAGE_FAILED",
    });
    return;
  }

  // ────────────────────────────────────────────────────
  // 10. REGISTRAR NO BANCO (STATUS: VALIDATED)
  // ────────────────────────────────────────────────────
  try {
    const upload = await prisma.upload.create({
      data: {
        originalName: file.originalname.substring(0, 500),
        sanitizedName,
        mimeType: file.mimetype, // O que o cliente declarou
        detectedMime: detected.mime, // O que realmente é
        sizeBytes: file.size,
        type: uploadType,
        status: UploadStatus.VALIDATED,
        bucketName,
        bucketKey,
        checksumSha256: checksum,
        uploadedById: userId,
        uploadedByIp: clientIp,
      },
    });

    // ── Audit Trail ──
    await createAuditLog({
      action: "UPLOAD_CREATE",
      entity: "uploads",
      entityId: upload.id,
      newValue: JSON.stringify({
        sanitizedName,
        mime: detected.mime,
        size: file.size,
        bucket: bucketName,
      }),
      userId,
      req,
    });

    res.status(201).json({
      id: upload.id,
      sanitizedName: upload.sanitizedName,
      type: upload.type,
      status: upload.status,
      sizeBytes: upload.sizeBytes,
      detectedMime: upload.detectedMime,
      checksumSha256: upload.checksumSha256,
    });
  } catch (dbError) {
    // Se o registro no banco falhar, remover o arquivo do S3 (rollback)
    console.error("[UPLOAD] Falha no banco, executando rollback do S3:", dbError);
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: bucketKey,
        })
      );
    } catch (rollbackError) {
      console.error("[UPLOAD] Falha no rollback do S3:", rollbackError);
    }

    res.status(500).json({
      error: "Falha ao registrar upload. O arquivo foi removido.",
      code: "UPLOAD_DB_FAILED",
    });
  }
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  HELPER — Registrar uploads rejeitados (para auditoria)            │
// └──────────────────────────────────────────────────────────────────────┘

async function registerRejectedUpload(
  file: Express.Multer.File,
  uploadType: UploadType,
  userId: string,
  clientIp: string,
  req: Request,
  reason: string
): Promise<void> {
  try {
    const upload = await prisma.upload.create({
      data: {
        originalName: file.originalname.substring(0, 500),
        sanitizedName: sanitizeFilename(file.originalname),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        type: uploadType,
        status: UploadStatus.REJECTED,
        bucketName: "N/A",
        bucketKey: "N/A",
        checksumSha256: computeSha256(file.buffer),
        validationNotes: reason,
        uploadedById: userId,
        uploadedByIp: clientIp,
      },
    });

    await createAuditLog({
      action: "UPLOAD_REJECT",
      entity: "uploads",
      entityId: upload.id,
      newValue: JSON.stringify({ reason, originalName: file.originalname }),
      userId,
      req,
    });
  } catch (err) {
    // Log mas não falha o request principal
    console.error("[UPLOAD] Falha ao registrar rejeição:", err);
  }
}
