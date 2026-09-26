// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — ModelViewer (React Three Fiber)
// ──────────────────────────────────────────────────────────────────────────────
// Componente de visualização 3D para o catálogo do cliente.
// Responsável por:
//   1. Renderizar geometria placeholder (até modelos .glb serem integrados)
//   2. Controles de órbita com limites de zoom e rotação
//   3. Iluminação otimizada para texturas de tecidos/madeiras
//   4. Skeleton Loader elegante durante o carregamento (evita CLS)
//   5. Suporte a troca dinâmica de cor via materialOverrides
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import { Suspense, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  ContactShadows,
  Html,
  useProgress,
} from "@react-three/drei";
import * as THREE from "three";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

export interface ModelViewerProps {
  /** URL do modelo .glb (reservado para uso futuro com CDN/S3) */
  modelUrl?: string;
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
// │  Exibido enquanto o Canvas monta — evita CLS                       │
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
// │  PLACEHOLDER GEOMÉTRICO                                             │
// │  Renderizado enquanto modelos .glb não estão disponíveis            │
// └──────────────────────────────────────────────────────────────────────┘

interface PlaceholderModelProps {
  color?: string;
}

function PlaceholderModel({ color = "#8a735c" }: PlaceholderModelProps) {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[2, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
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
  materialOverrides,
  xRayMode = false,
  backgroundColor = "#faf8f5",
  ambientIntensity = 0.5,
  className = "",
  onModelLoaded,
  height = 500,
  showShadow = true,
  autoRotate = true,
}: ModelViewerProps) {
  const [isCanvasReady, setIsCanvasReady] = useState(false);

  const handleCreated = useCallback(() => {
    setIsCanvasReady(true);
    onModelLoaded?.();
  }, [onModelLoaded]);

  // ── Extrair cor do override para o placeholder ──
  const meshColor =
    materialOverrides?.["sofa-body"]?.color || "#8a735c";

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
        <ambientLight intensity={ambientIntensity} />
        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />

        {/* ── Placeholder Geométrico ── */}
        <Suspense fallback={<ModelSkeleton />}>
          <PlaceholderModel color={meshColor} />
        </Suspense>

        {/* ── Sombra de contato no chão ── */}
        {showShadow && (
          <ContactShadows
            position={[0, -0.51, 0]}
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
