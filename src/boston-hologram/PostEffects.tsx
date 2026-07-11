import { Bloom, EffectComposer, Noise, SMAA, Vignette } from "@react-three/postprocessing";

export function PostEffects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom luminanceThreshold={0.58} luminanceSmoothing={0.32} intensity={0.52} mipmapBlur radius={0.38} />
      <Noise opacity={0.032} />
      <Vignette eskil={false} offset={0.18} darkness={0.9} />
      <SMAA />
    </EffectComposer>
  );
}
