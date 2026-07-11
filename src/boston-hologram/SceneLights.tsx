import { hologramColors } from "./tokens";

export function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.18} />
      <pointLight position={[0, 5, 5]} color={hologramColors.cyan} intensity={9} distance={13} />
      <pointLight position={[5, 4, -3]} color={hologramColors.blue} intensity={3} distance={12} />
    </>
  );
}
