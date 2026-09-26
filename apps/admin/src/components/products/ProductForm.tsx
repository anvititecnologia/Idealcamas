// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — ProductForm (Admin Backoffice)
// ──────────────────────────────────────────────────────────────────────────────
// Formulário inteligente para cadastro/edição de produtos.
//
// Recursos:
//   ✔ react-hook-form + zodResolver para validação client-side
//   ✔ Campos anatômicos condicionais (Sofá vs Cama vs Almofada)
//   ✔ Sliders com travas min/max extraídas dos schemas Zod
//   ✔ Drag & Drop seguro para modelos 3D (.glb/.gltf)
//   ✔ Validação visual de extensão + tamanho ANTES do envio
//   ✔ Indicador de progresso de upload com tratamento de erro
//   ✔ Feedback quando servidor rejeita Magic Number
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback, useRef, type DragEvent, type ChangeEvent } from "react";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Package,
  Upload,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Box,
  Ruler,
  SlidersHorizontal,
  PawPrint,
  Eye,
  Sofa,
  BedDouble,
  Pillow,
  Info,
  FileUp,
  ShieldAlert,
} from "lucide-react";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  SCHEMA ZOD (replicado do @idealcamas/shared para client-side)     │
// │  Em produção, importar de @idealcamas/shared                       │
// └──────────────────────────────────────────────────────────────────────┘

const ProductCategoryEnum = z.enum(["SOFA", "CAMA", "ALMOFADA", "TRAVESSEIRO"]);

const ProductFormSchema = z
  .object({
    name: z.string().min(3, "Nome deve ter ao menos 3 caracteres").max(200),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido (use letras minúsculas, números e hífens)")
      .max(200),
    description: z.string().max(2000).optional().or(z.literal("")),
    category: ProductCategoryEnum,
    basePriceCents: z.number().int().positive("Preço deve ser positivo"),
    weightKg: z.number().positive("Peso deve ser positivo").max(500),

    // Dimensões gerais (cm)
    defaultWidthCm: z.number().positive().min(30, "Mín: 30cm").max(500, "Máx: 500cm"),
    defaultDepthCm: z.number().positive().min(30, "Mín: 30cm").max(300, "Máx: 300cm"),
    defaultHeightCm: z.number().positive().min(10, "Mín: 10cm").max(250, "Máx: 250cm"),

    // Limites paramétricos
    minWidthCm: z.number().positive().min(30),
    maxWidthCm: z.number().positive().max(500),
    minDepthCm: z.number().positive().min(30),
    maxDepthCm: z.number().positive().max(300),
    minHeightCm: z.number().positive().min(10),
    maxHeightCm: z.number().positive().max(250),

    // Sofá-específico
    seatHeightCm: z.number().min(35).max(55).optional().nullable(),
    seatDepthCm: z.number().min(45).max(70).optional().nullable(),
    armWidthCm: z.number().min(5).max(30).optional().nullable(),

    // Cama-específico
    headboardHeightCm: z.number().min(30).max(150).optional().nullable(),
    frameHeightCm: z.number().min(15).max(60).optional().nullable(),

    // Flags
    allowsPetFriendly: z.boolean().default(false),
    allowsRetractable: z.boolean().default(false),
    allowsXRayView: z.boolean().default(false),
    allowsChaise: z.boolean().default(false),
  })
  .refine((d) => d.minWidthCm <= d.maxWidthCm, {
    message: "Largura mínima não pode exceder a máxima",
    path: ["minWidthCm"],
  })
  .refine((d) => d.minDepthCm <= d.maxDepthCm, {
    message: "Profundidade mínima não pode exceder a máxima",
    path: ["minDepthCm"],
  })
  .refine((d) => d.minHeightCm <= d.maxHeightCm, {
    message: "Altura mínima não pode exceder a máxima",
    path: ["minHeightCm"],
  });

type ProductFormData = z.infer<typeof ProductFormSchema>;

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS DO UPLOAD                                                    │
// └──────────────────────────────────────────────────────────────────────┘

type UploadStatus = "idle" | "validating" | "uploading" | "success" | "error";

