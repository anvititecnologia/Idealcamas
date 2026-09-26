// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — ModelViewer (React Three Fiber)
// ──────────────────────────────────────────────────────────────────────────────
// Componente de visualização 3D para o catálogo do cliente.
// Responsável por:
//   1. Carregar modelos .glb de forma assíncrona (useGLTF + Suspense)
//   2. Controles de órbita com limites de zoom e rotação
//   3. Iluminação otimizada para texturas de tecidos/madeiras
//   4. Skeleton Loader elegante durante o carregamento (evita CLS)
//   5. Auto-enquadramento do modelo na cena
//   6. Suporte a troca dinâmica de materiais (personalização)
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import { Suspense, useRef, useEffect, useState, useCallback } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  useGLTF,
  Environment,
  ContactShadows,
  Center,
  Bounds,
  useBounds,
  Html,
  useProgress,
} from "@react-three/drei";
import * as THREE from "three";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

export interface ModelViewerProps {
  /** URL do modelo .glb (do bucket S3 ou CDN) */
  modelUrl: string;
  /** Mapa de materiais a trocar: { nomeDoMesh: { color?, map? } } */
  materialOverrides?: Record<
    string,
    { color?: string; mapUrl?: string }
  >;
  /** Ativar/desativar visão raio-x (transparência de camadas) */
  xRayMode?: boolean;
  /** Cor de fundo do canvas */
  backgroundColor?: string;
  /** Intensidade da luz ambiente (0-3, padrão 0.6) */
  ambientIntensity?: number;
  /** Classe CSS adicional para o container */
  className?: string;
  /** Callback quando o modelo é carregado */
  onModelLoaded?: () => void;
  /** Callback de erro no carregamento */
  onModelError?: (error: Error) => void;
  /** Altura do container (padrão: 500px) */
  height?: number | string;
  /** Mostrar sombra de contato no chão */
  showShadow?: boolean;
  /** Rotação automática (lenta) quando o usuário não interage */
  autoRotate?: boolean;
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  SKELETON LOADER                                                    │
// │  Exibido enquanto o modelo carrega — evita CLS                     │
// └──────────────────────────────────────────────────────────────────────┘

function ModelSkeleton() {
  const { progress } = useProgress();

  return (
    <Html center>
      <div className="flex flex-col items-center gap-4">
        {/* Animação de carregamento */}
        <div className="relative h-16 w-16">
          {/* Anel externo rotativo */}
          <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-stone-200 border-t-amber-700" />
          {/* Ícone central */}
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              className="h-6 w-6 text-amber-800/60"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
              />
            </svg>
          </div>
        </div>

        {/* Barra de progresso */}
        <div className="w-48">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-700 to-amber-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs font-medium text-stone-500">
            Carregando modelo 3D...{" "}
            <span className="text-amber-700">{Math.round(progress)}%</span>
          </p>
        </div>
      </div>
    </Html>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MODELO 3D (carregado assincronamente)                             │
// └──────────────────────────────────────────────────────────────────────┘

interface ModelProps {
  url: string;
  materialOverrides?: ModelViewerProps["materialOverrides"];
  xRayMode?: boolean;
  onLoaded?: () => void;
}

function Model({ url, materialOverrides, xRayMode, onLoaded }: ModelProps) {
  const { scene } = useGLTF(url);
  const modelRef = useRef<THREE.Group>(null);
  const bounds = useBounds();

  // ── Auto-enquadrar quando o modelo carrega ──
  useEffect(() => {
    if (modelRef.current && bounds) {
      // Fit do modelo no viewport com margem
      bounds.refresh(modelRef.current).clip().fit();
    }
    onLoaded?.();
  }, [scene, bounds, onLoaded]);

  // ── Aplicar overrides de materiais (personalização dinâmica) ──
  useEffect(() => {
    if (!materialOverrides) return;

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name in (materialOverrides || {})) {
        const override = materialOverrides[child.name];
        const material = child.material as THREE.MeshStandardMaterial;

        if (override.color) {
          material.color.set(override.color);
        }

        // Atualizar material para refletir mudanças
        material.needsUpdate = true;
      }
    });
  }, [scene, materialOverrides]);

  // ── Modo Raio-X: transparência nas camadas ──
  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshStandardMaterial;

        if (xRayMode) {
          material.transparent = true;
          material.opacity = 0.35;
          material.wireframe = false;
          material.depthWrite = false;
        } else {
          material.transparent = false;
          material.opacity = 1;
          material.depthWrite = true;
        }

