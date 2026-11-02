import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";

import { createDaniVariant, DANI_VARIANTS, type DaniVariantId } from "./components/robot/dani-variants";
import { poseRobotModel } from "./components/robot/robot-model";

function VariantCard({ id, label }: { id: DaniVariantId; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(360, 400, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new Scene();
    const camera = new OrthographicCamera(-1.76, 1.76, 1.76, -1.76, 0.1, 30);
    camera.position.set(3, 2.4, 7);
    camera.lookAt(0, 1.36, 0);
    scene.add(new HemisphereLight(0xffffff, 0xa2b3b2, 2.1));
    const key = new DirectionalLight(0xfff8ef, 3.2);
    key.position.set(-3, 6, 5);
    scene.add(key);
    const fill = new DirectionalLight(0xd9eaff, 1.5);
    fill.position.set(4, 3, -2);
    scene.add(fill);
    const model = createDaniVariant(id);
    poseRobotModel(model, { motion: "idle", time: 0.42, seed: 0.5 });
    scene.add(model);
    renderer.render(scene, camera);
    return () => renderer.dispose();
  }, [id]);
  return (
    <div style={{ textAlign: "center", color: "#234", fontSize: 15, fontWeight: 600 }}>
      <canvas ref={ref} style={{ width: 205, height: 228 }} />
      <div>{label}</div>
    </div>
  );
}

function App() {
  return (
    <div style={{ background: "#dde9f6", padding: 16, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 1000 }}>
        {DANI_VARIANTS.map((v) => (
          <VariantCard key={v.id} id={v.id} label={v.label} />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