interface UploadState {
  status: UploadStatus;
  progress: number;
  fileName: string | null;
  fileSize: number | null;
  uploadId: string | null;
  errorMessage: string | null;
  errorCode: string | null;
}

const INITIAL_UPLOAD_STATE: UploadState = {
  status: "idle",
  progress: 0,
  fileName: null,
  fileSize: null,
  uploadId: null,
  errorMessage: null,
  errorCode: null,
};

// ── Regras de validação client-side para arquivos ──
const ALLOWED_MODEL_EXTENSIONS = [".glb", ".gltf"];
const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_MODEL_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;   // 5 MB

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CONSTANTES DE UI                                                   │
// └──────────────────────────────────────────────────────────────────────┘

const CATEGORY_OPTIONS = [
  { value: "SOFA", label: "Sofá", icon: Sofa },
  { value: "CAMA", label: "Cama", icon: BedDouble },
  { value: "ALMOFADA", label: "Almofada", icon: Pillow },
  { value: "TRAVESSEIRO", label: "Travesseiro", icon: Pillow },
] as const;

// ┌──────────────────────────────────────────────────────────────────────┐
// │  PROPS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

interface ProductFormProps {
  /** Dados iniciais para edição (null = criação) */
  initialData?: Partial<ProductFormData> & { id?: string };
  /** Callback ao salvar com sucesso */
  onSuccess?: (productId: string) => void;
  /** URL base da API */
  apiUrl?: string;
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  SUBCOMPONENTES                                                     │
// └──────────────────────────────────────────────────────────────────────┘

/** Input numérico com label e erro */
function NumericField({
  label,
  unit,
  error,
  hint,
  ...props
}: {
  label: string;
  unit?: string;
  error?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-500">
        {label}
        {hint && (
          <span title={hint} className="cursor-help">
            <Info className="h-3 w-3 text-stone-400" />
          </span>
        )}
      </label>
      <div className="relative">
        <input
          type="number"
          step="0.1"
          className={`w-full rounded-lg border bg-white px-3 py-2.5 pr-12 text-sm text-stone-800 transition-all placeholder:text-stone-300
            ${error
              ? "border-red-300 ring-2 ring-red-100 focus:border-red-400 focus:ring-red-200"
              : "border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
            }
          `}
          {...props}
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-stone-400">
            {unit}
          </span>
        )}
      </div>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

/** Toggle switch com label */
function ToggleField({
  label,
  description,
  icon: Icon,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  icon: React.ElementType;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-white p-3 transition-all hover:border-amber-300 hover:bg-amber-50/30">
      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <span className="text-sm font-medium text-stone-700">{label}</span>
        {description && (
          <p className="mt-0.5 text-xs text-stone-400">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-amber-700" : "bg-stone-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  COMPONENTE PRINCIPAL — ProductForm                                │
// └──────────────────────────────────────────────────────────────────────┘

export function ProductForm({
  initialData,
  onSuccess,
  apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
}: ProductFormProps) {
  const isEditing = !!initialData?.id;

  // ── React Hook Form + Zod ──
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting, isDirty },
    setError: setFormError,
  } = useForm<ProductFormData>({
    resolver: zodResolver(ProductFormSchema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      category: "SOFA",
      basePriceCents: 0,
      weightKg: 0,
      defaultWidthCm: 140,
      defaultDepthCm: 90,
      defaultHeightCm: 85,
      minWidthCm: 80,
      maxWidthCm: 300,
      minDepthCm: 50,
      maxDepthCm: 200,
      minHeightCm: 30,
      maxHeightCm: 120,
      seatHeightCm: 45,
      seatDepthCm: 55,
      armWidthCm: 15,
      headboardHeightCm: 50,
      frameHeightCm: 30,
      allowsPetFriendly: false,
      allowsRetractable: false,
      allowsXRayView: false,
      allowsChaise: false,
      ...initialData,
    },
  });

  // Observar categoria para campos condicionais
  const category = watch("category");
  const isSofa = category === "SOFA";
  const isCama = category === "CAMA";

  // ── Estado do Upload 3D ──
  const [modelUpload, setModelUpload] = useState<UploadState>(INITIAL_UPLOAD_STATE);
  const [thumbnailUpload, setThumbnailUpload] = useState<UploadState>(INITIAL_UPLOAD_STATE);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  // ── Estado global do form ──
  const [formStatus, setFormStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // ────────────────────────────────────────────────────────────────
  // VALIDAÇÃO CLIENT-SIDE DE ARQUIVO
  // ────────────────────────────────────────────────────────────────

  /**
   * Valida o arquivo ANTES de enviar ao servidor.
   * Isso é uma barreira UX — a validação real (Magic Number) ocorre no back-end.
   */
  function validateFileClientSide(
    file: File,
    allowedExtensions: string[],
    maxSize: number
  ): { valid: boolean; error?: string } {
    // 1. Verificar extensão
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `Extensão "${ext}" não aceita. Use: ${allowedExtensions.join(", ")}`,
      };
    }

    // 2. Verificar tamanho
    if (file.size > maxSize) {
      const maxMB = (maxSize / 1024 / 1024).toFixed(0);
      const fileMB = (file.size / 1024 / 1024).toFixed(1);
      return {
        valid: false,
        error: `Arquivo muito grande (${fileMB}MB). Máximo: ${maxMB}MB`,
      };
    }

    // 3. Verificar nome vazio / suspeit
    if (!file.name || file.name.length < 3) {
      return { valid: false, error: "Nome de arquivo inválido" };
    }

    return { valid: true };
  }

  // ────────────────────────────────────────────────────────────────
  // UPLOAD PARA O BACK-END (com progresso via XMLHttpRequest)
  // ────────────────────────────────────────────────────────────────

  const uploadFile = useCallback(
    async (
      file: File,
      uploadType: "MODEL_3D" | "THUMBNAIL",
      setUploadState: React.Dispatch<React.SetStateAction<UploadState>>
    ): Promise<string | null> => {
      // Validação client-side
      const allowedExts =
        uploadType === "MODEL_3D" ? ALLOWED_MODEL_EXTENSIONS : ALLOWED_IMAGE_EXTENSIONS;
      const maxSize = uploadType === "MODEL_3D" ? MAX_MODEL_SIZE : MAX_IMAGE_SIZE;

      setUploadState({
        status: "validating",
        progress: 0,
        fileName: file.name,
        fileSize: file.size,
        uploadId: null,
        errorMessage: null,
        errorCode: null,
      });

      const validation = validateFileClientSide(file, allowedExts, maxSize);
      if (!validation.valid) {
        setUploadState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: validation.error!,
          errorCode: "CLIENT_VALIDATION",
        }));
        return null;
      }

      // Preparar FormData
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", uploadType);

      // Upload via XMLHttpRequest (para progresso)
      return new Promise<string | null>((resolve) => {
        const xhr = new XMLHttpRequest();

        // Progresso
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setUploadState((prev) => ({
              ...prev,
              status: "uploading",
              progress: percent,
            }));
          }
        });