        material.needsUpdate = true;
      }
    });
  }, [scene, xRayMode]);

  return (
    <group ref={modelRef}>
      <primitive object={scene} dispose={null} />
    </group>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ILUMINAÇÃO DE ESTÚDIO                                             │
// │  Otimizada para destacar texturas de tecidos e madeiras            │
// └──────────────────────────────────────────────────────────────────────┘

interface StudioLightingProps {
  ambientIntensity: number;
}

function StudioLighting({ ambientIntensity }: StudioLightingProps) {
  return (
    <>
      {/* Luz ambiente suave */}
      <ambientLight intensity={ambientIntensity} color="#faf5ef" />

      {/* Luz principal (key light) — simula janela grande */}
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.2}
        color="#fff8f0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />

      {/* Luz de preenchimento (fill light) — suaviza sombras */}
      <directionalLight
        position={[-4, 4, -3]}
        intensity={0.4}
        color="#e8e0d8"
      />

      {/* Luz de contorno (rim light) — destaca silhueta */}
      <directionalLight
        position={[0, 3, -6]}
        intensity={0.3}
        color="#d4c5b0"
      />

      {/* Luz pontual inferior — ilumina base do móvel */}
      <pointLight
        position={[0, -2, 3]}
        intensity={0.15}
        color="#f5ebe0"
        distance={15}
      />
    </>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  SKELETON LOADER EXTERIOR (enquanto o Canvas monta)                │
// └──────────────────────────────────────────────────────────────────────┘

function ExternalSkeleton({ height }: { height: number | string }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl bg-gradient-to-b from-stone-100 to-stone-50"
      style={{ height }}
    >
      <div className="flex flex-col items-center gap-4">
        {/* Forma abstrata animada representando um sofá */}
        <div className="relative">
          <div className="h-12 w-24 animate-pulse rounded-lg bg-stone-200" />
          <div className="absolute -top-2 left-2 h-8 w-20 animate-pulse rounded-t-lg bg-stone-200/80" />
          <div className="absolute -left-3 top-0 h-10 w-4 animate-pulse rounded-l-lg bg-stone-200/60" />
          <div className="absolute -right-3 top-0 h-10 w-4 animate-pulse rounded-r-lg bg-stone-200/60" />
        </div>
        <div className="space-y-1.5 text-center">
          <div className="mx-auto h-2 w-32 animate-pulse rounded-full bg-stone-200" />
          <div className="mx-auto h-2 w-20 animate-pulse rounded-full bg-stone-200/60" />
        </div>
      </div>
    </div>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  COMPONENTE PRINCIPAL — ModelViewer                                 │
// └──────────────────────────────────────────────────────────────────────┘

export function ModelViewer({
  modelUrl,
  materialOverrides,
  xRayMode = false,
  backgroundColor = "#faf8f5",
  ambientIntensity = 0.6,
  className = "",
  onModelLoaded,
  onModelError,
  height = 500,
  showShadow = true,
  autoRotate = true,
}: ModelViewerProps) {
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleCreated = useCallback(() => {
    setIsCanvasReady(true);
  }, []);

  const handleError = useCallback(
    (err: Error) => {
      setError(err);
      onModelError?.(err);
    },
    [onModelError]
  );

  // ── Estado de erro ──
  if (error) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl border-2 border-dashed border-red-200 bg-red-50 ${className}`}
        style={{ height }}
      >
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-red-800">
            Falha ao carregar modelo 3D
          </p>
          <p className="mt-1 text-xs text-red-600">
            {error.message || "Verifique a URL do modelo"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`} style={{ height }}>
      {/* Skeleton exterior enquanto o Canvas monta */}
      {!isCanvasReady && (
        <div className="absolute inset-0 z-10">
          <ExternalSkeleton height="100%" />
        </div>
      )}

      <Canvas
        camera={{ position: [3, 2, 5], fov: 45 }}
        style={{ background: backgroundColor }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={[1, 2]} // Retina-ready sem gastar GPU demais
        onCreated={handleCreated}
        shadows
      >
        {/* ── Iluminação ── */}
        <StudioLighting ambientIntensity={ambientIntensity} />

        {/* ── Environment Map — reflexos sutis em madeira/tecido ── */}
        <Environment preset="apartment" environmentIntensity={0.3} />

        {/* ── Modelo 3D com auto-enquadramento ── */}
        <Suspense fallback={<ModelSkeleton />}>
          <Bounds fit clip observe margin={1.4}>
            <Center>
              <Model
                url={modelUrl}
                materialOverrides={materialOverrides}
                xRayMode={xRayMode}
                onLoaded={onModelLoaded}
              />
            </Center>
          </Bounds>
        </Suspense>

        {/* ── Sombra de contato no chão ── */}
        {showShadow && (
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.4}
            scale={12}
            blur={2.5}
            far={4}
            color="#8b7355"
          />
        )}

        {/* ── Controles de Órbita ── */}
        <OrbitControls
          makeDefault
          // ── Limites de zoom ──
          minDistance={1.5}
          maxDistance={12}
          // ── Limites de rotação vertical (não permitir ver por baixo) ──
          minPolarAngle={Math.PI * 0.1}  // ~18° (quase topo)
          maxPolarAngle={Math.PI * 0.55} // ~99° (quase lateral)
          // ── Suavização (damping) ──
          enableDamping
          dampingFactor={0.08}
          // ── Auto-rotação suave ──
          autoRotate={autoRotate}
          autoRotateSpeed={0.8}
          // ── Pan limitado ──
          enablePan
          panSpeed={0.5}
          // ── Touch ──
          touches={{
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />
      </Canvas>

      {/* ── Instrução flutuante (hint) ── */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-xs text-white/80 backdrop-blur-sm">
          <svg className="h-4 w-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
          </svg>
          Arraste para girar • Scroll para zoom
        </div>
      </div>
    </div>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  PRE-LOAD                                                           │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Pré-carrega um modelo GLB para cache do Three.js.
 * Chame nos eventos onMouseEnter do card do catálogo para
 * reduzir o tempo de carregamento ao abrir o viewer.
 */
export function preloadModel(url: string): void {
  useGLTF.preload(url);
}
