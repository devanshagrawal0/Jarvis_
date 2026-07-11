import { Text } from "@react-three/drei";
import { hologramColors } from "../tokens";

export function HologramLabel({
  title,
  subtitle,
  position,
  fontSize = 0.125,
  color = hologramColors.cyanHot,
}: {
  title: string;
  subtitle?: string;
  position: [number, number, number];
  fontSize?: number;
  color?: string;
}) {
  return (
    <group position={position} rotation={[-0.5, 0, 0]}>
      <Text fontSize={fontSize} color={color} anchorX="left" anchorY="bottom">
        {title}
      </Text>
      {subtitle ? (
        <Text position={[0, -fontSize * 1.35, 0]} fontSize={fontSize * 0.82} color="#77dfff" anchorX="left" anchorY="top">
          {subtitle}
        </Text>
      ) : null}
    </group>
  );
}