        // Sucesso
        xhr.addEventListener("load", () => {
          if (xhr.status === 201) {
            const response = JSON.parse(xhr.responseText);
            setUploadState({
              status: "success",
              progress: 100,
              fileName: file.name,
              fileSize: file.size,
              uploadId: response.id,
              errorMessage: null,
              errorCode: null,
            });
            resolve(response.id);
          } else {
            // ── TRATAMENTO DE ERROS DO SERVIDOR ──
            let errorMessage = "Falha no upload. Tente novamente.";
            let errorCode = "SERVER_ERROR";

            try {
              const errorResponse = JSON.parse(xhr.responseText);
              errorCode = errorResponse.code || errorCode;

              // Mensagens amigáveis por código de erro
              switch (errorResponse.code) {
                case "UPLOAD_UNKNOWN_TYPE":
                  errorMessage =
                    "O servidor rejeitou este arquivo: tipo não reconhecido. " +
                    "Verifique se o arquivo .glb/.gltf não está corrompido.";
                  break;
                case "UPLOAD_MIME_MISMATCH":
                  errorMessage =
                    "O conteúdo real do arquivo não corresponde à extensão. " +
                    "O servidor detectou um tipo diferente do esperado.";
                  break;
                case "UPLOAD_INVALID_GLB":
                  errorMessage =
                    "O arquivo GLB está com a estrutura inválida. " +
                    "Exporte novamente do software 3D com glTF 2.0.";
                  break;
                case "UPLOAD_INVALID_GLTF":
                  errorMessage =
                    "O arquivo glTF contém conteúdo inválido ou potencialmente inseguro. " +
                    "Verifique e re-exporte o modelo.";
                  break;
                case "UPLOAD_TOO_LARGE":
                  errorMessage = errorResponse.error || "Arquivo excede o tamanho máximo.";
                  break;
                case "UPLOAD_RATE_LIMITED":
                  errorMessage = "Muitos uploads seguidos. Aguarde 1 minuto.";
                  break;
                default:
                  errorMessage = errorResponse.error || errorMessage;
              }
            } catch {
              // Se não conseguir parsear a resposta, usar mensagem genérica
            }

            setUploadState((prev) => ({
              ...prev,
              status: "error",
              errorMessage,
              errorCode,
            }));
            resolve(null);
          }
        });

