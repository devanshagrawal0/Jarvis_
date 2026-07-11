import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { AtmosphericParticles } from "./layers/AtmosphericParticles";
import { CityBuildings } from "./layers/CityBuildings";
import { CityBedGlow } from "./layers/CityBedGlow";
import { CityLightNodes } from "./layers/CityLightNodes";
import { FenwayRing } from "./layers/FenwayRing";
import { FootprintLines } from "./layers/FootprintLines";
import { GlowRoads } from "./layers/GlowRoads";
import { GroundField } from "./layers/GroundField";
import { HeroTower } from "./layers/HeroTower";
import { HorizonRoom } from "./layers/HorizonRoom";
import { MapPins } from "./layers/MapPins";
import { PostEffects } from "./PostEffects";
import { SceneLights } from "./SceneLights";
import { hologramColors } from "./tokens";
import { useBostonBuildings } from "./hooks/useBostonBuildings";

export function BostonHologramScene() {
  const buildings = useBostonBuildings();
  const cityRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (cityRef.current) cityRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.08) * 0.012;
  });

  return (
    <>
      <color attach="background" args={[hologramColors.void]} />
      <fog attach="fog" args={[hologramColors.haze, 7, 34]} />
      <SceneLights />
      <group ref={cityRef} position={[0, -0.82, -0.2]} rotation={[0, -0.04, 0]}>
        <HorizonRoom />
        <GroundField />
        <CityBedGlow />
        {buildings.length ? <CityBuildings buildings={buildings} /> : null}
        <FootprintLines />
        <GlowRoads />
        <CityLightNodes />
        <FenwayRing />
        <HeroTower />
        <MapPins />
        <AtmosphericParticles />
      </group>
      <PostEffects />
    </>
  );
}
