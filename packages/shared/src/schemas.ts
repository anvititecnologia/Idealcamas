// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Schemas de Validação Zod (Shared)
// ──────────────────────────────────────────────────────────────────────────────
// Schemas compartilhados entre API, Client e Admin.
// Uso de .strict() obrigatório para barrar Parameter Tampering.
// ──────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ENUMS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

export const UserRoleEnum = z.enum(["FABRICANTE", "VENDEDOR"]);
export const ProductCategoryEnum = z.enum(["SOFA", "CAMA", "ALMOFADA", "TRAVESSEIRO"]);
export const UploadTypeEnum = z.enum(["MODEL_3D", "TEXTURE", "THUMBNAIL"]);
export const UploadStatusEnum = z.enum(["PENDING", "VALIDATED", "REJECTED", "QUARANTINE"]);

export type UserRole = z.infer<typeof UserRoleEnum>;
export type ProductCategory = z.infer<typeof ProductCategoryEnum>;
export type UploadType = z.infer<typeof UploadTypeEnum>;

// ┌──────────────────────────────────────────────────────────────────────┐
// │  AUTH                                                               │
// └──────────────────────────────────────────────────────────────────────┘

export const LoginSchema = z
  .object({
    email: z.string().email("E-mail inválido").max(255),
    password: z.string().min(8, "Senha deve ter ao menos 8 caracteres").max(128),
  })
  .strict();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  PRODUTO                                                            │
// └──────────────────────────────────────────────────────────────────────┘

/** Schema de dimensões com travas anatômicas */
const DimensionConstraints = z.object({
  defaultWidthCm: z.number().positive().min(30).max(500),
  defaultDepthCm: z.number().positive().min(30).max(300),
  defaultHeightCm: z.number().positive().min(10).max(250),
  minWidthCm: z.number().positive().min(30),
  maxWidthCm: z.number().positive().max(500),
  minDepthCm: z.number().positive().min(30),
  maxDepthCm: z.number().positive().max(300),
  minHeightCm: z.number().positive().min(10),
  maxHeightCm: z.number().positive().max(250),
});

/** Schema para dimensões específicas de sofá */
const SofaDimensions = z.object({
  seatHeightCm: z.number().min(35).max(55).optional(), // Limites anatômicos
  seatDepthCm: z.number().min(45).max(70).optional(),
  armWidthCm: z.number().min(5).max(30).optional(),
});

/** Schema para dimensões específicas de cama */
const BedDimensions = z.object({
  headboardHeightCm: z.number().min(30).max(150).optional(),
  frameHeightCm: z.number().min(15).max(60).optional(),
});

export const CreateProductSchema = z
  .object({
    name: z.string().min(3).max(200),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido").max(200),
    description: z.string().max(2000).optional(),
    category: ProductCategoryEnum,
    basePriceCents: z.number().int().positive(),
    weightKg: z.number().positive().max(500),

    // Dimensões
    ...DimensionConstraints.shape,

    // Tipo-específico
    ...SofaDimensions.shape,
    ...BedDimensions.shape,

    // Flags
    allowsPetFriendly: z.boolean().default(false),
    allowsRetractable: z.boolean().default(false),
    allowsXRayView: z.boolean().default(false),
    allowsChaise: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) => data.minWidthCm <= data.maxWidthCm,
    { message: "minWidthCm deve ser ≤ maxWidthCm", path: ["minWidthCm"] }
  )
  .refine(
    (data) => data.minDepthCm <= data.maxDepthCm,
    { message: "minDepthCm deve ser ≤ maxDepthCm", path: ["minDepthCm"] }
  )
  .refine(
    (data) => data.minHeightCm <= data.maxHeightCm,
    { message: "minHeightCm deve ser ≤ maxHeightCm", path: ["minHeightCm"] }
  );

export const UpdateProductSchema = CreateProductSchema.partial().omit({ slug: true }).strict();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MATERIAL                                                           │
// └──────────────────────────────────────────────────────────────────────┘

export const MaterialTypeEnum = z.enum(["TECIDO", "ESPUMA", "MADEIRA", "PERCINTA", "PLUMA"]);

export const CreateMaterialSchema = z
  .object({
    name: z.string().min(2).max(200),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200),
    description: z.string().max(2000).optional(),
    type: MaterialTypeEnum,
    pricePerUnitCents: z.number().int().positive(),
    priceUnit: z.enum(["m2", "kg", "un"]).default("m2"),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Cor HEX inválida")
      .optional(),
    densityKgM3: z.number().positive().optional(),
    isPetProof: z.boolean().default(false),
    isWaterproof: z.boolean().default(false),
  })
  .strict();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  COMPONENTE                                                         │
// └──────────────────────────────────────────────────────────────────────┘

export const CreateComponentSchema = z
  .object({
    name: z.string().min(2).max(200),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200),
    description: z.string().max(2000).optional(),
    priceCents: z.number().int().nonnegative(),
  })
  .strict();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  UPLOAD                                                             │
// └──────────────────────────────────────────────────────────────────────┘

export const UploadMetadataSchema = z
  .object({
    type: UploadTypeEnum,
    associatedEntity: z.enum(["product", "component", "material"]).optional(),
    associatedEntityId: z.string().cuid().optional(),
  })
  .strict();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  FRETE                                                              │
// └──────────────────────────────────────────────────────────────────────┘

export const FreightCalculationSchema = z
  .object({
    cep: z
      .string()
      .regex(/^\d{5}-?\d{3}$/, "CEP inválido (formato: 00000-000)")
      .transform((v) => v.replace("-", "")),
    quoteId: z.string().cuid().optional(),
  })
  .strict();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ORÇAMENTO → WHATSAPP                                              │
// └──────────────────────────────────────────────────────────────────────┘

export const QuoteItemConfigSchema = z
  .object({
    productId: z.string().cuid(),
    widthCm: z.number().positive(),
    depthCm: z.number().positive(),
    heightCm: z.number().positive(),
    materialIds: z.array(z.string().cuid()).min(1).max(10),
    componentIds: z.array(z.string().cuid()).max(20).default([]),
    quantity: z.number().int().positive().max(50).default(1),
  })
  .strict();

export const CreateQuoteSchema = z
  .object({
    customerName: z.string().min(2).max(200).optional(),
    customerPhone: z
      .string()
      .regex(/^\+?55?\d{10,11}$/, "Telefone inválido")
      .optional(),
    customerCep: z
      .string()
      .regex(/^\d{5}-?\d{3}$/)
      .transform((v) => v.replace("-", ""))
      .optional(),
    items: z.array(QuoteItemConfigSchema).min(1).max(20),
  })
  .strict();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  PERSONALIZAÇÃO PARAMÉTRICA (validação de config do cliente)        │
// └──────────────────────────────────────────────────────────────────────┘

export const ClientProfileSchema = z
  .object({
    hasPets: z.boolean().default(false),
    primaryUse: z.enum(["TV", "LEITURA", "DECORATIVO", "DORMIR"]).optional(),
    roomSizeSqM: z.number().positive().max(200).optional(),
  })
  .strict();