        // Erro de rede
        xhr.addEventListener("error", () => {
          setUploadState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: "Falha na conexão. Verifique sua internet e tente novamente.",
            errorCode: "NETWORK_ERROR",
          }));
          resolve(null);
        });

        xhr.open("POST", `${apiUrl}/api/admin/uploads`);
        xhr.withCredentials = true; // Envia o cookie HttpOnly
        xhr.send(formData);
      });
    },
    [apiUrl]
  );

  // ────────────────────────────────────────────────────────────────
  // DRAG & DROP HANDLERS
  // ────────────────────────────────────────────────────────────────

  const [isDragging3D, setIsDragging3D] = useState(false);
  const [isDraggingThumb, setIsDraggingThumb] = useState(false);

  const handleDragOver = useCallback((e: DragEvent, setDragging: (v: boolean) => void) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent, setDragging: (v: boolean) => void) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (
      e: DragEvent,
      uploadType: "MODEL_3D" | "THUMBNAIL",
      setDragging: (v: boolean) => void,
      setUploadState: React.Dispatch<React.SetStateAction<UploadState>>
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        uploadFile(file, uploadType, setUploadState);
      }
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (
      e: ChangeEvent<HTMLInputElement>,
      uploadType: "MODEL_3D" | "THUMBNAIL",
      setUploadState: React.Dispatch<React.SetStateAction<UploadState>>
    ) => {
      const file = e.target.files?.[0];
      if (file) {
        uploadFile(file, uploadType, setUploadState);
      }
      // Reset input para permitir re-selecionar o mesmo arquivo
      e.target.value = "";
    },
    [uploadFile]
  );

  // ────────────────────────────────────────────────────────────────
  // SUBMIT DO FORMULÁRIO
  // ────────────────────────────────────────────────────────────────

  const onSubmit: SubmitHandler<ProductFormData> = async (data) => {
    setFormStatus("saving");

    try {
      const endpoint = isEditing
        ? `${apiUrl}/api/admin/products/${initialData!.id}`
        : `${apiUrl}/api/admin/products`;

      const method = isEditing ? "PUT" : "POST";

      // Limpar campos condicionais que não se aplicam à categoria
      const cleanedData = { ...data };
      if (!isSofa) {
        cleanedData.seatHeightCm = null;
        cleanedData.seatDepthCm = null;
        cleanedData.armWidthCm = null;
      }
      if (!isCama) {
        cleanedData.headboardHeightCm = null;
        cleanedData.frameHeightCm = null;
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...cleanedData,
          modelUploadId: modelUpload.uploadId,
          thumbnailUploadId: thumbnailUpload.uploadId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Falha ao salvar produto");
      }

      const result = await response.json();
      setFormStatus("saved");
      onSuccess?.(result.id);
    } catch (err) {
      setFormStatus("error");
      setFormError("root", {
        message: err instanceof Error ? err.message : "Erro ao salvar produto",
      });
    }
  };

  // ────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 1: INFORMAÇÕES BÁSICAS
          ════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-800/10">
            <Package className="h-5 w-5 text-amber-800" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-stone-800">Informações Básicas</h3>
            <p className="text-xs text-stone-400">Dados gerais do produto</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Nome */}
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Nome do Produto
            </label>
            <input
              {...register("name")}
              placeholder="Ex: Sofá Retrátil Confort"
              className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-stone-800 transition-all placeholder:text-stone-300 ${
                errors.name
                  ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  : "border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              }`}
            />
            {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
          </div>

          {/* Slug */}
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Slug (URL)
            </label>
            <input
              {...register("slug")}
              placeholder="Ex: sofa-retratil-confort"
              className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-mono text-stone-800 transition-all placeholder:text-stone-300 ${
                errors.slug
                  ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  : "border-stone-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              }`}
            />
            {errors.slug && <p className="text-xs text-red-600">{errors.slug.message}</p>}
          </div>

          {/* Categoria */}
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Categoria
            </label>
            <Controller
              name="category"
              control={control}
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CATEGORY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = field.value === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => field.onChange(opt.value)}
                        className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all ${
                          isSelected
                            ? "border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-100"
                            : "border-stone-200 text-stone-500 hover:border-stone-300 hover:bg-stone-50"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </div>

          {/* Preço e Peso */}
          <div className="grid grid-cols-2 gap-3">
            <NumericField
              label="Preço Base"
              unit="centavos"
              hint="Armazenado em centavos (ex: 15990 = R$ 159,90)"
              error={errors.basePriceCents?.message}
              {...register("basePriceCents", { valueAsNumber: true })}
            />
            <NumericField
              label="Peso"
              unit="kg"
              error={errors.weightKg?.message}
              {...register("weightKg", { valueAsNumber: true })}
            />
          </div>

          {/* Descrição */}
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Descrição
            </label>
            <textarea
              {...register("description")}
              rows={3}
              placeholder="Descreva o produto em detalhes..."
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-800 transition-all placeholder:text-stone-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
            />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 2: DIMENSÕES ANATÔMICAS
          ════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10">
            <Ruler className="h-5 w-5 text-blue-700" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-stone-800">Dimensões Anatômicas</h3>
            <p className="text-xs text-stone-400">
              Medidas base e limites paramétricos do configurador
            </p>
          </div>
        </div>

        {/* Dimensões Padrão */}
        <div className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400">
            Medidas Anatômicas Principais
          </p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <NumericField
              label="Largura Total"
              unit="cm"
              hint="Largura total de ponta a ponta do produto"
              error={errors.defaultWidthCm?.message}
              {...register("defaultWidthCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Profundidade"
              unit="cm"
              hint="Profundidade total externa"
              error={errors.defaultDepthCm?.message}
              {...register("defaultDepthCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Altura Total"
              unit="cm"
              hint="Altura total do chão ao topo"
              error={errors.defaultHeightCm?.message}
              {...register("defaultHeightCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Vão Livre"
              unit="cm"
              hint="Distância livre do chão até a base/estrado"
              error={errors.frameHeightCm?.message}
              {...register("frameHeightCm", { valueAsNumber: true })}
            />
          </div>
        </div>

        {/* Limites Paramétricos (min/max para sliders do configurador) */}
        <div className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400">
            Limites Paramétricos (para o configurador 3D)
          </p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <NumericField
              label="Larg. Mín"
              unit="cm"
              error={errors.minWidthCm?.message}
              {...register("minWidthCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Larg. Máx"
              unit="cm"
              error={errors.maxWidthCm?.message}
              {...register("maxWidthCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Prof. Mín"
              unit="cm"
              error={errors.minDepthCm?.message}
              {...register("minDepthCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Prof. Máx"
              unit="cm"
              error={errors.maxDepthCm?.message}
              {...register("maxDepthCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Alt. Mín"
              unit="cm"
              error={errors.minHeightCm?.message}
              {...register("minHeightCm", { valueAsNumber: true })}
            />
            <NumericField
              label="Alt. Máx"
              unit="cm"
              error={errors.maxHeightCm?.message}
              {...register("maxHeightCm", { valueAsNumber: true })}
            />
          </div>
        </div>

        {/* ── Campos condicionais por categoria ── */}
        {isSofa && (
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
              <Sofa className="h-3.5 w-3.5" />
              Medidas Específicas — Sofá
            </p>
            <div className="grid grid-cols-3 gap-4">
              <NumericField
                label="Altura do Assento"
                unit="cm"
                hint="Limites anatômicos: 35–55 cm"
                error={errors.seatHeightCm?.message}
                {...register("seatHeightCm", { valueAsNumber: true })}
              />
              <NumericField
                label="Prof. Assento"
                unit="cm"
                hint="Limites anatômicos: 45–70 cm"
                error={errors.seatDepthCm?.message}
                {...register("seatDepthCm", { valueAsNumber: true })}
              />
              <NumericField
                label="Larg. Braço"
                unit="cm"
                hint="Limites: 5–30 cm"
                error={errors.armWidthCm?.message}
                {...register("armWidthCm", { valueAsNumber: true })}
              />
            </div>
          </div>
        )}

        {isCama && (
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
              <BedDouble className="h-3.5 w-3.5" />
              Medidas Específicas — Cama
            </p>
            <div className="grid grid-cols-2 gap-4">
              <NumericField
                label="Alt. Cabeceira"
                unit="cm"
                hint="Limites: 30–150 cm"
                error={errors.headboardHeightCm?.message}
                {...register("headboardHeightCm", { valueAsNumber: true })}
              />
              <NumericField
                label="Vão Livre / Estrado"
                unit="cm"
                hint="Limites: 15–60 cm"
                error={errors.frameHeightCm?.message}
                {...register("frameHeightCm", { valueAsNumber: true })}
              />
            </div>
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 3: UPLOADS (Modelo 3D + Thumbnail)
          ════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600/10">
            <FileUp className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-stone-800">Arquivos 3D e Imagens</h3>
            <p className="text-xs text-stone-400">
              Modelo 3D e thumbnail do produto
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* ── Drag & Drop: Modelo 3D ── */}
          <DropZone
            label="Modelo 3D"
            hint=".glb ou .gltf — máx. 100MB"
            acceptExtensions=".glb,.gltf"
            uploadState={modelUpload}
            isDragging={isDragging3D}
            icon={Box}
            inputRef={fileInputRef}
            onDragOver={(e) => handleDragOver(e, setIsDragging3D)}
            onDragLeave={(e) => handleDragLeave(e, setIsDragging3D)}
            onDrop={(e) => handleDrop(e, "MODEL_3D", setIsDragging3D, setModelUpload)}
            onFileSelect={(e) => handleFileSelect(e, "MODEL_3D", setModelUpload)}
            onReset={() => setModelUpload(INITIAL_UPLOAD_STATE)}
          />

          {/* ── Drag & Drop: Thumbnail ── */}
          <DropZone
            label="Thumbnail"
            hint=".jpg, .png ou .webp — máx. 5MB"
            acceptExtensions=".jpg,.jpeg,.png,.webp"
            uploadState={thumbnailUpload}
            isDragging={isDraggingThumb}
            icon={Upload}
            inputRef={thumbnailInputRef}
            onDragOver={(e) => handleDragOver(e, setIsDraggingThumb)}
            onDragLeave={(e) => handleDragLeave(e, setIsDraggingThumb)}
            onDrop={(e) => handleDrop(e, "THUMBNAIL", setIsDraggingThumb, setThumbnailUpload)}
            onFileSelect={(e) => handleFileSelect(e, "THUMBNAIL", setThumbnailUpload)}
            onReset={() => setThumbnailUpload(INITIAL_UPLOAD_STATE)}
          />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SEÇÃO 4: FLAGS DE PERSONALIZAÇÃO
          ════════════════════════════════════════════════════════════ */}
      <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-600/10">
            <SlidersHorizontal className="h-5 w-5 text-purple-700" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-stone-800">Personalização</h3>
            <p className="text-xs text-stone-400">
              Opções disponíveis para o cliente no configurador
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Controller
            name="allowsPetFriendly"
            control={control}
            render={({ field }) => (
              <ToggleField
                label="Pet Friendly"
                description="Habilita filtro de tecidos anti-pelo/arranhão"
                icon={PawPrint}
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            name="allowsRetractable"
            control={control}
            render={({ field }) => (
              <ToggleField
                label="Assento Retrátil"
                description="Permite configurar assento retrátil"
                icon={Sofa}
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            name="allowsXRayView"
            control={control}
            render={({ field }) => (
              <ToggleField
                label="Visão Raio-X"
                description="Permite ver camadas internas do produto"
                icon={Eye}
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            name="allowsChaise"
            control={control}
            render={({ field }) => (
              <ToggleField
                label="Chaise"
                description="Módulo de chaise disponível"
                icon={Sofa}
                checked={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          BARRA DE AÇÕES
          ════════════════════════════════════════════════════════════ */}
      {errors.root && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <ShieldAlert className="h-5 w-5 flex-shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{errors.root.message}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          className="rounded-lg border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 transition-all hover:bg-stone-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSubmitting || formStatus === "saving"}
          className="flex items-center gap-2 rounded-lg bg-amber-800 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting || formStatus === "saving" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              {isEditing ? "Atualizar Produto" : "Cadastrar Produto"}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  DROPZONE — Componente de Drag & Drop                              │
// └──────────────────────────────────────────────────────────────────────┘

interface DropZoneProps {
  label: string;
  hint: string;
  acceptExtensions: string;
  uploadState: UploadState;
  isDragging: boolean;
  icon: React.ElementType;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
}

function DropZone({
  label,
  hint,
  acceptExtensions,
  uploadState,
  isDragging,
  icon: Icon,
  inputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  onReset,
}: DropZoneProps) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Estado: Sucesso ──
  if (uploadState.status === "success") {
    return (
      <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-800">
                {uploadState.fileName}
              </p>
              <p className="text-xs text-emerald-600">
                {uploadState.fileSize && formatSize(uploadState.fileSize)} — Upload concluído
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md p-1 text-emerald-400 transition-colors hover:bg-emerald-100 hover:text-emerald-600"
            title="Remover e enviar outro"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── Estado: Erro ──
  if (uploadState.status === "error") {
    return (
      <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-red-100">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">{label}: Upload falhou</p>
            <p className="mt-0.5 text-xs text-red-600">
              {uploadState.errorMessage}
            </p>
            {uploadState.errorCode && (
              <p className="mt-1 font-mono text-[10px] text-red-400">
                Código: {uploadState.errorCode}
              </p>
            )}
            <button
              type="button"
              onClick={onReset}
              className="mt-2 text-xs font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Estado: Uploading ──
  if (uploadState.status === "uploading" || uploadState.status === "validating") {
    return (
      <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
            <Loader2 className="h-5 w-5 animate-spin text-amber-700" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              {uploadState.status === "validating" ? "Validando..." : "Enviando..."}
            </p>
            <p className="text-xs text-amber-600">{uploadState.fileName}</p>
            {/* Barra de progresso */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-200">
              <div
                className="h-full rounded-full bg-amber-600 transition-all duration-300"
                style={{ width: `${uploadState.progress}%` }}
              />
            </div>
            <p className="mt-1 text-right text-[10px] font-medium text-amber-500">
              {uploadState.progress}%
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Estado: Idle (zona de drop) ──
  return (
    <div
      onDragOver={onDragOver as any}
      onDragLeave={onDragLeave as any}
      onDrop={onDrop as any}
      onClick={() => inputRef.current?.click()}
      className={`group cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-all ${
        isDragging
          ? "border-amber-500 bg-amber-50 ring-4 ring-amber-100"
          : "border-stone-200 bg-stone-50/50 hover:border-amber-400 hover:bg-amber-50/30"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptExtensions}
        onChange={onFileSelect}
        className="hidden"
      />
      <div className="flex flex-col items-center gap-2">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
            isDragging
              ? "bg-amber-100 text-amber-700"
              : "bg-stone-100 text-stone-400 group-hover:bg-amber-100 group-hover:text-amber-600"
          }`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-medium text-stone-700">
            {isDragging ? "Solte o arquivo aqui" : label}
          </p>
          <p className="mt-0.5 text-xs text-stone-400">{hint}</p>
          <p className="mt-1 text-xs text-amber-600">
            Clique ou arraste um arquivo
          </p>
        </div>
      </div>
    </div>
  );
}
